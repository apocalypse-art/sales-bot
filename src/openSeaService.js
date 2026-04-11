/**
 * OpenSea API service.
 *
 * After Alchemy detects an on-chain NFT transfer, we query OpenSea to find
 * the matching sale record — which gives us the price, marketplace, and
 * a clean image URL.
 *
 * OpenSea indexes sales from Blur, OpenSea itself, and other major markets.
 * Free API key available at: https://docs.opensea.io/reference/api-keys
 */

// Map Alchemy network names → OpenSea chain slugs
const NETWORK_TO_CHAIN = {
  ETH_MAINNET:   'ethereum',
  BASE_MAINNET:  'base',
  OPT_MAINNET:   'optimism',
  ARB_MAINNET:   'arbitrum',
  MATIC_MAINNET: 'matic',
  ZORA_MAINNET:  'zora',
};

// Chains that Alchemy supports but OpenSea does not index.
// For these we return null from fetchRecentSale and saleHandler
// falls back to a price-less "transfer detected" tweet.
const OPENSEA_UNSUPPORTED = new Set([
  'SHAPE_MAINNET',
]);

// Map OpenSea marketplace IDs to readable names
const MARKETPLACE_NAMES = {
  opensea:       'OpenSea',
  blur:          'Blur',
  looksrare:     'LooksRare',
  x2y2:          'X2Y2',
  foundation:    'Foundation',
  superrare:     'SuperRare',
  rarible:       'Rarible',
  zora:          'Zora',
  magiceden:     'Magic Eden',
};

/**
 * Fetch the most recent sale for a specific token from the OpenSea Events API.
 * Returns null if no sale was found within the last 10 minutes.
 *
 * @param {string} contractAddress
 * @param {string} tokenId          Decimal string (not hex)
 * @param {string} alchemyNetwork   e.g. 'ETH_MAINNET'
 * @returns {Promise<object|null>}
 */
async function fetchRecentSale(contractAddress, tokenId, alchemyNetwork) {
  // Short-circuit for chains OpenSea doesn't index
  if (OPENSEA_UNSUPPORTED.has(alchemyNetwork)) {
    console.log(`${alchemyNetwork} is not indexed by OpenSea — will tweet without price.`);
    return null;
  }

  const apiKey = process.env.OPENSEA_API_KEY;
  if (!apiKey) throw new Error('Missing OPENSEA_API_KEY');

  const chain = NETWORK_TO_CHAIN[alchemyNetwork] ?? 'ethereum';
  const url   = `https://api.opensea.io/api/v2/events/chain/${chain}/contract/${contractAddress}/nfts/${tokenId}?event_type=sale&limit=1`;

  const res = await fetch(url, {
    headers: { 'x-api-key': apiKey },
    signal:  AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    throw new Error(`OpenSea API responded ${res.status}`);
  }

  const body   = await res.json();
  const events = body?.asset_events;
  if (!events || events.length === 0) return null;

  const event = events[0];

  // Only return the event if it happened in the last 10 minutes
  const saleDateMs    = event.closing_date * 1000;
  const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
  if (saleDateMs < tenMinutesAgo) {
    console.log('Most recent OpenSea sale is older than 10 minutes — skipping.');
    return null;
  }

  // ── Parse payment amount ───────────────────────────────────────────────────
  const payment  = event.payment ?? {};
  const decimals = payment.decimals ?? 18;
  const ethPrice = Number(payment.quantity ?? 0) / Math.pow(10, decimals);
  const currency = payment.symbol ?? 'ETH';

  // ── Token metadata from OpenSea ───────────────────────────────────────────
  const nft        = event.nft ?? {};
  const tokenName  = nft.name || `#${tokenId}`;
  const imageUrl   = nft.image_url || nft.display_image_url || null;
  const openSeaUrl = nft.opensea_url || null;
  const txHash     = event.transaction || null;

  // ── Marketplace ───────────────────────────────────────────────────────────
  const marketplaceId  = event.event_type === 'sale' ? (event.order_source ?? 'opensea') : 'opensea';
  const marketplaceName = MARKETPLACE_NAMES[marketplaceId] ?? marketplaceId;

  const saleLink = openSeaUrl
    ?? buildFallbackLink(chain, contractAddress, tokenId, txHash);

  return {
    tokenName,
    imageUrl,
    ethPrice,
    currency,
    marketplace: marketplaceName,
    saleLink,
    txHash,
  };
}

function buildFallbackLink(chain, contract, tokenId, txHash) {
  if (chain === 'ethereum' && txHash) return `https://etherscan.io/tx/${txHash}`;
  if (chain === 'base'     && txHash) return `https://basescan.org/tx/${txHash}`;
  return `https://opensea.io/assets/${chain}/${contract}/${tokenId}`;
}

/**
 * Build an explorer link for chains not supported by OpenSea.
 */
function buildChainExplorerLink(alchemyNetwork, contract, tokenId, txHash) {
  if (alchemyNetwork === 'SHAPE_MAINNET') {
    return txHash
      ? `https://shapescan.xyz/tx/${txHash}`
      : `https://shapescan.xyz/token/${contract}?a=${tokenId}`;
  }
  return txHash ? `https://etherscan.io/tx/${txHash}` : null;
}

module.exports = { fetchRecentSale, buildChainExplorerLink, OPENSEA_UNSUPPORTED };
