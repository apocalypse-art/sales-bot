# Cryptoart Sales Bot

Automatically tweets whenever one of your NFT contracts has a primary or secondary sale — on any marketplace (OpenSea, Blur, Foundation, Zora, etc.).

Each tweet includes the artwork image, sale price in ETH and USD, and a link to the sale.

---

## How it works

```
Your contract sells on any marketplace
        ↓
Alchemy detects the on-chain NFT transfer
        ↓
Alchemy sends a webhook to this bot
        ↓
Bot waits ~45s, then asks OpenSea for the sale price & marketplace
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

### Step 2 — OpenSea API key

OpenSea is used to look up the sale price once a transfer is detected.

1. Go to [docs.opensea.io/reference/api-keys](https://docs.opensea.io/reference/api-keys)
2. Click **Request API Key** and fill in the short form (approval is usually instant).
3. Copy the key — this goes in `OPENSEA_API_KEY`.

---

### Step 3 — Alchemy account

Alchemy watches your contracts on-chain and notifies the bot the moment a token is transferred (i.e. sold).

1. Go to [dashboard.alchemy.com](https://dashboard.alchemy.com) and create a free account.
2. Click **Create new app** → give it any name → select the chain your contracts are on (Ethereum Mainnet for most NFTs; also available: Base, Optimism, etc.).
3. In the left sidebar, click **Notify** → **Webhooks** → **Create Webhook**.
4. Choose webhook type: **NFT Activity**.
5. Add each of your contract addresses.
6. Set the **Webhook URL** to blank for now — you'll fill this in after Step 4.
7. After creating the webhook, click on it to see the **Signing Key** — copy it into `ALCHEMY_SIGNING_KEY`.

---

### Step 4 — Deploy to Railway

Railway hosts the bot 24/7 on a free tier (500 hours/month on the Hobby plan).

1. Go to [railway.app](https://railway.app) and sign up with GitHub.
2. Click **New Project → Deploy from GitHub repo** and select this repo.
3. Once deployed, go to **Settings → Networking → Generate Domain** — this gives you a public URL like `https://your-app.railway.app`.
4. Go to **Variables** and add all variables from `.env.example` with your real values.
5. Railway will automatically restart the bot with the new variables.

---

### Step 5 — Finish the Alchemy webhook

Now that you have a Railway URL:

1. Go back to your Alchemy webhook and set the **Webhook URL** to:
   ```
   https://your-app.railway.app/webhook
   ```
2. Save it.

That's it. The bot is live.

---

## Adding or removing contracts

Go to your Alchemy webhook settings and add/remove contract addresses at any time. No code changes needed.

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

To send a test webhook, use a tool like [Postman](https://postman.com) or `curl`.
Note: leave `ALCHEMY_SIGNING_KEY` blank in your `.env` while testing locally so signature verification is skipped.

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "type": "NFT_ACTIVITY",
    "event": {
      "network": "ETH_MAINNET",
      "activity": [
        {
          "fromAddress": "0x1111111111111111111111111111111111111111",
          "toAddress":   "0x2222222222222222222222222222222222222222",
          "contractAddress": "0xYOUR_CONTRACT_ADDRESS",
          "erc721TokenId": "0x1",
          "category": "token",
          "log": { "transactionHash": "0xabc123" }
        }
      ]
    }
  }'
```

The bot will wait 45 seconds then query OpenSea for the sale. If there's no real sale on OpenSea for that token, it will log "No recent sale found" and skip the tweet — which is the correct behaviour.

---

## File structure

```
src/
  index.js          — Express server, receives Alchemy webhooks
  saleHandler.js    — Orchestrates the pipeline per transfer
  openSeaService.js — Looks up sale price & marketplace from OpenSea
  twitterService.js — Uploads image + posts tweet
  imageService.js   — Downloads & converts NFT artwork to JPEG
  priceService.js   — Fetches live ETH/USD price from CoinGecko
.env.example        — Template for your credentials
```

---

## Supported marketplaces

OpenSea · Blur · Foundation · Zora · SuperRare · Rarible · LooksRare · Magic Eden · X2Y2 · and any other marketplace that OpenSea indexes.
