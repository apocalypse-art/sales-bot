/**
 * Core sale processing logic.
 *
 * Receives an Alchemy NFT_ACTIVITY event and routes it down one of two paths:
 *
 *   Secondary sale — the token changed hands between wallets. OpenSea has a
 *   `sale` event for it, which gives us the price.
 *
 *   Primary sale — the buyer minted the token straight from a claim page, so
 *   the transfer comes from the zero address. OpenSea records no `sale` event
 *   for a mint, so the price is read from the mint transaction instead.
 *
 * Either way we then fetch artwork, convert to USD, and tweet.
 */

const {
  fetchRecentSale,
  fetchNftMetadata,
  buildChainExplorerLink,
  TWEET_WITHOUT_PRICE_NETWORKS,
} = require('./openSeaService');
const { identifyMarketplace, nameSettlementContract } = require('./marketplaceService');
const { resolvePrimarySale } = require('./mintService');
const { fetchEthUsdPrice } = require('./priceService');
const { downloadImageBuffer } = require('./imageService');
const { postSaleTweet } = require('./twitterService');
const CONTRACTS = require('./contracts');
const {
  OVERSOUL_CONTRACT,
  suppressWebhookMint,
  suppressWebhookTransfer,
  isPlaceholderName,
} = require('./oversoul');

// How long to wait after an on-chain transfer before querying OpenSea.
// OpenSea usually indexes sales within 30–60 seconds of the transaction.
const OPENSEA_INDEX_DELAY_MS = 45 * 1000;

// A freshly minted token can take longer than that to appear in OpenSea's
// metadata index, so the primary-sale path retries before giving up on a name.
const METADATA_RETRIES     = 3;
const METADATA_RETRY_MS    = 30 * 1000;

const ZERO = '0x0000000000000000000000000000000000000000';

// Deduplication: track recently processed tx hashes to prevent double-posting
// if Alchemy retries a webhook delivery. Capped to avoid unbounded memory growth.
const processedTxHashes = new Set();
const MAX_PROCESSED_HASHES = 1000;

// Tokens announced via POST /announce-sale in this process. Separate from the
// set above because the two paths key on different things — and because an
// Oversoul mint returns before the webhook set is written, so sharing one would
// make the announcement look like a duplicate of the mint it followed.
const announcedTokenIds = new Set();

/**
 * Handle one activity entry from an Alchemy NFT_ACTIVITY webhook.
 *
 * Alchemy activity shape:
 * {
 *   fromAddress:      '0x...',
 *   toAddress:        '0x...',
 *   contractAddress:  '0x...',
 *   erc721TokenId:    '0x1',       // hex token ID
 *   category:         'token',
 *   log: { transactionHash: '0x...', ... }
 * }
 */
async function handleAlchemyActivity(activity, network) {
  const { fromAddress, contractAddress, erc721TokenId, erc1155Metadata, log } = activity;

  // Skip contracts not in our registry
  const collection = CONTRACTS[contractAddress?.toLowerCase()];
  if (!collection) {
    console.log(`Ignoring activity from unknown contract ${contractAddress}`);
    return;
  }
  const collectionName = collection.name;

  // Support both ERC-721 (erc721TokenId) and ERC-1155 (erc1155Metadata[0].tokenId)
  const rawTokenId = erc721TokenId ?? erc1155Metadata?.[0]?.tokenId ?? null;
  const tokenId = rawTokenId ? parseInt(rawTokenId, 16).toString() : null;
  if (!tokenId) {
    console.warn('Could not parse tokenId from activity, skipping.');
    return;
  }

  const txHash = log?.transactionHash ?? null;

  // A transfer from the zero address is a mint — on Manifold that means a
  // primary sale, not something to ignore.
  const isMint = !fromAddress || fromAddress.toLowerCase() === ZERO;

  console.log(
    `${isMint ? 'Mint' : 'Transfer'} detected: ${collectionName} ` +
    `contract=${contractAddress} tokenId=${tokenId} tx=${txHash}`
  );

  // ── The Oversoul exceptions ────────────────────────────────────────────────
  //
  // Checked BEFORE the deduplication mark below, so a suppressed event never
  // consumes a slot in that set and cannot mask a later redelivery of something
  // we do want to announce.
  //
  // Both rules are scoped to the Oversoul contract — see src/oversoul.js for
  // why. Every other collection reaches the dispatch below unchanged.
  if (isMint && suppressWebhookMint(contractAddress)) {
    console.log(
      'Oversoul mint — not announcing from the webhook. Its artwork is not published ' +
      'yet; the publish job will POST /announce-sale once it has verified that it is.'
    );
    return;
  }
  if (!isMint && suppressWebhookTransfer(contractAddress, fromAddress)) {
    console.log('Oversoul sale by the artist (an accepted offer) — announced by hand, skipping.');
    return;
  }

  // Skip if we've already handled this transaction (Alchemy webhook retry, or
  // a multi-token mint that arrives as several activities sharing one tx).
  if (txHash && processedTxHashes.has(txHash)) {
    console.log(`Skipping duplicate webhook for tx=${txHash}`);
    return;
  }
  if (txHash) {
    processedTxHashes.add(txHash);
    if (processedTxHashes.size > MAX_PROCESSED_HASHES) {
      // Drop the oldest entry to keep memory bounded
      processedTxHashes.delete(processedTxHashes.values().next().value);
    }
  }

  try {
    if (isMint) {
      return await handlePrimarySale({ contractAddress, tokenId, txHash, network });
    }
    return await handleSecondarySale({ contractAddress, tokenId, txHash, network });
  } catch (err) {
    // The hash is marked BEFORE the work, so several activities from one
    // transaction cannot all be processed at once. If the work then fails, that
    // mark becomes a lie: it would swallow a redelivery of a sale we never
    // announced, and the only trace would be one line in a log. Unmark it, so a
    // second delivery gets a real second attempt.
    //
    // The work below can take over two minutes and can fail at OpenSea, at the
    // image download, at the price lookup or at Twitter — none of which are
    // reasons to lose the sale for good.
    if (txHash) processedTxHashes.delete(txHash);
    throw err;
  }
}

/**
 * Primary sale: the buyer minted the token. Price comes from the mint
 * transaction; name and image come from OpenSea's NFT endpoint.
 */
async function handlePrimarySale({ contractAddress, tokenId, txHash, network }) {
  const primary = await resolvePrimarySale({ txHash, contractAddress, network });

  if (!primary) {
    console.log('Could not read the mint transaction — skipping (cannot tell a sale from an airdrop).');
    return;
  }
  if (primary.isFree) {
    console.log('Nothing was paid for this mint (airdrop or free claim) — skipping.');
    return;
  }

  const { ethPrice, quantity, settlementAddress } = primary;

  // ── Wait for OpenSea to index the newly minted token ──────────────────────
  console.log(`Paid mint: ${ethPrice} ETH. Waiting ${OPENSEA_INDEX_DELAY_MS / 1000}s for OpenSea to index the token…`);
  await delay(OPENSEA_INDEX_DELAY_MS);
  const meta = await fetchMetadataWithRetry(contractAddress, tokenId, network);

  // ── Marketplace: we already know which contract settled the mint ──────────
  const marketplace = nameSettlementContract(settlementAddress);
  if (marketplace) {
    console.log(`Marketplace resolved: ${marketplace}`);
  } else {
    console.log(`Mint settled through unknown contract ${settlementAddress} — tweeting without a marketplace name.`);
  }

  const ethUsd   = await fetchEthUsdPrice();
  const usdPrice = ethUsd != null ? ethPrice * ethUsd : null;

  const baseName  = meta.tokenName || `#${tokenId}`;
  const tokenName = quantity > 1 ? `${baseName} ×${quantity}` : baseName;
  const saleLink  = meta.openSeaUrl ?? buildChainExplorerLink(network, contractAddress, tokenId, txHash);

  console.log(`Primary sale confirmed: ${tokenName} — ${ethPrice} ETH ${usdPrice != null ? `($${usdPrice.toFixed(2)})` : '(USD unknown)'}${marketplace ? ` on ${marketplace}` : ''}`);

  const imageBuffer = meta.imageUrl ? await downloadImageBuffer(meta.imageUrl) : null;

  await postSaleTweet({
    tokenName,
    ethPrice,
    usdPrice,
    currency: 'ETH',
    marketplace,
    saleLink,
    imageBuffer,
  });
}

/**
 * Secondary sale: the token changed hands, so OpenSea should have a sale
 * record with the price.
 */
async function handleSecondarySale({ contractAddress, tokenId, txHash, network }) {
  // ── Wait for OpenSea to index the sale ────────────────────────────────────
  console.log(`Waiting ${OPENSEA_INDEX_DELAY_MS / 1000}s for OpenSea to index…`);
  await delay(OPENSEA_INDEX_DELAY_MS);

  // ── Fetch sale details from OpenSea ───────────────────────────────────────
  let sale;
  try {
    sale = await fetchRecentSale(contractAddress, tokenId, network);
  } catch (err) {
    console.error('OpenSea lookup failed:', err.message);
    return;
  }

  if (!sale) {
    if (TWEET_WITHOUT_PRICE_NETWORKS.has(network)) {
      // OpenSea had no sale record for this transfer, but on these chains we
      // still post a price-less tweet rather than stay silent.
      console.log(`No OpenSea sale record for ${network} — tweeting without price/image.`);
      const saleLink = buildChainExplorerLink(network, contractAddress, tokenId, txHash);
      await postSaleTweet({
        tokenName:   `#${tokenId}`,
        ethPrice:    null,
        usdPrice:    null,
        currency:    'ETH',
        marketplace: 'Shape',
        saleLink,
        imageBuffer: null,
      });
    } else {
      // The transfer happened but OpenSea has no matching sale — likely a
      // wallet-to-wallet transfer, not a market sale. Skip it.
      console.log('No recent sale found on OpenSea for this transfer — skipping.');
    }
    return;
  }

  const { tokenName, imageUrl, ethPrice, currency, protocolAddress, saleLink } = sale;

  // ── Determine the marketplace from the settlement contract ──────────────────
  // Read it from the chain rather than trusting OpenSea to name it — this is
  // what correctly identifies Manifold sales instead of mislabeling them OpenSea.
  const marketplace = await identifyMarketplace(txHash, network, protocolAddress);
  if (marketplace) {
    console.log(`Marketplace resolved: ${marketplace}`);
  } else {
    console.log('Marketplace could not be identified — tweeting without a marketplace name.');
  }

  // ── Get USD value ──────────────────────────────────────────────────────────
  const USD_STABLECOINS = new Set(['USDC', 'USDT', 'DAI', 'BUSD', 'FRAX', 'LUSD']);
  const ethUsd   = await fetchEthUsdPrice();
  const usdPrice = ethPrice == null
    ? null
    : USD_STABLECOINS.has(currency)
      ? ethPrice
      : (ethUsd != null ? ethPrice * ethUsd : null);

  console.log(`Sale confirmed: ${tokenName} — ${ethPrice ?? 'price unknown'} ${currency} ${usdPrice != null ? `($${usdPrice.toFixed(2)})` : '(USD unknown)'}${marketplace ? ` on ${marketplace}` : ''}`);

  // ── Download the artwork image ─────────────────────────────────────────────
  const imageBuffer = imageUrl ? await downloadImageBuffer(imageUrl) : null;

  // ── Post to Twitter ────────────────────────────────────────────────────────
  await postSaleTweet({
    tokenName,
    ethPrice,
    usdPrice,
    currency,
    marketplace,
    saleLink,
    imageBuffer,
  });
}

/**
 * OpenSea can lag behind a fresh mint. Retry until the artwork name shows up,
 * then fall back to the token number rather than blocking the tweet.
 */
async function fetchMetadataWithRetry(contractAddress, tokenId, network) {
  let meta = { tokenName: null, imageUrl: null, openSeaUrl: null };

  for (let attempt = 1; attempt <= METADATA_RETRIES; attempt++) {
    meta = await fetchNftMetadata(contractAddress, tokenId, network);

    // "Is there a name?" was the wrong question. An Oversoul placeholder HAS a
    // name — "Invitation #21/144" — so this returned on the first attempt and
    // never waited for the artwork at all. Ask whether the name is real.
    //
    // isPlaceholderName is false for every other collection, so their behaviour
    // is exactly as before.
    if (meta.tokenName && !isPlaceholderName(contractAddress, meta.tokenName)) return meta;

    if (attempt < METADATA_RETRIES) {
      const why = meta.tokenName ? 'still serving a placeholder' : "hasn't indexed the new token yet";
      console.log(`OpenSea ${why} (attempt ${attempt}/${METADATA_RETRIES}) — retrying in ${METADATA_RETRY_MS / 1000}s…`);
      await delay(METADATA_RETRY_MS);
    }
  }

  console.warn('OpenSea never returned a real artwork name — tweeting with the token number.');
  // A placeholder is worse than no name: it reads as a real title. Drop it and
  // let the caller fall back to "#<tokenId>".
  if (isPlaceholderName(contractAddress, meta.tokenName)) meta = { ...meta, tokenName: null };
  return meta;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Announce an Oversoul sale we have been TOLD about, rather than one we noticed.
 *
 * Called only by POST /announce-sale, which the oversoul repo's publish job hits
 * once it has read the token's URI off the chain, fetched it, and confirmed it
 * serves the real artwork rather than the placeholder.
 *
 * 🪤 WHY THE NAME AND IMAGE ARE PASSED IN RATHER THAN LOOKED UP. The obvious
 * design — take the token id and reuse handlePrimarySale — reintroduces the
 * exact bug this endpoint exists to fix. handlePrimarySale reads the name from
 * OPENSEA, and OpenSea caches metadata: it can still be serving
 * "Invitation #N/144" for some time after Arweave is correct. Verifying Arweave
 * would then be pointless, because the tweet's name came from somewhere else.
 * The caller has already fetched and verified the metadata, so it sends what it
 * verified. OpenSea is not consulted on this path at all.
 *
 * Price and marketplace still come from the CHAIN, which is fast and settled
 * the moment the payment mines — the same resolvePrimarySale used everywhere
 * else, so pricing stays one well-tested implementation.
 *
 * @param {object} sale
 * @param {string|number} sale.tokenId   The Invitation token id
 * @param {string} sale.txHash           The buyer's payment transaction
 * @param {string} sale.name             The VERIFIED artwork name
 * @param {string|null} sale.imageUrl    The verified artwork URL
 * @param {boolean} [sale.dryRun]        Do everything except post
 */
async function announceVerifiedSale({ tokenId, txHash, name, imageUrl, dryRun = false }) {
  const contractAddress = OVERSOUL_CONTRACT;
  const network = 'ETH_MAINNET';

  // Independent of processedTxHashes, which tracks webhook deliveries. The
  // authoritative "have we announced this?" record is announced_at in the
  // oversoul database — this only catches a duplicate POST inside one process
  // lifetime, and a Railway restart clearing it is harmless for that reason.
  if (announcedTokenIds.has(String(tokenId))) {
    console.log(`Already announced Invitation #${tokenId} in this process — skipping.`);
    return { posted: false, reason: 'duplicate' };
  }

  // ── Price and marketplace, from the chain ─────────────────────────────────
  const primary = await resolvePrimarySale({ txHash, contractAddress, network });

  let ethPrice = null;
  let marketplace = null;
  if (!primary) {
    // Could not read the transaction. That is NOT evidence the sale was free —
    // the caller has already confirmed a real sale settled and published its
    // artwork. Announce it without a figure rather than staying silent or
    // inventing a zero.
    console.warn('Could not read the payment transaction — announcing without a price.');
  } else if (primary.isFree) {
    // Genuinely nothing paid. The publish job should not have sent this.
    console.log('Nothing was paid for this mint — not announcing.');
    return { posted: false, reason: 'free' };
  } else {
    ethPrice = primary.ethPrice;
    marketplace = nameSettlementContract(primary.settlementAddress);
  }

  const ethUsd = ethPrice == null ? null : await fetchEthUsdPrice();
  const usdPrice = ethUsd != null && ethPrice != null ? ethPrice * ethUsd : null;

  const tokenName = name || `#${tokenId}`;
  const saleLink = `https://opensea.io/assets/ethereum/${contractAddress}/${tokenId}`;
  const imageBuffer = imageUrl ? await downloadImageBuffer(imageUrl) : null;

  console.log(
    `Verified Oversoul sale: ${tokenName} — ${ethPrice ?? 'price unknown'} ETH` +
    `${usdPrice != null ? ` ($${usdPrice.toFixed(2)})` : ''}${marketplace ? ` on ${marketplace}` : ''}` +
    `${imageBuffer ? '' : ' (no image)'}`
  );

  if (dryRun) {
    console.log('DRY RUN — everything above is real; the tweet was not posted.');
    return { posted: false, reason: 'dry-run', tokenName, ethPrice, usdPrice, marketplace, hasImage: !!imageBuffer };
  }

  await postSaleTweet({
    tokenName,
    ethPrice,
    usdPrice,
    currency: 'ETH',
    marketplace,
    saleLink,
    imageBuffer,
  });

  announcedTokenIds.add(String(tokenId));
  if (announcedTokenIds.size > MAX_PROCESSED_HASHES) {
    announcedTokenIds.delete(announcedTokenIds.values().next().value);
  }
  return { posted: true, tokenName };
}

module.exports = { handleAlchemyActivity, announceVerifiedSale };
