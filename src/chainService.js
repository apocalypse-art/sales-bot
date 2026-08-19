/**
 * JSON-RPC chain access.
 *
 * Shared by marketplaceService (which contract settled a sale) and
 * mintService (what a primary-sale mint actually cost). Every call degrades
 * to null on failure so a missing RPC never blocks a tweet.
 */

// Which JSON-RPC endpoint to use per Alchemy network.
// ETH mainnet uses your Alchemy app; Shape has a public RPC that needs no key.
const RPC_URLS = {
  ETH_MAINNET:   process.env.ALCHEMY_RPC_URL,
  SHAPE_MAINNET: process.env.SHAPE_RPC_URL || 'https://mainnet.shape.network',
};

async function rpcCall(network, method, params) {
  const rpcUrl = RPC_URLS[network];
  if (!rpcUrl) return null;

  try {
    const res = await fetch(rpcUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal:  AbortSignal.timeout(10000),
    });

    if (!res.ok) throw new Error(`RPC responded ${res.status}`);

    const body = await res.json();
    if (body.error) throw new Error(body.error.message ?? 'RPC error');
    return body.result ?? null;
  } catch (err) {
    console.warn(`RPC ${method} failed on ${network}:`, err.message);
    return null;
  }
}

/** Full transaction object (value, to, from, input) — or null. */
function fetchTransaction(txHash, network) {
  if (!txHash) return Promise.resolve(null);
  return rpcCall(network, 'eth_getTransactionByHash', [txHash]);
}

/** Transaction receipt (logs, status) — or null. */
function fetchTransactionReceipt(txHash, network) {
  if (!txHash) return Promise.resolve(null);
  return rpcCall(network, 'eth_getTransactionReceipt', [txHash]);
}

module.exports = { fetchTransaction, fetchTransactionReceipt, RPC_URLS };
