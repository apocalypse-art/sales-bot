/**
 * Cryptoart Sales Bot
 * Listens for NFT transfers via Alchemy webhooks, looks up the sale on
 * OpenSea for price/marketplace data, then posts to X/Twitter.
 */

require('dotenv').config();
const crypto  = require('crypto');
const express = require('express');
const { handleAlchemyActivity, announceVerifiedSale } = require('./saleHandler');

const app = express();

// Capture raw body buffer — needed to verify Alchemy's HMAC signature
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; },
  strict: false,    // tolerate non-object/array JSON roots
}));
// Also accept plain-text bodies (Alchemy test pings sometimes omit Content-Type)
app.use(express.text({ type: '*/*' }));

const PORT = process.env.PORT || 3000;

// ─── Health check (Railway uses this to verify the app is running) ────────────
app.get('/', (_req, res) => {
  res.json({ status: 'ok', bot: 'cryptoart-sales-bot' });
});

// ─── Alchemy test URL check (so the "Test URL" button works) ───────────────
app.get('/webhook', (_req, res) => {
  res.sendStatus(200);
});

// ─── Alchemy webhook endpoint ─────────────────────────────────────────────────
// Point your Alchemy NFT Activity webhook at: https://your-app.railway.app/webhook
app.post('/webhook', async (req, res) => {
  // Acknowledge receipt immediately so Alchemy doesn't time out
  res.sendStatus(200);

  // ── Verify the request really came from Alchemy ───────────────────────────
  const signingKeys = [
    process.env.ALCHEMY_SIGNING_KEY_ETH,
    process.env.ALCHEMY_SIGNING_KEY_SHAPE,
    process.env.ALCHEMY_SIGNING_KEY, // fallback for single-key setups
  ].filter(Boolean);
  if (signingKeys.length > 0) {
    const signature = req.headers['x-alchemy-signature'];
    const valid = signingKeys.some(key => isValidAlchemySignature(req.rawBody, signature, key));
    if (!valid) {
      console.warn('Rejected webhook: invalid Alchemy signature');
      return;
    }
  }

  const body = req.body;

  // Alchemy wraps NFT_ACTIVITY events in body.event.activity (an array)
  if (body.type !== 'NFT_ACTIVITY') return;

  const activities = body.event?.activity ?? [];

  for (const activity of activities) {
    try {
      await handleAlchemyActivity(activity, body.event.network);
    } catch (err) {
      console.error('Error handling activity:', err.message);
    }
  }
});

// ─── Verified-sale announcement (The Oversoul) ───────────────────────────────
//
// The Oversoul's artwork is published to Arweave minutes to an hour AFTER the
// sale, so the chain is the wrong trigger for it: announcing on the mint
// webhook announces a placeholder. Its publish job calls this instead, once it
// has verified the token actually serves the real artwork.
//
// Unlike /webhook, this responds only AFTER the work is done. The caller marks
// the sale announced in its own database on a success response, so replying
// early and failing afterwards would record a tweet that was never sent — and
// nothing would ever retry it.
app.post('/announce-sale', async (req, res) => {
  // ── Kill switch ───────────────────────────────────────────────────────────
  // One environment variable on Railway stops this dead, with no deploy and no
  // code change. This path is new and it posts publicly and permanently; being
  // able to halt it in seconds is worth one `if`.
  if (process.env.OVERSOUL_ANNOUNCE_DISABLED === 'true') {
    console.warn('Announce request refused: OVERSOUL_ANNOUNCE_DISABLED is set.');
    return res.status(503).json({ ok: false, error: 'announcements disabled' });
  }

  const secret = process.env.SALES_BOT_SECRET;
  if (!secret) {
    // Refuse rather than accept unauthenticated posts. An endpoint that tweets
    // must never be reachable just because a secret was forgotten.
    console.error('Announce request refused: SALES_BOT_SECRET is not set.');
    return res.status(503).json({ ok: false, error: 'not configured' });
  }

  // ── Authenticate ──────────────────────────────────────────────────────────
  // HMAC over the raw body, the same shape as Alchemy's signature above.
  // Signing the body rather than checking a bare token means an intercepted
  // request cannot be edited to announce a different piece at a different price.
  const signature = req.headers['x-oversoul-signature'];
  if (!isValidBodySignature(req.rawBody, signature, secret)) {
    console.warn('Announce request rejected: bad signature.');
    return res.status(401).json({ ok: false, error: 'bad signature' });
  }

  // req.body can be a string here — the text middleware below the JSON one
  // catches bodies whose content-type is not application/json.
  let payload = req.body;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { payload = null; }
  }
  const tokenId = payload?.tokenId;
  const txHash = payload?.txHash;
  const name = payload?.name;
  if (tokenId == null || !txHash || !name) {
    return res.status(400).json({ ok: false, error: 'tokenId, txHash and name are required' });
  }

  try {
    const result = await announceVerifiedSale({
      tokenId,
      txHash,
      name,
      imageUrl: payload?.imageUrl ?? null,
      dryRun: payload?.dryRun === true || process.env.OVERSOUL_ANNOUNCE_DRY_RUN === 'true',
    });
    // 200 only when a tweet actually went out. Anything else is reported as
    // "accepted, nothing posted" so the caller can tell the difference.
    return res.status(result.posted ? 200 : 202).json({ ok: true, ...result });
  } catch (err) {
    // A failure here must leave the sale un-marked so the next hourly run
    // retries it. Say why, and answer 500 so the caller does not record success.
    console.error('Announce failed:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── HMAC-SHA256 signature verification ──────────────────────────────────────
function isValidAlchemySignature(rawBody, signature, signingKey) {
  if (!signature) return false;
  const hmac   = crypto.createHmac('sha256', signingKey);
  const digest = hmac.update(rawBody).digest('hex');
  return digest === signature;
}

/**
 * Same HMAC, compared in constant time.
 *
 * timingSafeEqual throws on a length mismatch, so the lengths are checked
 * first — and both sides are hex digests of a fixed width, so that check leaks
 * nothing an attacker does not already know.
 */
function isValidBodySignature(rawBody, signature, secret) {
  if (!signature || !rawBody) return false;
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(digest, 'utf8');
  const b = Buffer.from(String(signature), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

app.listen(PORT, () => {
  console.log(`Sales bot listening on port ${PORT} (Node ${process.version})`);
  console.log(`Webhook URL:  POST /webhook`);
  console.log(`Announce URL: POST /announce-sale`);
});
