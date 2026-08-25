/**
 * Everything this bot treats differently for The Oversoul, in one file.
 *
 * WHY ONE FILE: the rules below suppress announcements that the bot would
 * otherwise make. Scattered through saleHandler they would be four unrelated
 * conditions that a future change could quietly widen — and widening any of
 * them silences a collection. Keeping them together means the blast radius is
 * one import, and the answer to "what does Oversoul do differently?" is this
 * file rather than a search.
 *
 * WHY OVERSOUL IS DIFFERENT: its artwork does not exist on the token at the
 * moment of sale. The buyer mints an Invitation which serves a generic
 * "Invitation #N/144" placeholder, and the real artwork is published to Arweave
 * minutes to an hour later by a job in the oversoul repo. Every other
 * collection here has correct metadata the instant it mints.
 *
 * So for Oversoul the chain is the wrong trigger. Announcing on a mint webhook
 * is announcing before the artwork exists — which is exactly what happened on
 * 2026-08-24, when a sale of "#78 REMEMBERS" was tweeted as "Invitation
 * #20/144 sold on Manifold!" with no image. The publish job tells us instead,
 * over POST /announce-sale, once it has verified the artwork actually resolves.
 *
 * 🚨 EVERY RULE HERE IS SCOPED TO THE OVERSOUL CONTRACT. The other fifteen
 * collections in contracts.js do not have this problem and must keep behaving
 * exactly as they always have.
 */

/** The Oversoul Invitation contract (ETH mainnet). Lowercased for comparison. */
const OVERSOUL_CONTRACT = '0x8fb9051d464ef8fed7832e05bacc675699a84401';

/**
 * The artist's hardware wallet — the seller whenever an offer is accepted.
 *
 * An accepted offer moves a reserve Invitation from this wallet to the buyer.
 * That is a transfer, not a mint, so it arrives on the SECONDARY path and is
 * untouched by the mint rule below. The artist announces those personally
 * (decided 2026-08-24), so the bot must stay quiet.
 *
 * Matched on the SELLER only. A genuine collector-to-collector resale never has
 * this wallet as the seller, so those still announce automatically.
 */
const ARTIST_WALLET = '0x1430997022e8ccf845af34596ef37f4754983f85';

/** What an Oversoul token serves before its artwork is published. */
const PLACEHOLDER_NAME = /^Invitation #\d+\/144$/;

const isOversoul = (contractAddress) =>
  contractAddress?.toLowerCase() === OVERSOUL_CONTRACT;

/**
 * Should the webhook ignore this mint?
 *
 * True only for an Oversoul mint. The publish job announces those once the
 * artwork is live, so acting here would announce a placeholder and then
 * double-post when the real notification arrives.
 */
function suppressWebhookMint(contractAddress) {
  return isOversoul(contractAddress);
}

/**
 * Should the webhook ignore this transfer?
 *
 * True only for an Oversoul token sold BY the artist — an accepted offer, which
 * the artist announces by hand. Everything else, including every genuine
 * resale between collectors, returns false and announces as usual.
 */
function suppressWebhookTransfer(contractAddress, fromAddress) {
  return isOversoul(contractAddress) && fromAddress?.toLowerCase() === ARTIST_WALLET;
}

/**
 * Is this name a placeholder rather than a real artwork title?
 *
 * Used by the metadata retry so it waits for a real name instead of accepting
 * the first one it sees. Only consulted for Oversoul — no other collection has
 * placeholder metadata, and applying this to them would make the retry wait for
 * a condition that never arrives.
 */
function isPlaceholderName(contractAddress, name) {
  return isOversoul(contractAddress) && PLACEHOLDER_NAME.test(name ?? '');
}

module.exports = {
  OVERSOUL_CONTRACT,
  ARTIST_WALLET,
  PLACEHOLDER_NAME,
  isOversoul,
  suppressWebhookMint,
  suppressWebhookTransfer,
  isPlaceholderName,
};
