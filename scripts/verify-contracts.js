#!/usr/bin/env node

/**
 * Verify that the names in src/contracts.js still match on-chain name().
 * Flags any discrepancies between your display name and the on-chain name.
 *
 * Usage:  node scripts/verify-contracts.js
 */

const https = require('https');
const CONTRACTS = require('../src/contracts');

const RPC_URL = 'https://eth.llamarpc.com';
const NAME_SELECTOR = '0x06fdde03';

function rpcCall(body) {
  return new Promise((resolve, reject) => {
    const url = new URL(RPC_URL);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON from RPC')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('RPC timeout')); });
    req.write(JSON.stringify(body));
    req.end();
  });
}

function decodeString(hex) {
  if (!hex || hex === '0x') return null;
  const raw    = hex.slice(2);
  const length = parseInt(raw.slice(64, 128), 16);
  const bytes  = raw.slice(128, 128 + length * 2);
  return Buffer.from(bytes, 'hex').toString('utf8');
}

async function main() {
  const addresses = Object.keys(CONTRACTS);
  if (addresses.length === 0) {
    console.log('No contracts in src/contracts.js — nothing to verify.');
    return;
  }

  console.log(`Verifying ${addresses.length} contract(s)…\n`);

  let mismatches = 0;
  for (const addr of addresses) {
    const entry = CONTRACTS[addr];
    try {
      const data = await rpcCall({
        jsonrpc: '2.0', id: 1,
        method: 'eth_call',
        params: [{ to: addr, data: NAME_SELECTOR }, 'latest'],
      });
      const live = decodeString(data.result) || '(empty)';
      const nameMatch   = entry.name === live ? '✓' : '≠';
      const onChainMatch = entry.onChainName === live ? '✓' : '≠';

      console.log(`  ${addr}`);
      console.log(`    name:         ${entry.name}  ${nameMatch}`);
      console.log(`    onChainName:  ${entry.onChainName}  ${onChainMatch}`);
      console.log(`    live:         ${live}`);

      if (entry.onChainName !== live) {
        console.log(`    ⚠  on-chain name has changed!`);
        mismatches++;
      }
      console.log();
    } catch (err) {
      console.error(`  ${addr} → ERROR: ${err.message}\n`);
      mismatches++;
    }
  }

  if (mismatches > 0) {
    console.log(`${mismatches} discrepancy(ies) found. Re-run populate-contracts.js to update.`);
    process.exit(1);
  } else {
    console.log('All contracts verified — no discrepancies.');
  }
}

main();
