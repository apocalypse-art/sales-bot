/**
 * Core sale processing logic.
 *
 * Receives an Alchemy NFT_ACTIVITY event, waits for OpenSea to index
 * the sale, fetches artwork and ETH/USD price, then tweets.
 */

const { fetchRecentSale, buildChainExplorerLink, OPENSEA_UNSUPPORTED } = require('./openSeaService');
const { fetchEthUsdPrice } = require('./priceService');
const { downloadImageBuffer } = require('./imageService');
const { postSaleTweet } = require('./twitterService');

// How long to wait after an on-chain transfer before querying OpenSea.
// OpenSea usually indexes sales within 30–60 seconds of the transaction.
const OPENSEA_INDEX_DELAY_MS = 45 * 1000;

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
  const { fromAddress, toAddress, contractAddress, erc721TokenId, log } = activity;

  // Skip mint events (transfers from the zero address are mints, not sales)
  const ZERO = '0x0000000000000000000000000000000000000000';
  if (!fromAddress || fromAddress.toLowerCase() === ZERO) {
    console.log('Skipping mint event.');
    return;
  }

  // Convert hex token ID to decimal string
  const tokenId = erc721TokenId ? parseInt(erc721TokenId, 16).toString() : null;
  if (!tokenId) {
    console.warn('Could not parse tokenId from activity, skipping.');
    return;
  }

  const txHash = log?.transactionHash ?? null;
  console.log(`Transfer detected: contract=${contractAddress} tokenId=${tokenId} tx=${txHash}`);

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
    if (OPENSEA_UNSUPPORTED.has(network)) {
      // Chain isn't indexed by OpenSea — tweet without price data.
      console.log(`Tweeting Shape transfer without price (OpenSea doesn't index ${network}).`);
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

  const { tokenName, imageUrl, ethPrice, currency, marketplace, saleLink } = sale;

  // ── Get USD value ──────────────────────────────────────────────────────────
  const ethUsd   = await fetchEthUsdPrice();
  const usdPrice = ethPrice * ethUsd;

  console.log(`Sale confirmed: ${tokenName} — ${ethPrice} ${currency} ($${usdPrice.toFixed(2)}) on ${marketplace}`);

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

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { handleAlchemyActivity };
