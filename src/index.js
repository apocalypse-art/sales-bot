/**
 * Cryptoart Sales Bot
 * Listens for NFT transfers via Alchemy webhooks, looks up the sale on
 * OpenSea for price/marketplace data, then posts to X/Twitter.
 */

require('dotenv').config();
const crypto  = require('crypto');
const express = require('express');
const { handleAlchemyActivity } = require('./saleHandler');

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
  const signingKey = process.env.ALCHEMY_SIGNING_KEY;
  if (signingKey) {
    const signature = req.headers['x-alchemy-signature'];
    if (!isValidAlchemySignature(req.rawBody, signature, signingKey)) {
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

// ─── HMAC-SHA256 signature verification ──────────────────────────────────────
function isValidAlchemySignature(rawBody, signature, signingKey) {
  if (!signature) return false;
  const hmac   = crypto.createHmac('sha256', signingKey);
  const digest = hmac.update(rawBody).digest('hex');
  return digest === signature;
}

app.listen(PORT, () => {
  console.log(`Sales bot listening on port ${PORT}`);
  console.log(`Webhook URL: POST /webhook`);
});
