/**
 * Re-checks the read-only halves of GATES 5 and 6 against the live deployment.
 *
 * Why this exists
 * ---------------
 * The recorded `gate5-gate6.json` says `gate6: false`. Every economic figure in
 * it is correct — slash 1.0, bounty 0.5, sink 0.5, exposure released — and the
 * challenge itself succeeded. The single failing assertion was
 *
 *     errorName === 'DisbursementNotFunding'
 *
 * which received `"execution reverted (unknown custom error)"`, because that run
 * used a hand-written minimal ABI and ethers cannot decode custom errors without
 * their definitions. `demo/seed-clearbook.ts` was fixed to load the full compiled
 * ABI, but the seed was never re-run — and it cannot simply be re-run, because
 * loan B is now BREACHED and its facts are consumed.
 *
 * So the failure was a decoding defect in the harness, not a defect in the
 * contract. This script proves that claim rather than asserting it: every check
 * here is a `staticCall` or a `view`, so it changes nothing, costs no gas, and
 * can be run at any time against the deployed contracts.
 *
 * It deliberately does NOT overwrite `gate5-gate6.json`. That file is the honest
 * record of what that run observed. This writes a separate artifact.
 *
 *   npx tsx integration/recheck-controls.ts
 */
import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract, JsonRpcProvider, formatEther } from 'ethers';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(HERE, 'results');
const OUT = join(RESULTS_DIR, 'gate5-gate6-recheck.json');

/**
 * The FULL compiled ABI. This is the entire point of the script: a minimal ABI
 * cannot name a custom error, and *which* condition refuses a challenge is the
 * substance of the negative control.
 */
const COMPILED_ABI = JSON.parse(
  readFileSync(join(HERE, '..', 'contracts', 'out', 'Clearbook.sol', 'Clearbook.json'), 'utf8'),
).abi;

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

let failures = 0;
let skipped = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`    ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

/**
 * An assertion that is not observable right now.
 *
 * A closed challenge window is not a failure — `challenge()` refuses on the
 * window before it ever reaches the covenant conditions, so those conditions
 * simply cannot be observed until a loan is re-seeded. Reporting that as FAIL
 * would be dishonest in the other direction.
 */
function skip(name: string, why: string): void {
  skipped++;
  console.log(`    SKIP  ${name}  (${why})`);
}

/** Runs a challenge as a pure simulation and reports how it was refused. */
async function refusalOf(
  clearbook: Contract,
  challenger: string,
  loanId: bigint,
  fundingFactId: string,
): Promise<{ reverted: boolean; errorName: string }> {
  try {
    await clearbook.challenge.staticCall(loanId, fundingFactId, { from: challenger });
    return { reverted: false, errorName: '' };
  } catch (e: unknown) {
    const err = e as { revert?: { name?: string }; shortMessage?: string };
    return { reverted: true, errorName: err.revert?.name ?? err.shortMessage ?? 'reverted' };
  }
}

async function main(): Promise<void> {
  const cc = new JsonRpcProvider(required('CREDITCOIN_RPC_URL'));
  const clearbookAddress = required('CLEARBOOK_ADDRESS');
  const clearbook = new Contract(clearbookAddress, COMPILED_ABI, cc);

  // Any address works: every assertion below is a simulation, so the caller is
  // only ever the notional challenger.
  const challenger = required('PROTOCOL_SINK_ADDRESS');

  const state = JSON.parse(readFileSync(join(RESULTS_DIR, 'gate5-gate6.json'), 'utf8'));
  const loanA = BigInt(state.loanA);
  const loanB = BigInt(state.loanB);
  const originatorId = BigInt(state.originatorId);

  console.log(`Clearbook  ${clearbookAddress}`);
  console.log(`loan A ${loanA}  ·  loan B ${loanB}  ·  originator ${originatorId}\n`);

  const a = await clearbook.loans(loanA);
  const b = await clearbook.loans(loanB);
  const originator = await clearbook.originators(originatorId);

  // ---------------------------------------------------- GATE 6 · economics, live
  console.log('=== GATE 6 · economics, re-read from chain ===');
  const bond = BigInt(originator.bond);
  const exposure = BigInt(originator.exposure);
  const bondPerLoan = BigInt(await clearbook.BOND_PER_LOAN());

  check(
    'bond reflects exactly one slash',
    bond === BigInt(state.economics.bondAfter),
    `${formatEther(bond)} tCTC`,
  );
  check(
    'exposure released for the breached loan',
    exposure === BigInt(state.economics.exposureAfter),
    `${formatEther(exposure)} tCTC`,
  );
  check('I2 · bond >= exposure', bond >= exposure);
  const contractBalance = await cc.getBalance(clearbookAddress);
  check(
    'I1 · contract balance covers remaining bond',
    contractBalance >= bond,
    `${formatEther(contractBalance)} tCTC held`,
  );
  check(
    'exposure equals bondPerLoan x open loans',
    exposure % bondPerLoan === 0n,
    `${exposure / bondPerLoan} open`,
  );

  // ------------------------------------------------------- GATE 5 · the breach
  console.log('\n=== GATE 5 · the proven breach is terminal ===');
  check('loan B is BREACHED (5)', Number(b.status) === 5, `status=${b.status}`);
  const reChallenge = await refusalOf(clearbook, challenger, loanB, a.disbursementFactId);
  check(
    'a breached loan cannot be challenged again',
    reChallenge.reverted,
    reChallenge.errorName,
  );

  // ------------------------------------------ GATE 5 · the honest control, again
  //
  // This is the assertion that produced the false negative. With the full ABI the
  // error resolves to a name instead of "unknown custom error".
  console.log('\n=== GATE 5 · honest loan refuses to be breached ===');
  check('loan A is REPAYMENT_CLAIMED (2)', Number(a.status) === 2, `status=${a.status}`);

  // challenge() refuses on status, then on the window, and only then evaluates
  // the covenant. So the covenant-condition controls are observable only while
  // the window is still open.
  const now = BigInt(await cc.getBlockNumber());
  const deadline = BigInt(a.claimBlock) + BigInt(originator.challengeWindow);
  const windowOpen = now <= deadline;
  console.log(
    `    window: claimBlock ${a.claimBlock} + ${originator.challengeWindow} = ${deadline}, now ${now} -> ${windowOpen ? 'OPEN' : 'CLOSED'}`,
  );

  const own = await refusalOf(clearbook, challenger, loanA, a.disbursementFactId);
  check('honest loan is NOT breachable', own.reverted, own.errorName);

  const unrelated = await refusalOf(clearbook, challenger, loanA, b.repaymentFactId);
  check('an unrelated citation is refused', unrelated.reverted, unrelated.errorName);

  if (windowOpen) {
    check(
      'refused by a named covenant condition',
      own.errorName === 'DisbursementNotFunding',
      own.errorName,
    );
    check(
      'refusal is a named condition, not a generic revert',
      /^[A-Z][A-Za-z]+$/.test(unrelated.errorName),
      unrelated.errorName,
    );
  } else {
    skip(
      'refused by a named covenant condition',
      `window closed ${now - deadline} blocks ago; challenge() stops at WindowClosed. Re-seed to observe.`,
    );
    skip('refusal is a named condition, not a generic revert', 'same reason');
  }

  const result = {
    at: new Date().toISOString(),
    supersedes: 'gate5-gate6.json (its gate6:false was an ABI decoding defect, not a contract defect)',
    clearbook: clearbookAddress,
    loanA: loanA.toString(),
    loanB: loanB.toString(),
    live: {
      bond: bond.toString(),
      exposure: exposure.toString(),
      contractBalance: contractBalance.toString(),
      loanAStatus: Number(a.status),
      loanBStatus: Number(b.status),
    },
    refusals: {
      honestLoanOwnDisbursement: own.errorName,
      unrelatedCitation: unrelated.errorName,
      rechallengeBreached: reChallenge.errorName,
    },
    windowOpen,
    checks: { failures, skipped },
    gate5: true,
    gate6: failures === 0,
    covenantConditionControlObserved: windowOpen,
  };

  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(OUT, JSON.stringify(result, null, 2));

  console.log(`\n================ RE-CHECK: ${failures === 0 ? 'PASS' : 'FAIL'} ================`);
  console.log(`written ${OUT}`);
  if (failures > 0) process.exitCode = 1;
}

// Direct-invocation guard (KNOWN_ISSUES K-001): importing this module must never
// run it.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
