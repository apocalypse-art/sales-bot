#!/usr/bin/env node
/**
 * Verifies ALCHEMY_RPC_URL:
 *   1. that it responds, and
 *   2. that it points at Ethereum Mainnet (chainId 1).
 *
 * Prints only non-secret info — never the URL or the API key (the key lives in
 * the URL path, which is never logged; only the host is shown).
 *
 * Run against your Railway value:   railway run node scripts/verify-rpc.js
 * Or locally in your own terminal:   ALCHEMY_RPC_URL="https://..." node scripts/verify-rpc.js
 */

const url = process.env.ALCHEMY_RPC_URL;
if (!url) {
  console.error('❌ ALCHEMY_RPC_URL is not set in this environment.');
  process.exit(1);
}

let host;
try { host = new URL(url).host; } catch { host = '(unparseable URL)'; }

const CHAINS = {
  '0x1':    'Ethereum Mainnet',
  '0x2105': 'Base',
  '0x168':  'Shape',
  '0xa':    'Optimism',
  '0xa4b1': 'Arbitrum One',
  '0x89':   'Polygon',
};

async function rpc(method, params = []) {
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal:  AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`RPC error: ${body.error.message}`);
  return body.result;
}

(async () => {
  console.log(`Endpoint host: ${host}`); // safe: the key is in the path, not the host
  try {
    const chainId = await rpc('eth_chainId');
    const block   = await rpc('eth_blockNumber');
    const name    = CHAINS[chainId] ?? `unknown (chainId ${chainId})`;
    console.log(`✅ Connected. Network: ${name}. Latest block: ${parseInt(block, 16)}`);

    if (chainId !== '0x1') {
      console.log('⚠️  NOT Ethereum Mainnet — your ETH contracts need the eth-mainnet endpoint.');
      console.log('    Fix: set ALCHEMY_RPC_URL to https://eth-mainnet.g.alchemy.com/v2/<your key>');
      process.exit(2);
    }
    console.log('🎉 Correct network for your Ethereum contracts — marketplace lookups will work.');
  } catch (err) {
    console.error(`❌ Request failed: ${err.message}`);
    console.error('   Check the value is the full https://eth-mainnet.g.alchemy.com/v2/<key> with a valid key and no trailing space.');
    process.exit(1);
  }
})();
