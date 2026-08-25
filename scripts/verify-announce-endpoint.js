/**
 * Does POST /announce-sale actually work, and refuse what it should?
 *
 * Starts the real server on a spare port, with a known secret, and drives the
 * real endpoint over HTTP — real HMAC, real chain read for the price, real
 * 32 MB artwork download and conversion. Only the tweet is stubbed, via the
 * endpoint's own dry-run flag.
 *
 * 🪤 WHY THE REFUSAL CASES MATTER AS MUCH AS THE SUCCESS ONE. The bug this
 * whole pipeline exists to fix shipped through a test that passed: the sale was
 * announced correctly, because the test ran after the artwork had published, so
 * it could not have failed. A test that only proves the happy path proves
 * almost nothing. Every case below that expects a refusal is a case where
 * passing wrongly would be worse than failing.
 *
 *   node scripts/verify-announce-endpoint.js
 *
 * Posts nothing. Needs no credentials — it supplies its own, and uses a public
 * RPC rather than the Alchemy key.
 */

const crypto = require('crypto');
const { spawn } = require('child_process');

const SECRET = 'test-secret-not-a-real-one';
const PORT = 39117;
const BASE = `http://127.0.0.1:${PORT}`;

// A real, settled sale: Invitation #21 → piece 78 REMEMBERS, 2026-08-24.
const REAL_SALE = {
  tokenId: 21,
  txHash: '0x616457eb65acefaaae1001430e30c193002d327bbc7d504885582c15131929cb',
  name: 'REMEMBERS',
  imageUrl: 'https://arweave.net/BxcyOznx0bg1ihAuh_eECGMNc_rZowy-E263-ZoY8Js',
};

let failures = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok ? '' : `  — expected ${expected}, got ${actual}`}`);
  if (!ok) failures++;
}

function sign(body, secret = SECRET) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

async function post(payload, { signature, omitSignature = false } = {}) {
  const body = JSON.stringify(payload);
  const headers = { 'Content-Type': 'application/json' };
  if (!omitSignature) headers['x-oversoul-signature'] = signature ?? sign(body);
  const res = await fetch(`${BASE}/announce-sale`, { method: 'POST', headers, body });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON body */ }
  return { status: res.status, json };
}

function startServer(extraEnv = {}) {
  const child = spawn('node', ['src/index.js'], {
    cwd: `${__dirname}/..`,
    env: {
      ...process.env,
      PORT: String(PORT),
      SALES_BOT_SECRET: SECRET,
      // A public endpoint, so this test needs no Alchemy key.
      ALCHEMY_RPC_URL: 'https://ethereum-rpc.publicnode.com',
      // Deliberately absent: TWITTER_*. If the dry run ever stopped being a dry
      // run, postSaleTweet would throw on the missing credentials rather than
      // post — the test cannot accidentally tweet.
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.env.VERBOSE && process.stdout.write(`    [bot] ${d}`));
  child.stderr.on('data', (d) => process.env.VERBOSE && process.stdout.write(`    [bot] ${d}`));
  return child;
}

async function waitForServer(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function run(server, label, fn) {
  console.log(`\n${label}`);
  try {
    await fn();
  } finally {
    server.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function main() {
  // ── Normal configuration ──────────────────────────────────────────────────
  let server = startServer();
  if (!(await waitForServer())) {
    console.error('✗ server did not start');
    server.kill('SIGKILL');
    process.exit(1);
  }

  await run(server, 'Authentication:', async () => {
    check('no signature is refused', (await post(REAL_SALE, { omitSignature: true })).status, 401);
    check('wrong signature is refused', (await post(REAL_SALE, { signature: 'deadbeef' })).status, 401);
    check(
      'signature for a DIFFERENT body is refused',
      (await post(REAL_SALE, { signature: sign(JSON.stringify({ ...REAL_SALE, tokenId: 99 })) })).status,
      401
    );

    console.log('\nPayload validation:');
    check('missing name is refused', (await post({ tokenId: 21, txHash: REAL_SALE.txHash })).status, 400);
    check('missing txHash is refused', (await post({ tokenId: 21, name: 'REMEMBERS' })).status, 400);

    console.log('\nThe real thing (dry run — chain read, image download, no tweet):');
    const ok = await post({ ...REAL_SALE, dryRun: true });
    check('accepted', ok.status, 202);
    check('did not post', ok.json?.posted, false);
    check('reason is dry-run', ok.json?.reason, 'dry-run');
    check('used the name we sent', ok.json?.tokenName, 'REMEMBERS');
    check('read the price off the chain', ok.json?.ethPrice, 1.69);
    check('identified the marketplace', ok.json?.marketplace, 'Manifold');
    check('downloaded and converted the artwork', ok.json?.hasImage, true);
    if (ok.json?.usdPrice == null) {
      console.log('  ⚠ usdPrice was null — price feeds unreachable from here (not a failure)');
    } else {
      console.log(`  ✓ converted to USD ($${ok.json.usdPrice.toFixed(2)})`);
    }
  });

  // ── Kill switch ───────────────────────────────────────────────────────────
  server = startServer({ OVERSOUL_ANNOUNCE_DISABLED: 'true' });
  if (!(await waitForServer())) {
    console.error('✗ server did not start for the kill-switch case');
    server.kill('SIGKILL');
    process.exit(1);
  }
  await run(server, 'Kill switch:', async () => {
    check('refuses while disabled', (await post({ ...REAL_SALE, dryRun: true })).status, 503);
  });

  // ── Missing secret ────────────────────────────────────────────────────────
  server = startServer({ SALES_BOT_SECRET: '' });
  if (!(await waitForServer())) {
    console.error('✗ server did not start for the missing-secret case');
    server.kill('SIGKILL');
    process.exit(1);
  }
  await run(server, 'Unconfigured secret:', async () => {
    check('refuses rather than accepting unauthenticated posts',
      (await post({ ...REAL_SALE, dryRun: true })).status, 503);
  });

  console.log('');
  if (failures) {
    console.error(`🔴 ${failures} assertion(s) failed.`);
    process.exit(1);
  }
  console.log('✅ The endpoint announces what it should and refuses everything else.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
