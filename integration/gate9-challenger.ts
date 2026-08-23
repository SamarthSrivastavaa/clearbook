/**
 * Gate 9 — the reference challenger refuses more than it accepts.
 *
 * An autonomous actor that submits transactions against a live book has two
 * properties worth proving, and neither is "it finds breaches":
 *
 *   1. It never broadcasts after a failed simulation. This is the safety
 *      property: the deployed contract decides, always.
 *   2. It classifies the funding leg honestly, so a breach that honest
 *      re-lending would also produce is never reported as though it were the
 *      telling kind.
 *
 * Everything else — which candidates it considers, how it scans — is an
 * optimisation, because a wrong filter can only waste a call or miss a
 * detection. Neither can slash anyone.
 *
 *   npx tsx integration/gate9-challenger.ts
 */
import {
  gatedChallenge,
  fundingLegShape,
  matchesFundingLeg,
  type Fact,
  type RepaymentView,
} from '../worker/src/enforce.js';

let failures = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — expected ${expected}, got ${actual}`}`);
}

const TREASURY = '0x1111111111111111111111111111111111111111';
const BORROWER = '0x2222222222222222222222222222222222222222';
const PAYER = '0x3333333333333333333333333333333333333333';
const TOKEN = '0x4444444444444444444444444444444444444444';
const OTHER_TOKEN = '0x5555555555555555555555555555555555555555';

const REPAYMENT_ID = '0xaa';
const DISBURSEMENT_ID = '0xbb';
const CLAIM = { repaymentFactId: REPAYMENT_ID, disbursementFactId: DISBURSEMENT_ID };
const WINDOW = 5_000n;

/** The payer repaid at source block 4000. */
const repayment: RepaymentView = {
  chainKey: 1n,
  blockHeight: 4_000n,
  token: TOKEN,
  from: PAYER,
  amount: 1_000n,
};

function fact(over: Partial<Fact> = {}): Fact {
  return {
    factId: '0xcc',
    chainKey: 1n,
    blockHeight: 3_900n,
    token: TOKEN,
    from: TREASURY,
    to: PAYER,
    amount: 1_000n,
    storedAt: 100n,
    ...over,
  };
}

async function main(): Promise<void> {
  console.log('\nGate 9 — reference challenger safety\n');

  // ---------------------------------------------------------------
  console.log('The broadcast gate');
  // ---------------------------------------------------------------

  let broadcastCalls = 0;
  const broadcast = async () => {
    broadcastCalls++;
    return '0xdeadbeef';
  };

  const refused = await gatedChallenge(async () => {
    throw new Error('execution reverted: WindowClosed()');
  }, broadcast);

  check('failed simulation reports not-sent', refused.sent, false);
  check('failed simulation broadcasts NOTHING', broadcastCalls, 0);
  check(
    'failed simulation keeps the revert reason',
    refused.sent === false && refused.reason.includes('WindowClosed'),
    true,
  );

  const accepted = await gatedChallenge(async () => undefined, broadcast);
  check('successful simulation reports sent', accepted.sent, true);
  check('successful simulation broadcasts exactly once', broadcastCalls, 1);

  // A simulation that resolves falsy must still count as success — a view
  // call returning nothing is not a refusal.
  broadcastCalls = 0;
  const falsy = await gatedChallenge(async () => null, broadcast);
  check('a null simulation result is not treated as a revert', falsy.sent, true);
  check('null simulation still broadcasts', broadcastCalls, 1);

  // ---------------------------------------------------------------
  console.log('\nThe ambiguity guard (SECURITY.md §9)');
  // ---------------------------------------------------------------

  check('funding paid to the loan borrower is the weaker shape', fundingLegShape(BORROWER, BORROWER), 'same-borrower');
  check('funding paid to a third party is the telling shape', fundingLegShape(PAYER, BORROWER), 'third-party');
  check(
    'shape detection is case-insensitive on addresses',
    fundingLegShape(BORROWER.toUpperCase().replace('0X', '0x'), BORROWER),
    'same-borrower',
  );

  // ---------------------------------------------------------------
  console.log('\nCandidate filtering mirrors the covenant');
  // ---------------------------------------------------------------

  check('a genuine funding leg matches', matchesFundingLeg(fact(), repayment, WINDOW, CLAIM), true);

  check(
    'condition 10 — the repayment itself never matches',
    matchesFundingLeg(fact({ factId: REPAYMENT_ID }), repayment, WINDOW, CLAIM),
    false,
  );
  check(
    'condition 11 — the loan disbursement never matches',
    matchesFundingLeg(fact({ factId: DISBURSEMENT_ID }), repayment, WINDOW, CLAIM),
    false,
  );
  check(
    'condition 3 — a different source chain never matches',
    matchesFundingLeg(fact({ chainKey: 3n }), repayment, WINDOW, CLAIM),
    false,
  );
  check(
    'condition 4 — a different token never matches',
    matchesFundingLeg(fact({ token: OTHER_TOKEN }), repayment, WINDOW, CLAIM),
    false,
  );
  check(
    'condition 5 — funding someone other than the payer never matches',
    matchesFundingLeg(fact({ to: BORROWER }), repayment, WINDOW, CLAIM),
    false,
  );
  check(
    'condition 7 — funding below the repayment never matches',
    matchesFundingLeg(fact({ amount: 999n }), repayment, WINDOW, CLAIM),
    false,
  );
  check(
    'condition 7 — funding exactly equal to the repayment matches',
    matchesFundingLeg(fact({ amount: 1_000n }), repayment, WINDOW, CLAIM),
    true,
  );
  check(
    'condition 8 — funding after the repayment never matches',
    matchesFundingLeg(fact({ blockHeight: 4_001n }), repayment, WINDOW, CLAIM),
    false,
  );
  check(
    'condition 8 — same-block funding matches, as the contract allows',
    matchesFundingLeg(fact({ blockHeight: 4_000n }), repayment, WINDOW, CLAIM),
    true,
  );
  check(
    'condition 9 — one block outside the window never matches',
    matchesFundingLeg(fact({ blockHeight: 4_000n - WINDOW - 1n }), repayment, WINDOW, CLAIM),
    false,
  );
  check(
    'condition 9 — the last block inside the window matches',
    matchesFundingLeg(fact({ blockHeight: 4_000n - WINDOW }), repayment, WINDOW, CLAIM),
    true,
  );

  // ---------------------------------------------------------------
  console.log('\nThe tranche case, end to end');
  // ---------------------------------------------------------------

  // A second tranche: treasury pays the borrower, the borrower repays.
  const trancheRepayment: RepaymentView = { ...repayment, from: BORROWER };
  const tranche = fact({ to: BORROWER, blockHeight: 3_900n });

  check(
    'the contract-shaped filter WOULD accept the tranche',
    matchesFundingLeg(tranche, trancheRepayment, WINDOW, CLAIM),
    true,
  );
  check('and it is reported as the weaker shape', fundingLegShape(tranche.to, BORROWER), 'same-borrower');
  check(
    'a third party repaying is reported as the telling shape',
    fundingLegShape(PAYER, BORROWER),
    'third-party',
  );

  console.log(`\n${failures === 0 ? 'GATE 9 PASS' : `GATE 9 FAIL — ${failures} failing`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
