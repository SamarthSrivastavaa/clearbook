import type { Address, Hex } from 'viem';

/**
 * Protocol types and vocabulary, mirroring the contracts exactly.
 *
 * The status names and covenant text here are the same strings the contracts and
 * BUILD.md use. They are not restated in friendlier language anywhere in the UI:
 * a state called BREACHED on-chain is called BREACHED on screen.
 */

/** Mirrors Clearbook.LoanStatus. Order is the on-chain enum order. */
export enum LoanStatus {
  NONE = 0,
  REGISTERED = 1,
  REPAYMENT_CLAIMED = 2,
  DELINQUENT = 3,
  SETTLED = 4,
  BREACHED = 5,
}

export type Tone = 'verified' | 'breach' | 'pending' | 'inert';

export const STATUS_META: Record<LoanStatus, { label: string; tone: Tone; description: string }> = {
  [LoanStatus.NONE]: {
    label: 'None',
    tone: 'inert',
    description: 'No loan is registered at this identifier.',
  },
  [LoanStatus.REGISTERED]: {
    label: 'Registered',
    tone: 'pending',
    description: 'Disbursement evidence is verified and bonded. No repayment has been claimed.',
  },
  [LoanStatus.REPAYMENT_CLAIMED]: {
    label: 'Repayment claimed',
    tone: 'pending',
    description: 'A repayment claim cites verified evidence. The challenge window is open.',
  },
  [LoanStatus.DELINQUENT]: {
    label: 'Delinquent',
    tone: 'pending',
    description: 'Maturity passed with no repayment claim. Marked by any party.',
  },
  [LoanStatus.SETTLED]: {
    label: 'Settled',
    tone: 'verified',
    description: 'The challenge window closed without a successful challenge. Terminal.',
  },
  [LoanStatus.BREACHED]: {
    label: 'Breached',
    tone: 'breach',
    description: 'A covenant breach was proven on-chain. Bond slashed. Terminal.',
  },
};

/** Covenant identifiers, mirroring CovenantLib. */
export const COVENANTS = {
  CIRCULAR_REPAYMENT: 0x01,
  EVIDENCE_UNIQUENESS: 0x02,
  EVIDENCE_FIRST: 0x03,
} as const;

/**
 * The precise meaning of a CIRCULAR_REPAYMENT breach. This text is required to
 * appear verbatim wherever the covenant is presented (BUILD.md §4.1).
 */
export const CIRCULAR_REPAYMENT_MEANING =
  'A breach of CIRCULAR_REPAYMENT establishes that two verified transfers occurred in a specific relationship. ' +
  'It does not establish intent, control of either address by any person or entity, the existence of an off-chain loan, ' +
  "or any violation of law. It establishes that the originator's own published rule was not met.";

export interface TransferFact {
  chainKey: bigint;
  blockHeight: bigint;
  txIndex: bigint;
  logIndex: number;
  token: Address;
  from: Address;
  to: Address;
  amount: bigint;
  submitter: Address;
  ccBlock: bigint;
}

export interface Loan {
  id: bigint;
  originatorId: bigint;
  token: Address;
  borrower: Address;
  principal: bigint;
  maturityBlock: bigint;
  disbursementFactId: Hex;
  repaymentFactId: Hex;
  claimBlock: bigint;
  status: LoanStatus;
}

export interface Originator {
  id: bigint;
  owner: Address;
  name: string;
  bond: bigint;
  exposure: bigint;
  circularWindow: number;
  challengeWindow: number;
  lastClaimBlock: bigint;
  covenants: number;
  active: boolean;
}

export const ZERO_FACT = '0x0000000000000000000000000000000000000000000000000000000000000000' as const;

export function hasFact(factId: Hex | undefined): boolean {
  return !!factId && factId !== ZERO_FACT;
}

/** A loan is challengeable only while a claimed repayment sits inside its window. */
export function isChallengeable(loan: Loan, originator: Originator, currentBlock: bigint): boolean {
  return (
    loan.status === LoanStatus.REPAYMENT_CLAIMED &&
    currentBlock <= loan.claimBlock + BigInt(originator.challengeWindow)
  );
}

/** Blocks remaining before finalize() becomes callable. Negative means closed. */
export function blocksLeftInWindow(loan: Loan, originator: Originator, currentBlock: bigint): bigint {
  return loan.claimBlock + BigInt(originator.challengeWindow) - currentBlock;
}
