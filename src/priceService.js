/**
 * ETH → USD price.
 *
 * Two independent sources, because the dollar figure goes into a public,
 * permanent tweet and there is no correcting it afterwards:
 *
 *   1. CoinGecko — free, no key, a live spot price. Retried, because one slow
 *      response used to be the end of it, and the free tier rate-limits as a
 *      matter of course.
 *   2. Chainlink's ETH/USD feed on Ethereum mainnet — read straight off the
 *      chain through the RPC the bot already uses to price mints. No account,
 *      no key, nothing to rate-limit and nothing to rotate. It refreshes on an
 *      hourly heartbeat or a 0.5% move, so it can lag slightly; that is why it
 *      is the backup rather than the first choice.
 *
 * Then a stale cached price, and only then nothing.
 *
 * Returning null means "I do not know" and the caller leaves the figure out of
 * the tweet. It must never mean zero: that is a claim the piece sold for
 * nothing, and it was published as "1.69 ETH ($0.00)" until 2026-08-19.
 */

const { ethCall } = require('./chainService');

let cachedPrice = null;
let cacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd';
const COINGECKO_ATTEMPTS = 3;
const COINGECKO_TIMEOUT_MS = 8000;
const COINGECKO_RETRY_MS = 2000;

// Chainlink ETH/USD aggregator, Ethereum mainnet. latestRoundData() = 0xfeaf968c.
// The feed reports 8 decimals and has never changed that.
const CHAINLINK_ETH_USD = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419';
const LATEST_ROUND_DATA = '0xfeaf968c';
const CHAINLINK_DECIMALS = 100000000n;
// The heartbeat is one hour. Well past that means the feed is not being
// updated, and a price nobody is maintaining is not one to publish.
const CHAINLINK_MAX_AGE_MS = 6 * 60 * 60 * 1000;

// A decoding mistake would publish a wildly wrong figure — the one outcome
// worse than publishing none. Anything outside this band is refused whichever
// source produced it.
const PLAUSIBLE_MIN_USD = 10;
const PLAUSIBLE_MAX_USD = 100000;

function plausible(value, source) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < PLAUSIBLE_MIN_USD || value > PLAUSIBLE_MAX_USD) {
    console.warn(`${source} returned an implausible ETH price (${value}) — refusing it.`);
    return null;
  }
  return value;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Live spot price. null if it could not be read. */
async function fromCoinGecko() {
  for (let attempt = 1; attempt <= COINGECKO_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(COINGECKO_URL, {
        signal: AbortSignal.timeout(COINGECKO_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`responded ${res.status}`);
      const data = await res.json();
      const price = plausible(data?.ethereum?.usd, 'CoinGecko');
      if (price !== null) return price;
    } catch (err) {
      console.warn(`CoinGecko attempt ${attempt}/${COINGECKO_ATTEMPTS} failed: ${err.message}`);
    }
    if (attempt < COINGECKO_ATTEMPTS) await sleep(COINGECKO_RETRY_MS);
  }
  return null;
}

/** The price the chain itself publishes. null if it could not be read. */
async function fromChainlink() {
  try {
    // Always Ethereum mainnet: the feed lives there whatever chain the sale
    // happened on.
    const raw = await ethCall(CHAINLINK_ETH_USD, LATEST_ROUND_DATA, 'ETH_MAINNET');
    if (typeof raw !== 'string' || raw.length < 2 + 64 * 5) {
      console.warn('Chainlink returned nothing usable.');
      return null;
    }

    const words = raw.slice(2);
    const word = (i) => BigInt('0x' + words.slice(i * 64, (i + 1) * 64));

    // latestRoundData(): roundId, answer, startedAt, updatedAt, answeredInRound
    const answer = word(1);
    const updatedAt = Number(word(3)) * 1000;

    const ageMs = Date.now() - updatedAt;
    if (!Number.isFinite(updatedAt) || ageMs > CHAINLINK_MAX_AGE_MS) {
      console.warn(`Chainlink price is ${Math.round(ageMs / 3600000)}h old — refusing it.`);
      return null;
    }

    const price = plausible(Number(answer) / Number(CHAINLINK_DECIMALS), 'Chainlink');
    if (price !== null) console.log(`ETH price from Chainlink: $${price}`);
    return price;
  } catch (err) {
    console.warn('Chainlink price lookup failed:', err.message);
    return null;
  }
}

/**
 * @returns {Promise<number|null>} USD per ETH, or null if genuinely unknown.
 */
async function fetchEthUsdPrice() {
  const now = Date.now();
  if (cachedPrice && now - cacheTime < CACHE_TTL_MS) return cachedPrice;

  const live = (await fromCoinGecko()) ?? (await fromChainlink());
  if (live !== null) {
    cachedPrice = live;
    cacheTime = now;
    return live;
  }

  // A stale price is still a real price, and better than no figure at all.
  if (cachedPrice !== null) {
    console.warn(
      `Both price sources failed — using the last known price ($${cachedPrice}, ` +
      `${Math.round((now - cacheTime) / 60000)} min old).`
    );
    return cachedPrice;
  }

  console.error('Could not establish an ETH price from any source — the tweet will omit it.');
  return null;
}

module.exports = { fetchEthUsdPrice };
