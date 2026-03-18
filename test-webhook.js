/**
 * Test script: sends a signed fake NFT_ACTIVITY webhook to your Railway bot.
 *
 * Usage:
 *   node test-webhook.js <signing-key> [webhook-url]
 *
 * Example:
 *   node test-webhook.js abc123yoursigningkey https://bot.apocalypse.art/webhook
 *
 * What it does:
 *   - Builds a fake ETH_MAINNET NFT_ACTIVITY payload
 *   - Signs it with your Alchemy signing key (HMAC-SHA256)
 *   - POSTs it to your Railway bot
 *
 * Expected result:
 *   - Bot logs the transfer, waits 45s, queries OpenSea, finds nothing, logs
 *     "No recent sale found on OpenSea — skipping." No tweet is posted.
 *   - That's fine — it confirms auth + webhook routing works end-to-end.
 */

const crypto = require('crypto');
const https  = require('https');
const http   = require('http');

const signingKey  = process.argv[2];
const webhookUrl  = process.argv[3] || 'https://bot.apocalypse.art/webhook';

if (!signingKey) {
  console.error('Usage: node test-webhook.js <signing-key> [webhook-url]');
  console.error('Example: node test-webhook.js abc123yoursigningkey');
  process.exit(1);
}

// Fake but realistic-looking NFT activity payload
const payload = {
  type: 'NFT_ACTIVITY',
  event: {
    network: 'ETH_MAINNET',
    activity: [
      {
        fromAddress:     '0x1111111111111111111111111111111111111111',
        toAddress:       '0x2222222222222222222222222222222222222222',
        contractAddress: '0x3333333333333333333333333333333333333333',
        erc721TokenId:   '0x1',   // token ID 1
        category:        'token',
        log: {
          transactionHash: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        },
      },
    ],
  },
};

const body      = JSON.stringify(payload);
const rawBody   = Buffer.from(body);
const hmac      = crypto.createHmac('sha256', signingKey);
const signature = hmac.update(rawBody).digest('hex');

console.log('Sending test webhook to:', webhookUrl);
console.log('Payload size:', rawBody.length, 'bytes');
console.log('Signature:', signature.substring(0, 16) + '...');
console.log('');

const url      = new URL(webhookUrl);
const lib      = url.protocol === 'https:' ? https : http;
const options  = {
  hostname: url.hostname,
  port:     url.port || (url.protocol === 'https:' ? 443 : 80),
  path:     url.pathname,
  method:   'POST',
  headers:  {
    'Content-Type':          'application/json',
    'Content-Length':        rawBody.length,
    'x-alchemy-signature':   signature,
  },
};

const req = lib.request(options, (res) => {
  console.log('HTTP status:', res.statusCode);
  if (res.statusCode === 200) {
    console.log('✓ Webhook accepted! Check your Railway logs — the bot will');
    console.log('  wait ~45s, query OpenSea, then log "No recent sale found".');
    console.log('  If you see that log, everything is wired up correctly.');
  } else {
    console.log('✗ Unexpected status. Check Railway logs for details.');
  }
});

req.on('error', (err) => {
  console.error('Request failed:', err.message);
});

req.write(rawBody);
req.end();
