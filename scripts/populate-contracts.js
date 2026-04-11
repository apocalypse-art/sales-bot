#!/usr/bin/env node

/**
 * Generate src/contracts.js from "Contract names 2026.csv".
 *
 * Reads the CSV, calls name() on each contract to get the on-chain name,
 * and writes the result to src/contracts.js.
 *
 * Usage:  node scripts/populate-contracts.js
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const CSV_PATH = path.join(__dirname, '..', 'Contract names 2026.csv');
const OUT_PATH = path.join(__dirname, '..', 'src', 'contracts.js');

const RPC_URLS = {
  ETH:   'https://ethereum-rpc.publicnode.com',
  SHAPE: 'https://mainnet.shape.network',
};

const NAME_SELECTOR = '0x06fdde03';

function rpcCall(rpcUrl, addr) {
  return new Promise((resolve, reject) => {
    const url  = new URL(rpcUrl);
    const body = JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'eth_call',
      params: [{ to: addr, data: NAME_SELECTOR }, 'latest'],
    });
    const req = https.request({
      hostname: url.hostname,
      path:     url.pathname,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json' },
      timeout:  10000,
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch (e) { reject(new Error('Invalid JSON from RPC')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('RPC timeout')); });
    req.write(body);
    req.end();
  });
}

function decodeString(hex) {
  if (!hex || hex === '0x') return '';
  const raw    = hex.slice(2);
  const length = parseInt(raw.slice(64, 128), 16);
  const bytes  = raw.slice(128, 128 + length * 2);
  return Buffer.from(bytes, 'hex').toString('utf8');
}

function parseCSV(text) {
  const lines = text.trim().split('\n');
  // Skip header row
  return lines.slice(1).map(line => {
    const parts = line.split(',');
    // CSV columns: Studio Name, Contract Abbrev, type, chain, contract address
    return {
      name:    parts[0].trim(),
      abbrev:  parts[1]?.trim() || '',
      type:    parts[2]?.trim() || '721',
      chain:   parts[3]?.trim().toUpperCase() || 'ETH',
      address: parts[4]?.trim().toLowerCase() || '',
    };
  }).filter(e => e.address);
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`CSV not found: ${CSV_PATH}`);
    process.exit(1);
  }

  const entries = parseCSV(fs.readFileSync(CSV_PATH, 'utf8'));
  console.log(`Read ${entries.length} contract(s) from CSV\n`);

  const results = [];
  for (const entry of entries) {
    const rpcUrl = RPC_URLS[entry.chain] || RPC_URLS.ETH;
    try {
      const res = await rpcCall(rpcUrl, entry.address);
      const onChainName = decodeString(res.result);
      const match = entry.name === onChainName ? '✓' : '≠';
      console.log(`  ${entry.address}  ${entry.name}  →  ${onChainName || '(empty)'}  ${match}`);
      results.push({ ...entry, onChainName });
    } catch (err) {
      console.error(`  ${entry.address}  ERROR: ${err.message}`);
      results.push({ ...entry, onChainName: '' });
    }
  }

  // Group by chain for readability
  const ethContracts   = results.filter(r => r.chain === 'ETH');
  const shapeContracts = results.filter(r => r.chain === 'SHAPE');
  const otherContracts = results.filter(r => r.chain !== 'ETH' && r.chain !== 'SHAPE');

  function formatEntries(list) {
    return list.map(r => {
      const n  = r.name.replace(/'/g, "\\'");
      const oc = r.onChainName.replace(/'/g, "\\'");
      return `  '${r.address}': { name: '${n}', onChainName: '${oc}', type: '${r.type}' },`;
    }).join('\n');
  }

  let mapBody = '';
  if (ethContracts.length) {
    mapBody += '  // ── ETH Mainnet ────────────────────────────────────────────────────────────\n';
    mapBody += formatEntries(ethContracts) + '\n';
  }
  if (shapeContracts.length) {
    mapBody += '\n  // ── Shape ──────────────────────────────────────────────────────────────────\n';
    mapBody += formatEntries(shapeContracts) + '\n';
  }
  if (otherContracts.length) {
    mapBody += '\n  // ── Other ──────────────────────────────────────────────────────────────────\n';
    mapBody += formatEntries(otherContracts) + '\n';
  }

  const output = `/**
 * Registry of monitored contracts.
 *
 * Keys   — lowercased contract addresses
 * Values — { name, onChainName, type }
 *   name        — Manifold Studio display name
 *   onChainName — ERC-721/1155 name() return value
 *   type        — '721' or '1155'
 *
 * The bot will ignore webhook events from contracts not listed here.
 *
 * Generated from "Contract names 2026.csv" — do not edit by hand.
 * Re-generate with:  node scripts/populate-contracts.js
 */

const CONTRACTS = {
${mapBody}};

module.exports = CONTRACTS;
`;

  fs.writeFileSync(OUT_PATH, output, 'utf8');
  console.log(`\nWrote ${results.length} contract(s) to ${OUT_PATH}`);
}

main();
