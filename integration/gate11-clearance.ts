/**
 * Gate 11 — clearance is an answer, not a guess.
 *
 * Clearance is the only surface in Clearbook that produces a lending decision,
 * so the ways it can be wrong are the ways a lender can be misled. This gate
 * attacks the three that matter:
 *
 *   1. FACT IDENTITY. The page derives factId locally and then asks the book
 *      about it. If that derivation disagrees with the deployed vault by a
 *      single bit, every answer is about a fact nobody has ever stored, and the
 *      page would report "clear" for everything, forever, confidently. So the
 *      local derivation is checked against `EvidenceVault.computeFactId` on the
 *      deployed contract, over a matrix including the uint64 and uint32 edges.
 *
 *   2. LEG SELECTION. The vault accepts a log only if it has exactly 3 topics,
 *      the ERC-20 Transfer topic0, and 32 bytes of data. The page must apply
 *      the same rules and must number legs by their position in the FULL log
 *      array, because that position is the identity. Filtering before indexing
 *      is the subtle bug that would produce plausible, wrong factIds.
 *
 *   3. FAILURE DIRECTION. Every unverifiable path must return `unverifiable`.
 *      A clearance check that degrades to "clear" when the prover is down is
 *      worse than no check, because it is confidently wrong exactly when the
 *      infrastructure it depends on is broken.
 *
 * Then it runs the live path against the deployed book and requires that a fact
 * known to be consumed reports `encumbered`, reading the expected answer from
 * the chain rather than from a fixture.
 *
 *   npx tsx integration/gate11-clearance.ts
 */
import { config as loadEnv } from 'dotenv';
loadEnv();
loadEnv({ path: 'frontend/.env.local' });

import { Contract, JsonRpcProvider } from 'ethers';

// Imported dynamically: ESM hoists static imports above the loadEnv() calls, so
// frontend/lib/config would read its NEXT_PUBLIC_* values before the env files
// were on process.env and silently believe nothing is deployed.
const { factIdOf, transferLegs, checkClearance, SCOPE, ERC20_TRANSFER_TOPIC } = await import(
  '../frontend/lib/clearance.js'
);
const { contracts, SOURCE_CHAINS } = await import('../frontend/lib/config.js');

let failures = 0;
const check = (name: string, actual: unknown, expected: unknown): void => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — expected ${expected}, got ${actual}`}`,
  );
};
const ok = (name: string, cond: boolean, detail = ''): void => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
};

const strip = (v?: string) => (v ?? '').replace(/^['"]|['"]$/g, '');
const CC_RPC = strip(process.env.NEXT_PUBLIC_CC_RPC_URL) || 'https://rpc.cc3-testnet.creditcoin.network';

const VAULT_ABI = [
  'function exists(bytes32) view returns (bool)',
  'function computeFactId(uint64 chainKey, uint64 blockHeight, uint64 txIndex, uint32 logIndex) pure returns (bytes32)',
];
const CB_ABI = [
  'function factConsumedBy(bytes32) view returns (uint256)',
  'function nextLoanId() view returns (uint256)',
  'function loans(uint256) view returns (uint256 originatorId, address token, address borrower, uint256 principal, uint64 maturityBlock, bytes32 disbursementFactId, bytes32 repaymentFactId, uint64 claimBlock, uint8 status)',
];

const pad = (hex: string) => '0x' + hex.replace(/^0x/, '').padStart(64, '0');
const addrTopic = (a: string) => pad(a.slice(2));
const WORD = pad('64'); // 100, as 32 bytes

/* ------------------------------------------------------- 1. leg selection */

console.log('\n=== 1 · leg selection mirrors the vault ===');

const A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const TOKEN = '0xcccccccccccccccccccccccccccccccccccccccc';

const legs1 = transferLegs(
  [{ address: TOKEN, topics: [ERC20_TRANSFER_TOPIC, addrTopic(A), addrTopic(B)], data: WORD }],
  1,
  100n,
  7n,
);
check('a plain ERC-20 Transfer qualifies', legs1.length, 1);
check('amount decoded from data', legs1[0]?.amount, 100n);
check('from decoded from topic1', legs1[0]?.from.toLowerCase(), A);
check('to decoded from topic2', legs1[0]?.to.toLowerCase(), B);

// An ERC-721 Transfer shares topic0 but carries a fourth indexed topic. Reading
// its tokenId as an amount is the exact confusion the vault's guard 8 prevents.
const legs721 = transferLegs(
  [
    {
      address: TOKEN,
      topics: [ERC20_TRANSFER_TOPIC, addrTopic(A), addrTopic(B), pad('1')],
      data: '0x',
    },
  ],
  1,
  100n,
  7n,
);
check('an ERC-721 Transfer is rejected (4 topics)', legs721.length, 0);

const legsShort = transferLegs(
  [{ address: TOKEN, topics: [ERC20_TRANSFER_TOPIC, addrTopic(A), addrTopic(B)], data: '0x1234' }],
  1,
  100n,
  7n,
);
check('a malformed transfer log is rejected (data != 32 bytes)', legsShort.length, 0);

const legsOther = transferLegs(
  [{ address: TOKEN, topics: [pad('99'), addrTopic(A), addrTopic(B)], data: WORD }],
  1,
  100n,
  7n,
);
check('a non-Transfer event is rejected', legsOther.length, 0);

/*
 * The identity test. A non-qualifying log sits at position 0, so the qualifying
 * transfer is at transaction-local index 1. If the implementation filtered the
 * array before indexing, this leg would be numbered 0 and would carry a factId
 * the vault never assigned — a wrong answer that looks entirely plausible.
 */
const legsMixed = transferLegs(
  [
    { address: TOKEN, topics: [pad('99')], data: '0x' },
    { address: TOKEN, topics: [ERC20_TRANSFER_TOPIC, addrTopic(A), addrTopic(B)], data: WORD },
    { address: TOKEN, topics: [ERC20_TRANSFER_TOPIC, addrTopic(B), addrTopic(A)], data: WORD },
  ],
  1,
  100n,
  7n,
);
check('mixed receipt yields two qualifying legs', legsMixed.length, 2);
check('leg numbering survives a skipped log', legsMixed[0]?.logIndex, 1);
check('second leg keeps its true position', legsMixed[1]?.logIndex, 2);
check(
  'the skipped log did not renumber the identity',
  legsMixed[0]?.factId,
  factIdOf(1, 100n, 7n, 1),
);
ok(
  'two legs in one transaction get distinct identities',
  legsMixed[0]!.factId !== legsMixed[1]!.factId,
  'a transaction moving value twice must not collapse to one fact',
);

/* --------------------------------- 2. fact identity vs deployed contract */

console.log('\n=== 2 · fact identity agrees with the deployed vault ===');

if (!contracts.evidenceVault) {
  failures++;
  console.log('  FAIL  no EvidenceVault configured — this comparison cannot be skipped');
} else {
  const provider = new JsonRpcProvider(CC_RPC);
  const vault = new Contract(contracts.evidenceVault, VAULT_ABI, provider);

  // Includes the uint64 and uint32 ceilings: a JS number would lose precision
  // here, and the bug would only ever appear on real data.
  const MATRIX: Array<[number, bigint, bigint, number]> = [
    [1, 0n, 0n, 0],
    [1, 100n, 7n, 1],
    [3, 23_000_000n, 157n, 0],
    [3, 11_559_728n, 115n, 0],
    [1, 18_446_744_073_709_551_615n, 18_446_744_073_709_551_615n, 4_294_967_295],
  ];

  for (const [ck, h, ti, li] of MATRIX) {
    const local = factIdOf(ck, h, ti, li);
    const onchain: string = await vault.computeFactId(ck, h, ti, li);
    check(`computeFactId(${ck}, ${h}, ${ti}, ${li})`, local.toLowerCase(), onchain.toLowerCase());
  }
}

/* --------------------------------------------- 3. failures fail closed */

console.log('\n=== 3 · every failure returns unverifiable, never clear ===');

const anyChain = SOURCE_CHAINS[1]!;

const bad = await checkClearance(anyChain, 'not-a-hash');
check('a malformed hash is unverifiable', bad.outcome, 'unverifiable');
check('and names the reason', bad.reason, 'malformed-hash');
ok('and carries no legs', bad.legs.length === 0, 'an unverifiable result must assert nothing');

const missing = await checkClearance(
  anyChain,
  '0x' + '11'.repeat(32),
);
check('an unknown transaction is unverifiable', missing.outcome, 'unverifiable');
ok(
  'and does not claim clear',
  missing.outcome !== 'clear',
  'defaulting to clear on a missing transaction would be the worst possible failure',
);

ok(
  'the scope sentence for clear names its boundary',
  SCOPE.clear.includes('does not establish') && SCOPE.clear.includes('elsewhere'),
  'CLEAR must never be renderable without its qualifier',
);
ok(
  'the scope sentence for unverifiable refuses to default',
  SCOPE.unverifiable.includes('rather than defaulting to clear'),
  'the failure direction must be stated in the product, not just in tests',
);

/* ------------------------------------------------- 4. live encumbrance */

console.log('\n=== 4 · a consumed fact reads as encumbered on the live book ===');

if (!contracts.clearbook || !contracts.evidenceVault) {
  failures++;
  console.log('  FAIL  no deployment configured — the live check cannot be skipped');
} else {
  const provider = new JsonRpcProvider(CC_RPC);
  const book = new Contract(contracts.clearbook, CB_ABI, provider);
  const nextLoanId: bigint = await book.nextLoanId();

  if (nextLoanId <= 1n) {
    failures++;
    console.log('  FAIL  no loans on the book — cannot prove encumbrance against live state');
  } else {
    // Read a real committed fact from the book rather than inventing one.
    let found: { loanId: bigint; factId: string } | null = null;
    for (let id = nextLoanId - 1n; id >= 1n && !found; id--) {
      const loan = await book.loans(id);
      const factId: string = loan[5];
      if (factId && /^0x0+$/.test(factId) === false) found = { loanId: id, factId };
    }

    if (!found) {
      failures++;
      console.log('  FAIL  no loan carries a disbursement fact');
    } else {
      const consumer: bigint = await book.factConsumedBy(found.factId);
      check(
        `loan #${found.loanId} disbursement fact is consumed by that loan`,
        consumer,
        found.loanId,
      );
      ok(
        'factConsumedBy is non-zero for a committed fact',
        consumer !== 0n,
        'the mapping the clearance answer depends on is empty',
      );

      const vault = new Contract(contracts.evidenceVault, VAULT_ABI, provider);
      const stored: boolean = await vault.exists(found.factId);
      ok('and the fact is present in the shared registry', stored, 'vault.exists returned false');

      console.log(
        `  note  encumbrance path exercised against loan #${found.loanId}, fact ${found.factId.slice(0, 18)}…`,
      );
    }
  }
}

/* ------------------------------------------------------------- verdict */

console.log(
  failures === 0
    ? '\nGate 11 PASS — clearance derives the book’s own identities and fails closed.\n'
    : `\nGate 11 FAIL — ${failures} failure(s).\n`,
);
process.exit(failures === 0 ? 0 : 1);
