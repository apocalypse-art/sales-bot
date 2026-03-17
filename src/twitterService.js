/**
 * Twitter/X posting service.
 * Uploads artwork image and posts a sale tweet.
 */

const { TwitterApi } = require('twitter-api-v2');

// Initialise the client once using credentials from .env
function getClient() {
  const required = [
    'TWITTER_APP_KEY',
    'TWITTER_APP_SECRET',
    'TWITTER_ACCESS_TOKEN',
    'TWITTER_ACCESS_SECRET',
  ];
  for (const key of required) {
    if (!process.env[key]) throw new Error(`Missing env var: ${key}`);
  }

  return new TwitterApi({
    appKey:        process.env.TWITTER_APP_KEY,
    appSecret:     process.env.TWITTER_APP_SECRET,
    accessToken:   process.env.TWITTER_ACCESS_TOKEN,
    accessSecret:  process.env.TWITTER_ACCESS_SECRET,
  });
}

/**
 * Post a sale tweet.
 *
 * @param {object} opts
 * @param {string}  opts.tokenName     e.g. "Apocalypse #12"
 * @param {number}  opts.ethPrice      e.g. 0.5
 * @param {number}  opts.usdPrice      e.g. 1234.56
 * @param {string}  opts.currency      e.g. "ETH" or "WETH"
 * @param {string}  opts.marketplace   e.g. "OpenSea"
 * @param {string}  opts.saleLink      URL to the sale / token page
 * @param {Buffer|null} opts.imageBuffer  Raw image bytes (or null if unavailable)
 */
async function postSaleTweet({ tokenName, ethPrice, usdPrice, currency = 'ETH', marketplace, saleLink, imageBuffer }) {
  const client = getClient();

  // ── Build tweet text ───────────────────────────────────────────────────────
  // ethPrice may be null for chains not indexed by OpenSea (e.g. Shape)
  const priceLines = (ethPrice != null)
    ? [``, `${formatEth(ethPrice)} ${currency}  ($${formatUsd(usdPrice)})`]
    : [];

  const tweetText = [
    `${tokenName} sold on ${marketplace}!`,
    ...priceLines,
    ``,
    saleLink,
  ].join('\n');

  console.log('Posting tweet:\n' + tweetText);

  // ── Upload image if available ──────────────────────────────────────────────
  let mediaId;
  if (imageBuffer) {
    try {
      // The v1 media upload endpoint is still required for image uploads
      mediaId = await client.v1.uploadMedia(imageBuffer, { mimeType: 'image/jpeg' });
      console.log('Image uploaded, mediaId:', mediaId);
    } catch (err) {
      console.warn('Image upload failed, posting without image:', err.message);
    }
  }

  // ── Post the tweet ─────────────────────────────────────────────────────────
  const tweetPayload = { text: tweetText };
  if (mediaId) {
    tweetPayload.media = { media_ids: [mediaId] };
  }

  const result = await client.v2.tweet(tweetPayload);
  console.log('Tweet posted! ID:', result.data.id);
  return result;
}

// ── Formatting helpers ─────────────────────────────────────────────────────────

function formatEth(value) {
  // Show up to 4 decimal places, stripping trailing zeros
  return parseFloat(value.toFixed(4)).toString();
}

function formatUsd(value) {
  // Comma-separated, 2 decimal places
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

module.exports = { postSaleTweet };
