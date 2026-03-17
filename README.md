# Cryptoart Sales Bot

Automatically tweets whenever one of your NFT contracts has a primary or secondary sale — on any marketplace (OpenSea, Blur, Foundation, Zora, etc.).

Each tweet includes the artwork image, sale price in ETH and USD, and a link to the sale.

---

## How it works

```
Your contract sells on any marketplace
        ↓
Reservoir detects the on-chain sale
        ↓
Reservoir sends a webhook to this bot
        ↓
Bot fetches the artwork image
Bot fetches current ETH/USD price
        ↓
Bot posts to your X/Twitter account
```

---

## One-time setup (do this once, takes ~30 minutes)

### Step 1 — Twitter / X Developer account

1. Go to [developer.twitter.com](https://developer.twitter.com) and sign in with your **art account**.
2. Apply for a developer account (choose "Build something for myself").
3. Once approved, go to the **Developer Portal → Projects & Apps → Create App**.
4. Under **App Settings → User authentication settings**:
   - Enable OAuth 1.0a
   - Set App permissions to **Read and Write**
5. Go to **Keys and Tokens** and collect all four values:
   - API Key → `TWITTER_APP_KEY`
   - API Key Secret → `TWITTER_APP_SECRET`
   - Access Token → `TWITTER_ACCESS_TOKEN`
   - Access Token Secret → `TWITTER_ACCESS_SECRET`

> **Important:** The Access Token and Secret must be generated *after* you set Read+Write permissions, otherwise the bot can only read tweets, not post them.

---

### Step 2 — Reservoir account

Reservoir is a free service that tracks NFT sales across every major marketplace.

1. Go to [reservoir.tools](https://reservoir.tools) and create a free account.
2. Go to **API Keys** and create a key (free tier is fine).
3. Go to **Webhooks** → **Create Webhook**:
   - **Event type:** `sale.created`
   - **Filter by contract:** Add each of your contract addresses (one per line)
   - **Endpoint URL:** Leave blank for now — you'll fill this in after Step 3
   - **Secret:** Create any random string and save it — this goes in `RESERVOIR_WEBHOOK_SECRET`

---

### Step 3 — Deploy to Railway

Railway hosts the bot 24/7 for free (up to 500 hours/month on the Hobby plan).

1. Go to [railway.app](https://railway.app) and sign up with GitHub.
2. Click **New Project → Deploy from GitHub repo** and select this repo.
3. Once deployed, go to **Settings → Networking → Generate Domain** — this gives you a public URL like `https://your-app.railway.app`.
4. Go to **Variables** and add all five environment variables from `.env.example` with your real values.
5. Railway will automatically restart the bot with the new variables.

---

### Step 4 — Finish the Reservoir webhook

Now that you have a Railway URL:

1. Go back to your Reservoir webhook and set the **Endpoint URL** to:
   ```
   https://your-app.railway.app/webhook
   ```
2. Save the webhook.

That's it. The bot is live.

---

## Adding or removing contracts

Go to your Reservoir webhook settings and add/remove contract addresses at any time. No code changes needed.

---

## Testing locally

```bash
# 1. Install dependencies
npm install

# 2. Copy the example env file and fill in your credentials
cp .env.example .env
# (edit .env with your real keys)

# 3. Start the bot
npm run dev
```

To send a test webhook, use a tool like [Postman](https://postman.com) or `curl`:

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "type": "sale.created",
    "data": {
      "sale": {
        "token": {
          "tokenId": "1",
          "name": "Test Artwork #1",
          "image": "https://picsum.photos/800/800",
          "contract": "0x0000000000000000000000000000000000000000",
          "collection": { "name": "Test Collection" }
        },
        "price": {
          "amount": { "decimal": 0.5, "usd": 1250.00 },
          "currency": { "symbol": "ETH" }
        },
        "orderSource": "opensea.io",
        "txHash": "0xabc123"
      }
    }
  }'
```

---

## File structure

```
src/
  index.js          — Express server, receives webhooks
  saleHandler.js    — Parses sale events, orchestrates the pipeline
  twitterService.js — Uploads image + posts tweet
  imageService.js   — Downloads & converts NFT artwork to JPEG
  priceService.js   — Fetches live ETH/USD price from CoinGecko
.env.example        — Template for your credentials
```

---

## Supported marketplaces

OpenSea · Blur · Foundation · Zora · Manifold · SuperRare · Rarible · LooksRare · Magic Eden · X2Y2 · and any other marketplace indexed by Reservoir.
