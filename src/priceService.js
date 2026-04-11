/**
 * ETH → USD price lookup via CoinGecko (free, no API key required).
 * Caches the price for 5 minutes to avoid hammering the API.
 */

let cachedPrice = null;
let cacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function fetchEthUsdPrice() {
  const now = Date.now();
  if (cachedPrice && now - cacheTime < CACHE_TTL_MS) {
    return cachedPrice;
  }

  try {
    const url = 'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd';
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    cachedPrice = data.ethereum.usd;
    cacheTime = now;
    console.log(`ETH price refreshed: $${cachedPrice}`);
    return cachedPrice;
  } catch (err) {
    console.error('Failed to fetch ETH price:', err.message);
    // Return cached value even if stale, or a fallback of 0
    return cachedPrice ?? 0;
  }
}

module.exports = { fetchEthUsdPrice };
