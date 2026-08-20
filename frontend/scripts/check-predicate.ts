/**
 * Verifies the client-side dry run against the demo scenarios.
 *
 * The dry run is the product's hero interaction: it tells a challenger which of
 * the eleven conditions hold before they spend gas. If it disagreed with the
 * contract, the console would confidently mislead people. This asserts it gives
 * the answers BUILD.md §13.1 says each scenario should produce.
 *
 *   npx tsx frontend/scripts/check-predicate.ts
 */
import {
  FIXTURE_FACTS,
  FIXTURE_LOANS,
  FIXTURE_ORIGINATOR,
  FIXTURE_PARAMS,
  FIXTURE_CURRENT_BLOCK,
  factIdOf,
  fixtureTreasuryOwner,
} from '../lib/fixtures';
import { applyTreasuryBinding, dryRun } from '../lib/predicate';

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — expected ${expected}, got ${actual}`}`);
}

function evaluate(loanId: bigint, fundingFact: (typeof FIXTURE_FACTS)[keyof typeof FIXTURE_FACTS]) {
  const loan = FIXTURE_LOANS.find((l) => l.id === loanId)!;
  const repayment =
    loan.repaymentFactId === '0x0000000000000000000000000000000000000000000000000000000000000000'
      ? null
      : Object.values(FIXTURE_FACTS).find((f) => factIdOf(f) === loan.repaymentFactId) ?? null;

  const base = dryRun(
    {
      loan,
      originator: FIXTURE_ORIGINATOR,
      repayment,
      funding: fundingFact,
      fundingFactId: factIdOf(fundingFact),
      currentBlock: FIXTURE_CURRENT_BLOCK,
    },
    FIXTURE_PARAMS.bondPerLoan,
    FIXTURE_PARAMS.bountyBps,
  );

  return applyTreasuryBinding(
    base,
    fixtureTreasuryOwner(fundingFact.from),
    loan.originatorId,
    fundingFact.from,
  );
}

console.log('\nScenario B — prohibited circular flow (treasury funded the payer)');
{
  const r = evaluate(2n, FIXTURE_FACTS.bFunding);
  check('all eleven conditions satisfied', r.wouldSucceed, true);
  check('no failing condition', r.firstFailure, null);
  check('condition count', r.conditions.length, 11);
  check(
    'projected bounty is half the bond',
    r.projectedBounty,
    FIXTURE_PARAMS.bondPerLoan / 2n,
  );
}

console.log('\nScenario A — legitimate loan (borrower funded by an unbound faucet)');
{
  const r = evaluate(1n, FIXTURE_FACTS.aFaucet);
  check('challenge would fail', r.wouldSucceed, false);
  check('fails at condition 6', r.firstFailure?.n, 6);
  check('reverts FundingNotFromBoundTreasury', r.firstFailure?.errorName, 'FundingNotFromBoundTreasury');
  check('no bounty projected', r.projectedBounty, null);
}

console.log('\nScenario C — citing the loan’s own disbursement as the funding leg');
{
  const r = evaluate(1n, FIXTURE_FACTS.aDisburse);
  check('challenge would fail', r.wouldSucceed, false);
  check('fails at condition 11', r.firstFailure?.n, 11);
  check('reverts DisbursementNotFunding', r.firstFailure?.errorName, 'DisbursementNotFunding');
}

console.log('\nOrdering — funding after the repayment it allegedly funded');
{
  // Loan B's repayment is at block 11529478; cite a later transfer as funding.
  const late = { ...FIXTURE_FACTS.bFunding, blockHeight: 11529999n };
  const r = evaluate(2n, late);
  check('challenge would fail', r.wouldSucceed, false);
  check('fails at condition 8', r.firstFailure?.n, 8);
}

console.log('\nWindow — funding far outside the published circular window');
{
  const old = { ...FIXTURE_FACTS.bFunding, blockHeight: 11529478n - 9999n };
  const r = evaluate(2n, old);
  check('challenge would fail', r.wouldSucceed, false);
  check('fails at condition 9', r.firstFailure?.n, 9);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exitCode = failures === 0 ? 0 : 1;
