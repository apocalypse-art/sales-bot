/**
 * Cryptoart Sales Bot
 * Listens for NFT sales via Reservoir webhooks and posts to X/Twitter.
 */

require('dotenv').config();
const express = require('express');
const { handleSaleEvent } = require('./saleHandler');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ─── Health check (Railway uses this to verify the app is running) ────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', bot: 'cryptoart-sales-bot' });
});

// ─── Reservoir webhook endpoint ───────────────────────────────────────────────
// You'll point your Reservoir webhook at: https://your-app.railway.app/webhook
app.post('/webhook', async (req, res) => {
  // Acknowledge receipt immediately so Reservoir doesn't time out
  res.sendStatus(200);

  const secret = process.env.RESERVOIR_WEBHOOK_SECRET;
  if (secret && req.headers['x-reservoir-signature'] !== secret) {
    console.warn('Rejected webhook: invalid signature');
    return;
  }

  const events = Array.isArray(req.body) ? req.body : [req.body];

  for (const event of events) {
    // Reservoir sends different event types; we only care about sales
    if (event.type !== 'sale.created') continue;

    try {
      await handleSaleEvent(event.data);
    } catch (err) {
      console.error('Error handling sale event:', err.message);
    }
  }
});

app.listen(PORT, () => {
  console.log(`Sales bot listening on port ${PORT}`);
  console.log(`Webhook URL: POST /webhook`);
});
