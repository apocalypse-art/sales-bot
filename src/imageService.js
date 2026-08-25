/**
 * Image download + processing.
 *
 * NFTs can be PNGs, JPEGs, GIFs, SVGs, or MP4s.
 * Twitter accepts JPEG, PNG, GIF, WEBP — max 5 MB for images.
 * This service downloads whatever the token's image URL points to
 * and converts it to a JPEG buffer safe to upload.
 */

const sharp = require('sharp');

// Maximum dimension for the tweet image (Twitter recommends ≤4096px)
const MAX_DIMENSION = 2048;

// Largest file we will download before converting. See the note at the check
// itself for why this is 64 and not 20 or 40.
const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;

// Generous, because the largest artwork here is ~41 MB and Railway's egress is
// not the fast local link these were measured on. 15s was fine for the few
// hundred KB every other collection uses; it is a coin toss for these.
const DOWNLOAD_TIMEOUT_MS = 60000;

/**
 * Download an image from a URL and return a JPEG Buffer.
 * Returns null if the download or conversion fails.
 *
 * @param {string} url
 * @returns {Promise<Buffer|null>}
 */
async function downloadImageBuffer(url) {
  // Some NFTs use IPFS URLs — convert to an HTTP gateway
  const httpUrl = resolveIpfsUrl(url);

  try {
    const res = await fetch(httpUrl, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      headers: {
        // Some image servers block non-browser user agents
        'User-Agent': 'Mozilla/5.0 (compatible; SalesBot/1.0)',
      },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const contentType = res.headers.get('content-type') || '';
    const rawBuffer = Buffer.from(await res.arrayBuffer());

    // Enforce a download limit.
    //
    // 🪤 This was 20 MB, which silently discarded EVERY Oversoul artwork: they
    // are 30–41 MB GIFs, and the check runs before the conversion that would
    // have made them small. The bot then posts without an image and only warns,
    // so the failure is invisible unless someone reads the log.
    //
    // 64 MB is deliberate headroom, not a number just above the largest seen.
    // Measured 2026-08-24: SENTINEL 41.1 MB, REAPER 40.6, ON THE RUN 40.5 — and
    // only 8 of 144 pieces have ever been measured. A cap set at ~40 MB, which
    // was the original proposal on the strength of a single 32 MB sample, would
    // have dropped the artwork from roughly a third of Oversoul sale tweets.
    // Size is not the constraint that matters: 41.1 MB converts to 429 KB in
    // 20 ms (scripts/verify-image-pipeline.js).
    if (rawBuffer.length > MAX_DOWNLOAD_BYTES) {
      // Loud, because posting a sale without its artwork is a visible, permanent
      // defect and a warning buried in a log is how it stays unnoticed.
      console.error(
        `Image is ${(rawBuffer.length / 1024 / 1024).toFixed(1)} MB, over the ` +
        `${MAX_DOWNLOAD_BYTES / 1024 / 1024} MB cap — POSTING WITHOUT ARTWORK. ` +
        `Raise MAX_DOWNLOAD_BYTES in src/imageService.js.`
      );
      return null;
    }

    // ── SVGs aren't supported by Twitter; skip ────────────────────────────
    if (contentType.includes('svg') || url.endsWith('.svg')) {
      console.warn('SVG image not supported for Twitter upload, skipping image.');
      return null;
    }

    // ── Videos: we can't easily extract a frame without ffmpeg,
    //    so skip and post without an image ──────────────────────────────────
    if (contentType.includes('video') || url.endsWith('.mp4') || url.endsWith('.webm')) {
      console.warn('Video NFT detected — posting without inline image (no ffmpeg).');
      return null;
    }

    // ── Convert everything else to a resized JPEG ─────────────────────────
    const jpegBuffer = await sharp(rawBuffer)
      .resize({
        width: MAX_DIMENSION,
        height: MAX_DIMENSION,
        fit: 'inside',         // preserve aspect ratio
        withoutEnlargement: true,
      })
      .jpeg({ quality: 90 })
      .toBuffer();

    console.log(`Image ready: ${(jpegBuffer.length / 1024).toFixed(1)} KB`);
    return jpegBuffer;

  } catch (err) {
    console.error(`Failed to download/process image from ${httpUrl}:`, err.message);
    return null;
  }
}

/**
 * Convert ipfs:// and ipfs.io URLs to a public HTTP gateway.
 */
function resolveIpfsUrl(url) {
  if (!url) return url;

  // ipfs://Qm... or ipfs://bafy...
  if (url.startsWith('ipfs://')) {
    const cid = url.replace('ipfs://', '');
    return `https://ipfs.io/ipfs/${cid}`;
  }

  // Already an HTTP URL — return as-is
  return url;
}

module.exports = { downloadImageBuffer };
