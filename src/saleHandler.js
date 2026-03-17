/**
 * Core sale processing logic.
 * Receives a Reservoir sale event, fetches artwork + price, then tweets.
 */

const { fetchEthUsdPrice } = require('./priceService');
const { downloadImageBuffer } = require('./imageService');
const { postSaleTweet } = require('./twitterService');

/**
 * Reservoir sale event data shape (simplified):
 * {
 *   sale: {
 *     token: { tokenId, name, image, contract, collection: { name } },
 *     price: { amount: { decimal, usd }, currency: { symbol } },
 *     orderSource: 'opensea.io' | 'blur.io' | 'foundation.app' | etc.
 *     txHash,
 *   }
 * }
 */
async function handleSaleEvent(data) {
  const sale = data?.sale;
  if (!sale) {
    console.warn('Received event with no sale data, skipping.');
    return;
  }

  const token = sale.token;
  const priceInfo = sale.price;

  // ── Extract sale details ───────────────────────────────────────────────────
  const tokenName    = token.name || `#${token.tokenId}`;
  const collection   = token.collection?.name || 'Unknown Collection';
  const contractAddr = token.contract;
  const tokenId      = token.tokenId;
  const marketplace  = formatMarketplace(sale.orderSource);
  const ethPrice     = priceInfo?.amount?.decimal ?? 0;
  const imageUrl     = token.image;
  const txHash       = sale.txHash;

  // ── Get USD value ──────────────────────────────────────────────────────────
  // Reservoir sometimes includes usd directly; fall back to live price lookup
  let usdPrice = priceInfo?.amount?.usd;
  if (!usdPrice) {
    const ethUsd = await fetchEthUsdPrice();
    usdPrice = ethPrice * ethUsd;
  }

  console.log(
    `Sale detected: ${collection} ${tokenName} — ` +
    `${ethPrice} ETH ($${usdPrice.toFixed(2)}) on ${marketplace}`
  );

  // ── Download the artwork image ─────────────────────────────────────────────
  let imageBuffer = null;
  if (imageUrl) {
    imageBuffer = await downloadImageBuffer(imageUrl);
  }

  // ── Build the marketplace link ─────────────────────────────────────────────
  const saleLink = buildSaleLink(sale.orderSource, contractAddr, tokenId, txHash);

  // ── Post to Twitter ────────────────────────────────────────────────────────
  await postSaleTweet({
    tokenName,
    collection,
    ethPrice,
    usdPrice,
    marketplace,
    saleLink,
    imageBuffer,
  });
}

/**
 * Convert an orderSource domain into a readable marketplace name.
 */
function formatMarketplace(source) {
  if (!source) return 'a marketplace';
  const map = {
    'opensea.io':        'OpenSea',
    'blur.io':           'Blur',
    'foundation.app':    'Foundation',
    'manifold.xyz':      'Manifold',
    'superrare.com':     'SuperRare',
    'rarible.com':       'Rarible',
    'looksrare.org':     'LooksRare',
    'x2y2.io':           'X2Y2',
    'magiceden.io':      'Magic Eden',
    'zora.co':           'Zora',
  };
  return map[source] || source;
}

/**
 * Build a link to the sale or token on the relevant marketplace.
 */
function buildSaleLink(source, contract, tokenId, txHash) {
  // Etherscan tx link as a fallback (works for any marketplace)
  const etherscanLink = txHash
    ? `https://etherscan.io/tx/${txHash}`
    : null;

  const map = {
    'opensea.io':     `https://opensea.io/assets/ethereum/${contract}/${tokenId}`,
    'blur.io':        `https://blur.io/asset/${contract}/${tokenId}`,
    'foundation.app': `https://foundation.app/mint/${contract}/${tokenId}`,
    'zora.co':        `https://zora.co/collect/eth:${contract}/${tokenId}`,
    'superrare.com':  `https://superrare.com/artwork-v2/${tokenId}`,
  };

  return map[source] || etherscanLink || `https://etherscan.io/token/${contract}?a=${tokenId}`;
}

module.exports = { handleSaleEvent };
