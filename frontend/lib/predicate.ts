import type { Hex } from 'viem';

import { LoanStatus, type Loan, type Originator, type TransferFact } from './protocol';

/**
 * Client-side mirror of the CIRCULAR_REPAYMENT predicate (BUILD.md §5.3).
 *
 * This exists so a challenger — and a judge watching over their shoulder — can
 * see exactly which of the eleven conditions hold BEFORE a wallet opens and gas
 * is spent. It is a preview, never an authority: the contract re-evaluates every
 * condition on-chain, and the on-chain result is the only one that counts. If
 * this ever disagrees with the chain, the chain is right and this is a bug.
 *
 * Each condition carries the on-chain error name it corresponds to, so a dry-run
 * failure and an actual revert speak the same vocabulary.
 */

export type ConditionStatus = 'pass' | 'fail' | 'unknown';

export interface ConditionResult {
  n: number;
  /** What the condition requires, in plain language. */
  title: string;
  /** The comparison, in protocol terms. */
  formal: string;
  status: ConditionStatus;
  /** The on-chain error raised when this condition fails. */
  errorName: string;
  /** Observed values, shown when the condition fails. */
  observed?: string;
}

export interface DryRunInput {
  loan: Loan;
  originator: Originator;
  repayment: TransferFact | null;
  funding: TransferFact | null;
  fundingFactId: Hex;
  currentBlock: bigint;
}

export interface DryRunResult {
  conditions: ConditionResult[];
  /** True only when every condition passes. */
  wouldSucceed: boolean;
  /** The first failing condition, which is what the contract would revert with. */
  firstFailure: ConditionResult | null;
  /** Expected payout if the challenge succeeds. */
  projectedBounty: bigint | null;
}

const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

export function dryRun(input: DryRunInput, bondPerLoan: bigint, bountyBps: number): DryRunResult {
  const { loan, originator, repayment, funding, fundingFactId, currentBlock } = input;
  const conditions: ConditionResult[] = [];

  const add = (
    n: number,
    title: string,
    formal: string,
    errorName: string,
    check: () => boolean | null,
    observed?: () => string,
  ) => {
    let status: ConditionStatus;
    try {
      const r = check();
      status = r === null ? 'unknown' : r ? 'pass' : 'fail';
    } catch {
      status = 'unknown';
    }
    conditions.push({
      n,
      title,
      formal,
      errorName,
      status,
      observed: status === 'fail' && observed ? observed() : undefined,
    });
  };

  // 1 — status
  add(
    1,
    'The loan has a claimed repayment',
    'loan.status == REPAYMENT_CLAIMED',
    'WrongStatus',
    () => loan.status === LoanStatus.REPAYMENT_CLAIMED,
    () => `status is ${LoanStatus[loan.status] ?? loan.status}`,
  );

  // 2 — window
  const windowEnd = loan.claimBlock + BigInt(originator.challengeWindow);
  add(
    2,
    'The challenge window is still open',
    'block.number <= claimBlock + challengeWindow',
    'WindowClosed',
    () => (loan.claimBlock === 0n ? null : currentBlock <= windowEnd),
    () => `current block ${currentBlock} is past ${windowEnd}`,
  );

  // 10 and 11 are distinctness checks the contract makes before reading facts, so
  // they are evaluated here too — they do not require the funding fact to load.
  add(
    10,
    'The funding leg is not the repayment itself',
    'fundingFactId != loan.repaymentFactId',
    'SameFact',
    () => fundingFactId.toLowerCase() !== loan.repaymentFactId.toLowerCase(),
    () => 'the cited fact is the repayment',
  );

  add(
    11,
    'The funding leg is not the loan’s own disbursement',
    'fundingFactId != loan.disbursementFactId',
    'DisbursementNotFunding',
    () => fundingFactId.toLowerCase() !== loan.disbursementFactId.toLowerCase(),
    () => 'the cited fact is the disbursement',
  );

  const both = repayment !== null && funding !== null;

  // 3 — same chain
  add(
    3,
    'Both transfers are on the same source chain',
    'funding.chainKey == repayment.chainKey',
    'ChainMismatch',
    () => (both ? funding!.chainKey === repayment!.chainKey : null),
    () => `funding chainKey ${funding!.chainKey}, repayment chainKey ${repayment!.chainKey}`,
  );

  // 4 — same token
  add(
    4,
    'Both transfers are of the same token',
    'funding.token == repayment.token',
    'TokenMismatch',
    () => (both ? funding!.token.toLowerCase() === repayment!.token.toLowerCase() : null),
    () => `${short(funding!.token)} vs ${short(repayment!.token)}`,
  );

  // 5 — the funded address is the payer
  add(
    5,
    'The address the treasury funded is the address that repaid',
    'funding.to == repayment.from',
    'NotTheSamePayer',
    () => (both ? funding!.to.toLowerCase() === repayment!.from.toLowerCase() : null),
    () => `funded ${short(funding!.to)}, repaid by ${short(repayment!.from)}`,
  );

  // 6 — funding came from a bound treasury
  add(
    6,
    'The funding came from a treasury this originator bound',
    'treasuryOwner[funding.from] == loan.originatorId',
    'FundingNotFromBoundTreasury',
    () => (funding ? null : null), // resolved by the caller via treasuryOwner
    () => `${short(funding!.from)} is not a bound treasury`,
  );

  // 7 — amount covers the repayment
  add(
    7,
    'The payer received at least what it repaid',
    'funding.amount >= repayment.amount',
    'FundingBelowRepayment',
    () => (both ? funding!.amount >= repayment!.amount : null),
    () => `received ${funding!.amount}, repaid ${repayment!.amount}`,
  );

  // 8 — ordering
  add(
    8,
    'The funding did not come after the repayment',
    'funding.blockHeight <= repayment.blockHeight',
    'FundingNotBefore',
    () => (both ? funding!.blockHeight <= repayment!.blockHeight : null),
    () => `funding at block ${funding!.blockHeight}, repayment at ${repayment!.blockHeight}`,
  );

  // 9 — inside the published window
  add(
    9,
    'The two transfers fall inside the published circular window',
    'repayment.blockHeight - funding.blockHeight <= circularWindow',
    'OutsideWindow',
    () =>
      both && funding!.blockHeight <= repayment!.blockHeight
        ? repayment!.blockHeight - funding!.blockHeight <= BigInt(originator.circularWindow)
        : null,
    () =>
      `${repayment!.blockHeight - funding!.blockHeight} blocks apart, window is ${originator.circularWindow}`,
  );

  conditions.sort((a, b) => a.n - b.n);

  const firstFailure = conditions.find((c) => c.status === 'fail') ?? null;
  const wouldSucceed = conditions.every((c) => c.status === 'pass');
  const slash = bondPerLoan;
  const projectedBounty = wouldSucceed ? (slash * BigInt(bountyBps)) / 10000n : null;

  return { conditions, wouldSucceed, firstFailure, projectedBounty };
}

/**
 * Resolves condition 6, which needs a chain read the pure predicate cannot make.
 * Kept separate so the predicate above stays a pure function of its inputs.
 */
export function applyTreasuryBinding(
  result: DryRunResult,
  fundingFromOriginatorId: bigint | null,
  loanOriginatorId: bigint,
  fundingFrom: string | null,
): DryRunResult {
  const conditions = result.conditions.map((c) => {
    if (c.n !== 6) return c;
    if (fundingFromOriginatorId === null) return { ...c, status: 'unknown' as const };
    const pass = fundingFromOriginatorId === loanOriginatorId && fundingFromOriginatorId !== 0n;
    return {
      ...c,
      status: (pass ? 'pass' : 'fail') as ConditionStatus,
      observed: pass
        ? undefined
        : fundingFromOriginatorId === 0n
          ? `${fundingFrom ? short(fundingFrom) : 'that address'} is not bound to any originator`
          : `bound to originator ${fundingFromOriginatorId}, not ${loanOriginatorId}`,
    };
  });

  const firstFailure = conditions.find((c) => c.status === 'fail') ?? null;
  const wouldSucceed = conditions.every((c) => c.status === 'pass');
  return { ...result, conditions, firstFailure, wouldSucceed };
}
