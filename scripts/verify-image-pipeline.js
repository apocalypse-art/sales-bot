/**
 * Can this bot actually turn an Oversoul artwork into a tweetable image?
 *
 * The Oversoul GIFs are the largest artwork this bot handles by a wide margin —
 * 30–41 MB against a few hundred KB for everything else — and imageService
 * refuses anything over its size cap BEFORE converting. So the cap is the only
 * thing standing between a sale and a tweet with no artwork, and it was set
 * without ever having measured one of these files.
 *
 * 🪤 The cap was nearly set to 40 MB on the strength of a single measurement
 * (REMEMBERS, 32 MB). REMEMBERS is near the BOTTOM of the range: SENTINEL is
 * 41.1 MB, REAPER 40.6, ON THE RUN 40.5. A 40 MB cap would have silently
 * dropped the artwork from roughly a third of sale tweets — the failure being
 * invisible, because the bot logs a warning and posts anyway.
 *
 * This measures the real thing end to end: download, convert, and the peak heap
 * it takes, because Railway containers are memory-limited and a 41 MB buffer
 * plus sharp's working set is the largest allocation this process ever makes.
 *
 *   node scripts/verify-image-pipeline.js
 *
 * Read-only. Downloads public artwork, converts in memory, writes nothing and
 * posts nothing.
 */

const sharp = require('sharp');

// The three largest measured, plus the one that was originally sampled.
const SAMPLES = [
  { name: 'SENTINEL',   url: 'https://arweave.net/eGnTmDEbsblF8eVmBVI4CGG45SgXbSFcG3dLivBs1ag' },
  { name: 'REAPER',     url: 'https://arweave.net/Liwf21CrbIpszwBh3pNMdN6M_fWQkRLAVLTRGaAhJvU' },
  { name: 'ON THE RUN', url: 'https://arweave.net/tm9MUIb3QlbSeC4aUwzDaVUff0uyBjzUHtUPTjS5MnU' },
];

const TWITTER_IMAGE_LIMIT_MB = 5;
const MAX_DIMENSION = 2048; // must match imageService.js

const mb = (bytes) => bytes / 1024 / 1024;

async function main() {
  console.log('Measuring the real conversion path. Nothing is posted.\n');

  let worstInputMb = 0;
  let worstOutputMb = 0;
  let failures = 0;

  for (const sample of SAMPLES) {
    process.stdout.write(`${sample.name.padEnd(11)} `);

    const t0 = Date.now();
    const res = await fetch(sample.url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(180000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SalesBot/1.0)' },
    });
    if (!res.ok) {
      console.log(`✗ download HTTP ${res.status}`);
      failures++;
      continue;
    }
    const raw = Buffer.from(await res.arrayBuffer());
    const downloadMs = Date.now() - t0;

    const heapBefore = process.memoryUsage().heapUsed;
    const t1 = Date.now();
    // Exactly what imageService.js does after the cap.
    const jpeg = await sharp(raw)
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
    const convertMs = Date.now() - t1;
    const heapPeak = process.memoryUsage().heapUsed;

    const inMb = mb(raw.length);
    const outMb = mb(jpeg.length);
    worstInputMb = Math.max(worstInputMb, inMb);
    worstOutputMb = Math.max(worstOutputMb, outMb);

    const ok = outMb < TWITTER_IMAGE_LIMIT_MB;
    if (!ok) failures++;

    console.log(
      `${ok ? '✓' : '✗'} ${inMb.toFixed(1)} MB → ${(outMb * 1024).toFixed(0)} KB  ` +
      `(download ${(downloadMs / 1000).toFixed(1)}s, convert ${convertMs} ms, ` +
      `heap +${mb(heapPeak - heapBefore).toFixed(0)} MB)`
    );
  }

  console.log('');
  console.log(`largest input measured : ${worstInputMb.toFixed(1)} MB`);
  console.log(`largest output produced: ${(worstOutputMb * 1024).toFixed(0)} KB  (Twitter allows ${TWITTER_IMAGE_LIMIT_MB} MB)`);
  console.log('');

  if (failures) {
    console.error(`🔴 ${failures} sample(s) failed.`);
    process.exit(1);
  }
  console.log('✅ Every sample converts well inside Twitter\'s limit.');
  console.log(`   The cap must sit above ${worstInputMb.toFixed(1)} MB — and only 8 of 144 have been measured,`);
  console.log('   so it needs real headroom rather than a number just above the largest seen.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
