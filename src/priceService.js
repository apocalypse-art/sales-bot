/**
 * ETH → USD price lookup via CoinGecko (free, no API key required).
 * Caches the price for 5 minutes to avoid hammering the API.
 */

const axios = require('axios');

let cachedPrice = null;
let cacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function fetchEthUsdPrice() {
  const now = Date.now();
  if (cachedPrice && now - cacheTime < CACHE_TTL_MS) {
    return cachedPrice;
  }

  try {
    const response = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price',
      {
        params: { ids: 'ethereum', vs_currencies: 'usd' },
        timeout: 5000,
      }
    );
    cachedPrice = response.data.ethereum.usd;
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
