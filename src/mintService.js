/**
 * Primary-sale (mint) pricing.
 *
 * A Manifold claim-page sale mints the token straight to the buyer, so the
 * transfer's `from` is the zero address and OpenSea records no `sale` event
 * for it. That means the normal secondary-sale path (ask OpenSea for a price)
 * finds nothing. Instead we read what the buyer actually paid from the mint
 * transaction itself.
 *
 * Manifold charges a fixed per-token platform fee on top of the artist's
 * price, so the sale price is:  tx.value − (mint fee × tokens minted).
 */

const { fetchTransaction, fetchTransactionReceipt } = require('./chainService');

// Manifold's per-token platform fee, charged on top of the artist's price.
const MANIFOLD_MINT_FEE_WEI = 500000000000000n; // 0.0005 ETH

// Manifold's LazyPayableClaim extension contracts — the `to` of a claim-page
// mint transaction. Only addresses confirmed on-chain are listed; add more as
// they are observed (check the "To" of a mint tx on Etherscan).
const MANIFOLD_CLAIM_EXTENSIONS = new Set([
  '0x23aa05a271debffaa3d75739af5581f744b326e4', // ERC721LazyPayableClaim (confirmed Aug 2026)
]);

// Event signatures
const TRANSFER_721    = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const TRANSFER_SINGLE = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62';
const TRANSFER_BATCH  = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb';
const ZERO_TOPIC      = '0x0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Work out what a mint actually cost.
 *
 * @param {object} opts
 * @param {string} opts.txHash
 * @param {string} opts.contractAddress
 * @param {string} opts.network            Alchemy network, e.g. 'ETH_MAINNET'
 * @returns {Promise<object|null>}
 *   null                          — couldn't read the chain; caller should skip
 *   { isFree: true, ... }         — nothing was paid (airdrop / free claim)
 *   { ethPrice, quantity, settlementAddress } — a paid primary sale
 */
async function resolvePrimarySale({ txHash, contractAddress, network }) {
  const tx = await fetchTransaction(txHash, network);
  if (!tx) {
    console.warn('Could not fetch mint transaction — cannot tell a sale from an airdrop.');
    return null;
  }

  const valueWei = BigInt(tx.value ?? '0x0');
  const settlementAddress = tx.to ?? null;

  // Nothing paid at all — an airdrop or a transfer-in, not a sale.
  if (valueWei === 0n) return { isFree: true, quantity: 1, settlementAddress };

  const receipt = await fetchTransactionReceipt(txHash, network);
  if (receipt) {
    // A receipt we can actually read is the authority, and `status` is present
    // on every receipt since Byzantium — so a missing one is unexpected data,
    // not an old chain, and is not treated as success.
    if (receipt.status !== '0x1') {
      console.log(`Mint transaction did not succeed (status ${receipt.status ?? 'absent'}) — skipping.`);
      return null;
    }
  } else {
    // Failing to READ a receipt is not evidence the mint failed. Alchemy only
    // reports a transfer that actually happened, so carry on — but say so,
    // because the token count below is a guess without the logs.
    console.warn('Could not read the mint receipt — continuing on the webhook, with a token count of 1.');
  }

  // How many tokens did this transaction mint from our contract? A buyer can
  // claim several editions at once, and the fee is charged per token.
  const quantity = (receipt ? countMintedUnits(receipt, contractAddress) : 0) || 1;

  const isManifoldClaim = settlementAddress
    ? MANIFOLD_CLAIM_EXTENSIONS.has(settlementAddress.toLowerCase())
    : false;

  // Only subtract the platform fee when we know it was charged.
  let feeTotal = isManifoldClaim ? MANIFOLD_MINT_FEE_WEI * BigInt(quantity) : 0n;

  // If the fee for our token count exceeds what was actually paid, the count is
  // wrong. Fall back to a single token's fee rather than let a bad count push
  // netWei to zero and silently report a real sale as a free mint.
  if (feeTotal > valueWei) {
    console.warn(`Mint fee for ${quantity} token(s) exceeds the ${valueWei} wei paid — falling back to a single-token fee.`);
    feeTotal = isManifoldClaim ? MANIFOLD_MINT_FEE_WEI : 0n;
  }

  const netWei = valueWei - feeTotal;

  // Buyer paid the platform fee and nothing else — a free claim, not a sale.
  if (netWei <= 0n) return { isFree: true, quantity, settlementAddress };

  return {
    ethPrice: Number(netWei) / 1e18,
    quantity,
    settlementAddress,
    isFree: false,
  };
}

/**
 * Count how many tokens of `contractAddress` were minted (transferred from the
 * zero address) in this receipt. Handles ERC-721 and ERC-1155.
 */
function countMintedUnits(receipt, contractAddress) {
  const target = contractAddress?.toLowerCase();
  let units = 0n;

  for (const log of receipt.logs ?? []) {
    if (log.address?.toLowerCase() !== target) continue;
    const topics = log.topics ?? [];

    // ERC-721 Transfer(from indexed, to indexed, tokenId indexed)
    if (topics[0] === TRANSFER_721 && topics[1] === ZERO_TOPIC && topics.length === 4) {
      units += 1n;
      continue;
    }
    // ERC-1155 TransferSingle(operator indexed, from indexed, to indexed, id, value)
    if (topics[0] === TRANSFER_SINGLE && topics[2] === ZERO_TOPIC) {
      units += decodeWord(log.data, 1);
      continue;
    }
    // ERC-1155 TransferBatch(operator indexed, from indexed, to indexed, ids[], values[])
    if (topics[0] === TRANSFER_BATCH && topics[2] === ZERO_TOPIC) {
      units += sumBatchValues(log.data);
    }
  }

  return Number(units);
}

/** Read the nth 32-byte word of ABI-encoded data as a BigInt. */
function decodeWord(data, index) {
  const raw = (data ?? '0x').slice(2);
  const word = raw.slice(index * 64, (index + 1) * 64);
  return word.length === 64 ? BigInt('0x' + word) : 0n;
}

/**
 * Sum the `values[]` array of a TransferBatch event.
 *
 * Every offset and length is bounded against the data actually present:
 * decodeWord() returns 0n past the end rather than throwing, so an unchecked
 * length word read from unexpected data would spin this loop indefinitely.
 * Anything that doesn't decode cleanly returns 0, and the caller falls back
 * to a count of 1.
 */
function sumBatchValues(data) {
  const totalWords = Math.floor(((data ?? '0x').length - 2) / 64);
  if (totalWords < 2) return 0n;

  // Second word is the byte offset of values[]; it must be word-aligned and
  // point inside the data.
  const offsetBytes = Number(decodeWord(data, 1));
  if (!Number.isSafeInteger(offsetBytes) || offsetBytes < 0 || offsetBytes % 32 !== 0) return 0n;

  const valuesOffset = offsetBytes / 32;
  if (valuesOffset >= totalWords) return 0n;

  // The array cannot be longer than the words that actually follow it.
  const length = Number(decodeWord(data, valuesOffset));
  if (!Number.isSafeInteger(length) || length < 0 || valuesOffset + length >= totalWords) return 0n;

  let sum = 0n;
  for (let i = 1; i <= length; i++) sum += decodeWord(data, valuesOffset + i);
  return sum;
}

module.exports = { resolvePrimarySale, countMintedUnits, MANIFOLD_CLAIM_EXTENSIONS, MANIFOLD_MINT_FEE_WEI };
