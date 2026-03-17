/**
 * Image download + processing.
 *
 * NFTs can be PNGs, JPEGs, GIFs, SVGs, or MP4s.
 * Twitter accepts JPEG, PNG, GIF, WEBP — max 5 MB for images.
 * This service downloads whatever the token's image URL points to
 * and converts it to a JPEG buffer safe to upload.
 */

const axios = require('axios');
const sharp = require('sharp');

// Maximum dimension for the tweet image (Twitter recommends ≤4096px)
const MAX_DIMENSION = 2048;

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
    const response = await axios.get(httpUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
      maxContentLength: 20 * 1024 * 1024, // 20 MB download limit
      headers: {
        // Some image servers block non-browser user agents
        'User-Agent': 'Mozilla/5.0 (compatible; SalesBot/1.0)',
      },
    });

    const contentType = response.headers['content-type'] || '';
    const rawBuffer = Buffer.from(response.data);

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
