/**
 * Token metadata straight from the chain — the fallback when OpenSea is behind.
 *
 * 🪤 2026-10-20, the first STIMULANT sale: OpenSea had not indexed the freshly
 * minted token after the full retry (~2 min), so the tweet went out as
 * "#1 sold on Manifold!" with no artwork and an Etherscan link. Yet the real
 * title and GIF were final the moment it minted — Manifold claims point
 * tokenURI at Arweave metadata that never changes. So when OpenSea has no name
 * or no image, read tokenURI (721) / uri (1155) off the chain and fetch the
 * metadata it points to.
 *
 * Not used for The Oversoul's mints (those never reach the webhook path) — and
 * its placeholder names are rejected by the caller anyway.
 */

const { ethCall } = require('./chainService');

const TOKEN_URI_721 = '0xc87b56dd'; // tokenURI(uint256)
const URI_1155      = '0x0e89341c'; // uri(uint256)
const FETCH_TIMEOUT_MS = 20000;

/**
 * @returns {Promise<{tokenName: string|null, imageUrl: string|null}>}
 */
async function fetchOnChainMetadata(contractAddress, tokenId, network, type = '721') {
  const empty = { tokenName: null, imageUrl: null };
  try {
    const selector = type === '1155' ? URI_1155 : TOKEN_URI_721;
    const arg = BigInt(tokenId).toString(16).padStart(64, '0');
    const raw = await ethCall(contractAddress, selector + arg, network);
    let uri = decodeString(raw);
    if (!uri) return empty;
    // ERC-1155 may use the {id} template.
    uri = uri.replace('{id}', BigInt(tokenId).toString(16).padStart(64, '0'));

    let meta;
    const dataJson = uri.match(/^data:application\/json(;base64)?,(.*)$/s);
    if (dataJson) {
      const body = dataJson[1] ? Buffer.from(dataJson[2], 'base64').toString('utf8') : decodeURIComponent(dataJson[2]);
      meta = JSON.parse(body);
    } else {
      const res = await fetch(toHttp(uri), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`metadata HTTP ${res.status}`);
      meta = await res.json();
    }

    const image = meta.image || meta.image_url || null;
    return {
      tokenName: typeof meta.name === 'string' && meta.name.trim() ? meta.name.trim() : null,
      imageUrl:  image ? toHttp(image) : null,
    };
  } catch (err) {
    console.warn('On-chain metadata lookup failed:', err.message);
    return empty;
  }
}

/** ar:// and ipfs:// → a public HTTP gateway; anything else unchanged. */
function toHttp(uri) {
  if (uri.startsWith('ar://'))   return `https://arweave.net/${uri.slice(5)}`;
  if (uri.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${uri.slice(7).replace(/^ipfs\//, '')}`;
  return uri;
}

/** Decode an ABI-encoded `string` return value. */
function decodeString(hex) {
  if (!hex || hex === '0x' || hex.length < 130) return '';
  const raw = hex.slice(2);
  const length = parseInt(raw.slice(64, 128), 16);
  if (!Number.isSafeInteger(length) || length <= 0) return '';
  return Buffer.from(raw.slice(128, 128 + length * 2), 'hex').toString('utf8');
}

module.exports = { fetchOnChainMetadata };
