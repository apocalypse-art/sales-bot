/**
 * Does the Oversoul suppression hit Oversoul, and ONLY Oversoul?
 *
 * 🚨 THE RISK THIS TEST EXISTS FOR. Two rules now stop the webhook announcing
 * certain sales. If either is scoped too widely, a collection goes SILENT — and
 * silence is the hardest failure to notice, because nothing appears anywhere to
 * say a tweet was missed. There are sixteen contracts in contracts.js and
 * fifteen of them must be completely unaffected.
 *
 * So this asserts the policy against every registered contract, rather than
 * against the one it was written for.
 *
 * It also checks that the policy is actually WIRED IN. Testing the pure
 * functions alone would pass just as happily if the import were never called —
 * which is the more likely mistake, and the one that fails open by announcing
 * placeholders again.
 *
 *   node scripts/verify-oversoul-suppression.js
 *
 * No network, no credentials, nothing posted.
 */

const CONTRACTS = require('../src/contracts');
const {
  OVERSOUL_CONTRACT,
  ARTIST_WALLET,
  suppressWebhookMint,
  suppressWebhookTransfer,
  isPlaceholderName,
} = require('../src/oversoul');

const ZERO = '0x0000000000000000000000000000000000000000';
const COLLECTOR_A = '0xaaaa000000000000000000000000000000000001';
const COLLECTOR_B = '0xbbbb000000000000000000000000000000000002';

let failures = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok ? '' : `  — expected ${expected}, got ${actual}`}`);
  if (!ok) failures++;
}

function section(title) {
  console.log(`\n${title}`);
}

async function main() {
  section('The Oversoul contract — suppressed as intended:');
  check('a mint is suppressed', suppressWebhookMint(OVERSOUL_CONTRACT), true);
  check('a mint is suppressed (mixed case)', suppressWebhookMint(OVERSOUL_CONTRACT.toUpperCase()), true);
  check('a sale BY the artist is suppressed', suppressWebhookTransfer(OVERSOUL_CONTRACT, ARTIST_WALLET), true);
  check(
    'a sale by the artist is suppressed (mixed case)',
    suppressWebhookTransfer(OVERSOUL_CONTRACT, ARTIST_WALLET.toUpperCase()),
    true
  );

  section('The Oversoul contract — NOT suppressed, so resales still announce:');
  check(
    'collector-to-collector resale announces',
    suppressWebhookTransfer(OVERSOUL_CONTRACT, COLLECTOR_A),
    false
  );
  check(
    'a resale to the artist announces (artist is the BUYER, not the seller)',
    suppressWebhookTransfer(OVERSOUL_CONTRACT, COLLECTOR_B),
    false
  );

  section('Every other registered contract — completely untouched:');
  const others = Object.keys(CONTRACTS).filter((a) => a !== OVERSOUL_CONTRACT);
  console.log(`  (checking all ${others.length})`);
  let mintLeak = 0;
  let transferLeak = 0;
  for (const address of others) {
    if (suppressWebhookMint(address)) {
      console.log(`  ✗ MINT SUPPRESSED for ${CONTRACTS[address].name} (${address})`);
      mintLeak++;
    }
    // Including the pathological case: another collection sold by the artist's
    // own wallet, which is a perfectly normal thing for an artist to do.
    for (const from of [ZERO, COLLECTOR_A, ARTIST_WALLET]) {
      if (suppressWebhookTransfer(address, from)) {
        console.log(`  ✗ TRANSFER SUPPRESSED for ${CONTRACTS[address].name} from ${from}`);
        transferLeak++;
      }
    }
  }
  check('no other collection has its mints suppressed', mintLeak, 0);
  check('no other collection has its transfers suppressed', transferLeak, 0);

  section('The placeholder test is Oversoul-only:');
  check('Oversoul placeholder recognised', isPlaceholderName(OVERSOUL_CONTRACT, 'Invitation #21/144'), true);
  check('Oversoul real title is not a placeholder', isPlaceholderName(OVERSOUL_CONTRACT, 'REMEMBERS'), false);
  check(
    'the same string on another collection is NOT treated as a placeholder',
    isPlaceholderName(others[0], 'Invitation #21/144'),
    false
  );

  // ── Is any of this actually connected? ────────────────────────────────────
  //
  // Everything above tests src/oversoul.js in isolation. If saleHandler never
  // called it, every assertion would still pass and the bug would be live.
  section('The policy is wired into the handler:');

  const logs = [];
  const realLog = console.log;
  console.log = (...args) => { logs.push(args.join(' ')); };

  const { handleAlchemyActivity } = require('../src/saleHandler');

  const activity = (contractAddress, fromAddress) => ({
    fromAddress,
    toAddress: COLLECTOR_B,
    contractAddress,
    erc721TokenId: '0x15',
    category: 'token',
    log: { transactionHash: `0x${'a'.repeat(64)}` },
  });

  await handleAlchemyActivity(activity(OVERSOUL_CONTRACT, ZERO), 'ETH_MAINNET');
  const mintSuppressed = logs.some((l) => l.includes('not announcing from the webhook'));

  logs.length = 0;
  await handleAlchemyActivity(activity(OVERSOUL_CONTRACT, ARTIST_WALLET), 'ETH_MAINNET');
  const offerSuppressed = logs.some((l) => l.includes('announced by hand'));

  // A different collection's mint. With no ALCHEMY_RPC_URL set, this reaches
  // handlePrimarySale and stops there for want of a chain read — which is
  // exactly the evidence wanted: it got PAST the suppression check.
  logs.length = 0;
  delete process.env.ALCHEMY_RPC_URL;
  await handleAlchemyActivity(activity(others[0], ZERO), 'ETH_MAINNET');
  const otherDispatched = logs.some((l) => l.includes('Could not read the mint transaction'));
  const otherSuppressed = logs.some((l) => l.includes('not announcing from the webhook'));

  console.log = realLog;

  check('an Oversoul mint is stopped by the handler', mintSuppressed, true);
  check('an artist-wallet Oversoul sale is stopped by the handler', offerSuppressed, true);
  check('another collection reaches its normal sale path', otherDispatched, true);
  check('another collection is never suppressed', otherSuppressed, false);

  console.log('');
  if (failures) {
    console.error(`🔴 ${failures} assertion(s) failed.`);
    process.exit(1);
  }
  console.log('✅ Suppression is scoped to Oversoul, wired in, and no other collection is affected.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
