/**
 * Marketplace identification.
 *
 * OpenSea's Events API does NOT reliably tell us which marketplace a sale
 * happened on (there is no "order_source" field, and it often omits the
 * protocol address for non-OpenSea sales). So we read the marketplace directly
 * from the chain: every marketplace settles its sales through a known contract,
 * and the sale transaction's `to` address is that contract. We map those
 * addresses to human-readable names.
 *
 * This is what lets us tell a Manifold private-sales-page sale (settled through
 * Manifold's own marketplace contract) apart from an OpenSea/Seaport sale.
 */

// Known marketplace settlement contracts, keyed by LOWERCASED address.
// A sale's transaction `to` address (or, as a fallback, OpenSea's
// protocol_address) is matched against this table.
//
// To add a marketplace: find the contract a buyer's purchase transaction is
// sent to (the "To" on Etherscan for a sale tx) and add it here, lowercased.
const MARKETPLACE_CONTRACTS = {
  // ── Manifold (custom / private sales pages settle here) ────────────────────
  '0x3a3548e060be10c2614d0a4cb0c03cc9093fd799': 'Manifold',   // Manifold Marketplace Core

  // ── OpenSea (Seaport — buyers call the Seaport contract directly) ──────────
  '0x0000000000000068f116a894984e2db1123eb395': 'OpenSea',    // Seaport 1.6
  '0x00000000000000adc04c56bf30ac9d3c0aaf14dc': 'OpenSea',    // Seaport 1.5
  '0x00000000000001ad428e4906ae43d8f9852d0dd6': 'OpenSea',    // Seaport 1.4
  '0x00000000006c3852cbef3e08e8df289169ede581': 'OpenSea',    // Seaport 1.1
};

// Which JSON-RPC endpoint to use per Alchemy network. Add more networks by
// adding another env var. If a network has no RPC configured, we simply skip
// the on-chain lookup and fall back gracefully (see identifyMarketplace).
const RPC_URLS = {
  ETH_MAINNET: process.env.ALCHEMY_RPC_URL,
};

/**
 * Identify the marketplace a sale happened on.
 *
 * Primary signal: the `to` address of the sale transaction (the marketplace
 * contract the buyer transacted with), fetched via JSON-RPC.
 * Fallback signal: OpenSea's protocol_address, when it happens to provide one.
 *
 * @param {string|null} txHash            The sale transaction hash
 * @param {string}      network           Alchemy network, e.g. 'ETH_MAINNET'
 * @param {string|null} protocolAddress   OpenSea's protocol_address, if any
 * @returns {Promise<string|null>}        Marketplace name, or null if unknown
 */
async function identifyMarketplace(txHash, network, protocolAddress = null) {
  // 1. On-chain: which contract settled this sale?
  const toAddress = await fetchTransactionTo(txHash, network);
  const fromChain = toAddress ? MARKETPLACE_CONTRACTS[toAddress.toLowerCase()] : null;
  if (fromChain) return fromChain;

  // 2. Fallback: OpenSea's protocol_address, if it gave us one.
  if (protocolAddress) {
    const fromOpenSea = MARKETPLACE_CONTRACTS[protocolAddress.toLowerCase()];
    if (fromOpenSea) return fromOpenSea;
  }

  // Unknown marketplace — caller should degrade gracefully rather than guess.
  return null;
}

/**
 * Fetch the `to` address of a transaction via JSON-RPC.
 * Returns null on any failure (missing RPC config, network error, tx not found)
 * so marketplace identification degrades gracefully instead of blocking a tweet.
 */
async function fetchTransactionTo(txHash, network) {
  const rpcUrl = RPC_URLS[network];
  if (!rpcUrl || !txHash) return null;

  try {
    const res = await fetch(rpcUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        jsonrpc: '2.0',
        id:      1,
        method:  'eth_getTransactionByHash',
        params:  [txHash],
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) throw new Error(`RPC responded ${res.status}`);

    const body = await res.json();
    return body?.result?.to ?? null;
  } catch (err) {
    console.warn('Marketplace on-chain lookup failed:', err.message);
    return null;
  }
}

module.exports = { identifyMarketplace, MARKETPLACE_CONTRACTS };
