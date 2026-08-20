import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from 'viem';

/**
 * Revert decoding.
 *
 * A judge must never see a raw revert blob. Every custom error either the vault
 * or Clearbook can raise is mapped to a precise explanation of what the protocol
 * actually refused to do — and, where the error corresponds to one of the eleven
 * challenge conditions, which condition failed.
 */

export interface DecodedRevert {
  /** The on-chain error name, shown verbatim. */
  name: string;
  /** What the protocol refused, in plain language. */
  explanation: string;
  /** Condition number from the challenge predicate, when applicable. */
  condition?: number;
  /** True when the user dismissed the wallet rather than the chain rejecting. */
  userRejected?: boolean;
}

const ERROR_TEXT: Record<string, { explanation: string; condition?: number }> = {
  // --- EvidenceVault ---
  ProofRejected: {
    explanation:
      'The Block Prover precompile did not accept this proof. The transaction was not shown to be included in an attested source-chain block.',
  },
  SourceTxReverted: {
    explanation:
      'The source-chain transaction was included but reverted. A reverted transfer moved no value, so it cannot back a claim. The precompile does not check this — Clearbook does.',
  },
  LogIndexOutOfRange: {
    explanation: 'The receipt does not contain a log at that index.',
  },
  NotATransferLog: {
    explanation:
      'That log is not an ERC-20 Transfer. It either has a different event signature, or it has four topics — an ERC-721 transfer, whose token id would otherwise be misread as an amount.',
  },
  MalformedTransferLog: {
    explanation: 'The log carries a Transfer signature but its data is not a single 32-byte amount.',
  },
  UnsupportedTxType: {
    explanation: 'The transaction type is outside the range the EVM decoder supports (types 0–4).',
  },
  UnknownFact: {
    explanation: 'No verified fact exists at that identifier. Evidence must be ingested before it can be cited.',
  },
  BatchTooLarge: { explanation: 'The batch exceeds the precompile’s maximum batch size of 10.' },
  BatchRangeExceeded: {
    explanation: 'The batch spans more than 1000 blocks, which one shared continuity proof cannot cover.',
  },
  BatchLengthMismatch: { explanation: 'The batch arrays are not all the same length.' },
  EmptyBatch: { explanation: 'The batch contains no items.' },

  // --- Clearbook: challenge predicate. Condition numbers match BUILD.md §5.3. ---
  WrongStatus: {
    explanation:
      'This loan is not in a state that permits the action. A challenge requires a claimed repayment; terminal states cannot transition.',
    condition: 1,
  },
  WindowClosed: {
    explanation: 'The challenge window for this loan has closed. It can now only be finalised.',
    condition: 2,
  },
  ChainMismatch: {
    explanation:
      'The two transfers are on different source chains. Comparing them would be meaningless — a Sepolia transfer cannot be weighed against a mainnet one.',
    condition: 3,
  },
  TokenMismatch: {
    explanation: 'The two transfers are of different tokens, so they do not represent the same money.',
    condition: 4,
  },
  NotTheSamePayer: {
    explanation:
      'The address funded by the treasury is not the address that repaid. Without that link the flow is adjacent, not circular.',
    condition: 5,
  },
  FundingNotFromBoundTreasury: {
    explanation:
      'The funding transfer did not originate from a treasury this originator bound by signature. Funding from an unbound address falls outside the covenant by construction.',
    condition: 6,
  },
  FundingBelowRepayment: {
    explanation:
      'The payer received less than it repaid, so the repayment cannot have been sourced entirely from the originator’s own funds.',
    condition: 7,
  },
  FundingNotBefore: {
    explanation: 'The funding transfer occurred after the repayment it is alleged to have funded.',
    condition: 8,
  },
  OutsideWindow: {
    explanation:
      'The two transfers are further apart than the circular window this originator published and made immutable.',
    condition: 9,
  },
  SameFact: { explanation: 'The cited funding leg is the repayment itself.', condition: 10 },
  DisbursementNotFunding: {
    explanation:
      'The cited funding leg is the loan’s own disbursement. A genuine loan is treasury → borrower → treasury; citing the disbursement would make every honest loan look circular.',
    condition: 11,
  },

  // --- Clearbook: registration, bonds, claims ---
  BondTooSmall: { explanation: 'The deposit is below the minimum bond.' },
  BadWindow: { explanation: 'A window parameter is outside its permitted range.' },
  CovenantRequired: { explanation: 'An originator must opt into CIRCULAR_REPAYMENT to register.' },
  BadSignature: {
    explanation: 'The signature was not produced by the address being bound.',
  },
  AlreadyBound: {
    explanation: 'That address is already bound to an originator. An address binds to at most one, ever.',
  },
  NotOwner: { explanation: 'Only the originator’s owner account may perform this action.' },
  InactiveOriginator: { explanation: 'That originator is not active.' },
  Overexposed: {
    explanation: 'The requested withdrawal would leave the bond below the exposure of open loans.',
  },
  CooldownActive: {
    explanation:
      'The post-claim cooldown is still running. This is what prevents an originator from pulling its bond before a challenger can acquire proofs.',
  },
  TransferFailed: { explanation: 'A native transfer failed. The recipient rejected the funds.' },
  FactMismatch: {
    explanation:
      'The cited evidence does not match the claim: token, counterparty or amount differs from what was registered.',
  },
  TreasuryNotBound: {
    explanation: 'The evidence does not originate from an address this originator bound by signature.',
  },
  FactAlreadyUsed: {
    explanation: 'That evidence already backs another claim. Each verified fact backs at most one.',
  },
  InsufficientBond: { explanation: 'The originator’s free bond cannot cover another loan.' },
  AmountTooLow: { explanation: 'The repayment does not cover the principal.' },
  NotYetMature: { explanation: 'The loan has not reached its maturity block.' },
  WindowOpen: { explanation: 'The challenge window is still open. This loan cannot be settled yet.' },

  // --- Inherited from OpenZeppelin ---
  ReentrancyGuardReentrantCall: { explanation: 'A reentrant call was blocked.' },
  ECDSAInvalidSignature: { explanation: 'The signature is not a valid ECDSA signature.' },
  ECDSAInvalidSignatureLength: { explanation: 'The signature is the wrong length.' },
  ECDSAInvalidSignatureS: {
    explanation: 'The signature has a malleable s-value and was rejected.',
  },
  InvalidShortString: { explanation: 'A string parameter could not be encoded.' },
  StringTooLong: { explanation: 'A string parameter is too long.' },
};

/** Turns any thrown value into something worth showing a human. */
export function decodeRevert(error: unknown): DecodedRevert {
  if (error instanceof BaseError) {
    const rejected = error.walk((e) => e instanceof UserRejectedRequestError);
    if (rejected) {
      return {
        name: 'Rejected in wallet',
        explanation: 'The request was dismissed in your wallet. Nothing was submitted and no gas was spent.',
        userRejected: true,
      };
    }

    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName;
      if (name) {
        const known = ERROR_TEXT[name];
        return {
          name,
          explanation: known?.explanation ?? 'The contract rejected this call.',
          condition: known?.condition,
        };
      }
      if (reverted.reason) {
        return { name: 'Reverted', explanation: reverted.reason };
      }
    }

    return { name: error.name, explanation: error.shortMessage || error.message };
  }

  if (error instanceof Error) return { name: 'Error', explanation: error.message };
  return { name: 'Error', explanation: String(error) };
}

/** Explanation for an error name known ahead of time (used by the dry run). */
export function explainErrorName(name: string): string {
  return ERROR_TEXT[name]?.explanation ?? 'The contract rejected this call.';
}
