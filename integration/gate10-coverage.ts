/**
 * Gate 10 — activity coverage is a measurement, not a number.
 *
 * A ratio shown to a judge is worthless unless the denominator is right, so this
 * gate does two things the unit tests cannot:
 *
 *   1. Runs the adversarial matrix over the deterministic parts — fact identity,
 *      the zero states, and the refusal to render a percentage where no
 *      denominator exists.
 *   2. Measures the live book with the SHIPPING implementation (viem, the same
 *      code the registry page calls) and again with a second, independently
 *      written implementation (ethers), and requires them to agree exactly.
 *
 * Two implementations agreeing on real chain data is the only evidence that the
 * number on screen is the number that is true.
 *
 *   npx tsx integration/gate10-coverage.ts
 */
import { config as loadEnv } from 'dotenv';
loadEnv();
loadEnv({ path: 'frontend/.env.local' });

import { Contract, JsonRpcProvider, getAddress } from 'ethers';

import type { Coverage, CoverageScope } from '../frontend/lib/coverage.js';

// Imported dynamically: ESM hoists static imports above the loadEnv() calls
// above, so frontend/lib/config would read its NEXT_PUBLIC_* values before the
// env files were on process.env and silently believe nothing is deployed.
const { boundTreasuries, coveragePercent, coverageState, factIdOf, measureCoverage, COVERAGE_WINDOW_BLOCKS } =
  await import('../frontend/lib/coverage.js');
const { ccClient, sourceClientFor } = await import('../frontend/lib/verifier.js');
const { contracts } = await import('../frontend/lib/config.js');

let failures = 0;
const check = (name: string, actual: unknown, expected: unknown): void => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — expected ${expected}, got ${actual}`}`);
};

const strip = (v?: string) => (v ?? '').replace(/^['"]|['"]$/g, '');
const CHAIN_KEY = Number(strip(process.env.SOURCE_CHAIN_KEY) || '1');
const TOKEN = getAddress(strip(process.env.SOURCE_TOKEN_ADDRESS));
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const VAULT_ABI = [
  'function exists(bytes32) view returns (bool)',
  'function computeFactId(uint64 chainKey, uint64 blockHeight, uint64 txIndex, uint32 logIndex) pure returns (bytes32)',
];
const CB_ABI = [
  'function nextLoanId() view returns (uint256)',
  'function nextOriginatorId() view returns (uint256)',
  'function loans(uint256) view returns (uint256 originatorId, address token, address borrower, uint256 principal, uint64 maturityBlock, bytes32 disbursementFactId, bytes32 repaymentFactId, uint64 claimBlock, uint8 status)',
  'function originators(uint256) view returns (address owner, string name, uint256 bond, uint256 exposure, uint32 circularWindow, uint32 challengeWindow, uint64 lastClaimBlock, uint16 covenants, bool active)',
];

/** A Coverage shaped for the state tests; the counts are what matter. */
function fixture(over: Partial<Coverage>): Coverage {
  return {
    originatorId: 1n,
    treasuries: [{ address: '0x1111111111111111111111111111111111111111', boundAt: 1n }],
    scope: { chainKey: 1, tokens: [TOKEN as `0x${string}`], fromBlock: 0n, toBlock: 100n },
    qualifying: 8,
    committed: 4,
    verifiedNotCommitted: 2,
    unverified: 2,
    revertedSkipped: 0,
    ...over,
  };
}

/** Method B: written against ethers, deliberately not sharing code with Method A. */
async function methodB(
  treasury: string,
  scope: CoverageScope,
  committed: Set<string>,
): Promise<{ qualifying: number; committed: number }> {
  const src = new JsonRpcProvider(strip(process.env.SOURCE_CHAIN_RPC_URL));
  const cc = new JsonRpcProvider(strip(process.env.CREDITCOIN_RPC_URL));
  const vault = new Contract(strip(process.env.EVIDENCE_VAULT_ADDRESS), VAULT_ABI, cc);

  let qualifying = 0;
  let matched = 0;
  const cache = new Map<string, number[] | null>();

  for (let s = scope.fromBlock; s <= scope.toBlock; s += 5_000n) {
    const e = s + 4_999n > scope.toBlock ? scope.toBlock : s + 4_999n;
    const logs = await src.getLogs({
      address: scope.tokens[0],
      fromBlock: Number(s),
      toBlock: Number(e),
      topics: [TRANSFER_TOPIC, '0x' + treasury.slice(2).toLowerCase().padStart(64, '0')],
    });

    for (const entry of logs) {
      if (entry.topics.length !== 3 || entry.data.length !== 66) continue;
      let idx = cache.get(entry.transactionHash);
      if (idx === undefined) {
        const r = await src.getTransactionReceipt(entry.transactionHash);
        idx = r && r.status === 1 ? r.logs.map((l) => l.index) : null;
        cache.set(entry.transactionHash, idx);
      }
      if (idx === null) continue;
      const local = idx.indexOf(entry.index);
      if (local < 0) continue;

      qualifying++;
      // Deliberately asks the DEPLOYED contract rather than deriving locally,
      // so Method B does not inherit Method A's idea of fact identity.
      const factId: string = await vault.computeFactId(CHAIN_KEY, entry.blockNumber, entry.transactionIndex, local);
      if (committed.has(factId.toLowerCase())) matched++;
    }
  }
  return { qualifying, committed: matched };
}

async function main(): Promise<void> {
  console.log('\nGate 10 — activity coverage\n');

  // ---------------------------------------------------------------
  console.log('Fact identity agrees with the deployed vault');
  // ---------------------------------------------------------------
  const cc = new JsonRpcProvider(strip(process.env.CREDITCOIN_RPC_URL));
  const vault = new Contract(strip(process.env.EVIDENCE_VAULT_ADDRESS), VAULT_ABI, cc);

  for (const [b, t, l] of [
    [11_538_664n, 64n, 0],
    [11_541_770n, 0n, 0],
    [1n, 0n, 0],
    [0n, 0n, 0],
    // A transaction-local index above zero is the case a block-global index breaks.
    [11_538_688n, 12n, 3],
  ] as Array<[bigint, bigint, number]>) {
    const local = factIdOf(CHAIN_KEY, b, t, l);
    const onChain: string = await vault.computeFactId(CHAIN_KEY, b, t, l);
    check(`factId(${b}, ${t}, ${l})`, local.toLowerCase(), onChain.toLowerCase());
  }

  // ---------------------------------------------------------------
  console.log('\nZero states are not zero percent');
  // ---------------------------------------------------------------
  check('no bound treasury -> no-treasury', coverageState(fixture({ treasuries: [] })), 'no-treasury');
  check('no bound treasury renders no percentage', coveragePercent(fixture({ treasuries: [] })), null);
  check(
    'bound treasury, no activity -> no-activity',
    coverageState(fixture({ qualifying: 0, committed: 0, verifiedNotCommitted: 0, unverified: 0 })),
    'no-activity',
  );
  check(
    'no activity renders no percentage',
    coveragePercent(fixture({ qualifying: 0, committed: 0, verifiedNotCommitted: 0, unverified: 0 })),
    null,
  );
  check('activity present -> measured', coverageState(fixture({})), 'measured');
  check('4 of 8 reads 50.0%', coveragePercent(fixture({})), '50.0%');
  check('full coverage reads 100.0%', coveragePercent(fixture({ qualifying: 5, committed: 5 })), '100.0%');
  check('nothing committed reads 0.0%', coveragePercent(fixture({ qualifying: 5, committed: 0 })), '0.0%');
  check(
    'one decimal only — no false precision',
    coveragePercent(fixture({ qualifying: 3, committed: 1 })),
    '33.3%',
  );

  // ---------------------------------------------------------------
  console.log('\nThe three classes partition the denominator');
  // ---------------------------------------------------------------
  const f = fixture({});
  check(
    'committed + verified-not-committed + unverified == qualifying',
    f.committed + f.verifiedNotCommitted + f.unverified,
    f.qualifying,
  );

  // ---------------------------------------------------------------
  console.log('\nLive measurement: Method A (viem, shipping) vs Method B (ethers)');
  // ---------------------------------------------------------------
  if (!contracts.clearbook || !contracts.evidenceVault) {
    // Never a skip: the live comparison is the only part of this gate that
    // proves the shipped number is true, so being unable to run it is a failure.
    failures++;
    console.log('  FAIL  contracts not configured — the live comparison could not run');
  } else {
    const cbEthers = new Contract(strip(process.env.CLEARBOOK_ADDRESS), CB_ABI, cc);
    const nextLoan: bigint = await cbEthers.nextLoanId();
    const nextOrig: bigint = await cbEthers.nextOriginatorId();

    const committedIds = new Set<string>();
    for (let id = 1n; id < nextLoan; id++) {
      const l = await cbEthers.loans(id);
      committedIds.add((l.disbursementFactId as string).toLowerCase());
    }

    const ccHead = await ccClient.getBlockNumber();
    const srcHead = BigInt(await sourceClientFor(CHAIN_KEY).getBlockNumber());
    const scope: CoverageScope = {
      chainKey: CHAIN_KEY,
      tokens: [TOKEN as `0x${string}`],
      fromBlock: srcHead - COVERAGE_WINDOW_BLOCKS,
      toBlock: srcHead,
    };
    console.log(`  scope: chainKey ${CHAIN_KEY} | ${TOKEN} | source blocks ${scope.fromBlock}-${scope.toBlock}\n`);

    for (let id = 1n; id < nextOrig; id++) {
      const o = await cbEthers.originators(id);
      const treasuries = await boundTreasuries(id, ccHead);
      const a = await measureCoverage(id, treasuries, scope, committedIds);

      console.log(`  originator ${id} — ${o.name}`);
      console.log(`    declared treasuries : ${treasuries.length || 'none'}`);
      console.log(`    state               : ${coverageState(a)}`);
      console.log(
        `    coverage            : ${
          coveragePercent(a) === null ? '(no ratio)' : `${a.committed}/${a.qualifying} = ${coveragePercent(a)}`
        }`,
      );
      console.log(
        `    committed ${a.committed} · verified-not-committed ${a.verifiedNotCommitted} · unverified ${a.unverified} · reverted skipped ${a.revertedSkipped}`,
      );

      for (const t of treasuries) {
        const b = await methodB(t.address, scope, committedIds);
        check(`    [${t.address.slice(0, 10)}] denominators agree`, a.qualifying, b.qualifying);
        check(`    [${t.address.slice(0, 10)}] numerators agree`, a.committed, b.committed);
      }
      if (treasuries.length === 0) {
        check('    undeclared originator yields no ratio', coveragePercent(a), null);
      }
      console.log('');
    }
  }

  console.log(`${failures === 0 ? 'GATE 10 PASS' : `GATE 10 FAIL — ${failures} failing`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
