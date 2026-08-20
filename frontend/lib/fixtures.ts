import { encodeAbiParameters, keccak256, parseUnits, type Address, type Hex } from 'viem';

import { LoanStatus, type Loan, type Originator, type TransferFact } from './protocol';

/**
 * PREVIEW FIXTURES — illustrative protocol state, not on-chain state.
 *
 * These exist for one reason: the contracts are written and tested but not yet
 * deployed, and a screen cannot be designed or reviewed against an empty chain.
 * Preview mode is opt-in (NEXT_PUBLIC_PREVIEW=true) and every screen that uses it
 * carries a persistent banner saying so. The UI must never imply a result is live
 * when it is not.
 *
 * What is real here, and what is not:
 *   REAL — the token is canonical Sepolia WETH; the treasury, borrower and payer
 *          are the actual throwaway addresses generated for this project; fact
 *          identifiers are computed with the same keccak256(abi.encode(...))
 *          the vault uses, so they are internally consistent.
 *   NOT REAL — the transfers themselves. No proof has been submitted for these,
 *          no bond has been posted, and no loan exists on any chain.
 *
 * Once the demo is seeded (BUILD.md §13.1) these scenarios become genuine staged
 * transactions and preview mode is switched off for good.
 */

export const PREVIEW = process.env.NEXT_PUBLIC_PREVIEW === 'true';

/** Canonical Sepolia WETH — verified live: `Wrapped Ether`, 18 decimals. */
export const WETH: Address = '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9';
export const WETH_DECIMALS = 18;

/** Throwaway demo wallets generated for this project. */
const TREASURY: Address = '0xBD0E3aE227de189a751f3C9d4848AAcF8de6367A';
const BORROWER: Address = '0x293D20928EC6ee153219d37a060Ee7af751B61e0';
const PAYER: Address = '0x942B23859b19FE06ea8A4552681d1D7a115C7f1d';
/** An address the originator never bound — the honest-control funding source. */
const FAUCET: Address = '0x0000000000000000000000000000000000000FA0';

const SOURCE_CHAIN_KEY = 1n;

/** Mirrors EvidenceVault.computeFactId exactly. */
export function computeFactId(
  chainKey: bigint,
  blockHeight: bigint,
  txIndex: bigint,
  logIndex: number,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'uint64' }, { type: 'uint64' }, { type: 'uint64' }, { type: 'uint32' }],
      [chainKey, blockHeight, txIndex, logIndex],
    ),
  );
}

interface FactSeed {
  blockHeight: bigint;
  txIndex: bigint;
  logIndex: number;
  from: Address;
  to: Address;
  amount: bigint;
  /** Source-chain transaction hash. Illustrative in preview. */
  txHash: Hex;
  /** Creditcoin transaction that carried the verification. Illustrative. */
  ccTxHash: Hex;
  ccBlock: bigint;
}

function makeFact(seed: FactSeed): TransferFact & { txHash: Hex; ccTxHash: Hex } {
  return {
    chainKey: SOURCE_CHAIN_KEY,
    blockHeight: seed.blockHeight,
    txIndex: seed.txIndex,
    logIndex: seed.logIndex,
    token: WETH,
    from: seed.from,
    to: seed.to,
    amount: seed.amount,
    submitter: '0x06f9f53a1a7cFd399ee3a211a0d23abe1A646E42',
    ccBlock: seed.ccBlock,
    txHash: seed.txHash,
    ccTxHash: seed.ccTxHash,
  };
}

const eth = (n: string) => parseUnits(n, WETH_DECIMALS);

// --- Scenario A: legitimate loan. Borrower funded by an unbound faucet. ---
const A_DISBURSE = makeFact({
  blockHeight: 11529400n,
  txIndex: 12n,
  logIndex: 0,
  from: TREASURY,
  to: BORROWER,
  amount: eth('2.5'),
  txHash: '0xa1d0c2f4e8b7359a6c1f0d4b8e2a95c3f7d61b0e4a8c92f5d3b7e1a06c4f8d29',
  ccTxHash: '0xcc01a4f7e2b98d3c5a0f6e1b4d7c92a835f0e6b1d4a7c02f9e3b6d1a4c7f0e29',
  ccBlock: 5343900n,
});
const A_FAUCET = makeFact({
  blockHeight: 11529420n,
  txIndex: 3n,
  logIndex: 0,
  from: FAUCET,
  to: BORROWER,
  amount: eth('2.5'),
  txHash: '0xa2e1d3f5a9c86b0d7e2a1f5c9b3d64e0a8f2c7b5d1e94a3f6c0b8d2e5a1f7c40',
  ccTxHash: '0xcc02b5a8f3c09e4d6b1a7f2c5e8d03b946a1f7c2e5b8d13a06f4c9e2b5d8a13f',
  ccBlock: 5343940n,
});
const A_REPAY = makeFact({
  blockHeight: 11529460n,
  txIndex: 8n,
  logIndex: 1,
  from: BORROWER,
  to: TREASURY,
  amount: eth('2.5'),
  txHash: '0xa3f2e4a6b0d97c1e8f3b2a6d0c4e75f1b9a3d8c6e2f05b4a7d1c9e3f6a2b8d51',
  ccTxHash: '0xcc03c6b9a4d10f5e7c2b8a3d6f9e14c057b2a8d3f6c9e24b17a5d0f3c6e9b24a',
  ccBlock: 5344010n,
});

// --- Scenario B: prohibited circular flow. Treasury funds the payer. ---
const B_DISBURSE = makeFact({
  blockHeight: 11529405n,
  txIndex: 21n,
  logIndex: 0,
  from: TREASURY,
  to: PAYER,
  amount: eth('4.0'),
  txHash: '0xb1c3d5e7f9a20b4c6d8e0f2a4b6c8d0e2f4a6b8c0d2e4f6a8b0c2d4e6f8a0b21',
  ccTxHash: '0xcc11d7c0b5e21a6f8d3c9b4e7a0f25d168c3b9e4a7d0f35c28b6e1a4d7f0c35b',
  ccBlock: 5343910n,
});
const B_FUNDING = makeFact({
  blockHeight: 11529470n,
  txIndex: 5n,
  logIndex: 2,
  from: TREASURY,
  to: PAYER,
  amount: eth('4.0'),
  txHash: '0xb2d4e6f8a0b31c5d7e9f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9c1d3e5f7a9b1c32',
  ccTxHash: '0xcc12e8d1c6f32b7a9e4d0c5f8b1a36e279d4c0f5b8e1a46d39c7f2b5e8a1d46c',
  ccBlock: 5344120n,
});
const B_REPAY = makeFact({
  blockHeight: 11529478n,
  txIndex: 2n,
  logIndex: 0,
  from: PAYER,
  to: TREASURY,
  amount: eth('4.0'),
  txHash: '0xb3e5f7a9b1c42d6e8f0a2b4c6d8e0f2a4b6c8d0e2f4a6b8c0d2e4f6a8b0c2d43',
  ccTxHash: '0xcc13f9e2d7a43c8b0f5e1d6a9c2b47f38ae5d1a6c9f2b57e4ad8a3c6f9b2e57d',
  ccBlock: 5344140n,
});

// --- Scenario D: delinquent. Disbursed, never repaid, matured. ---
const D_DISBURSE = makeFact({
  blockHeight: 11529410n,
  txIndex: 30n,
  logIndex: 0,
  from: TREASURY,
  to: '0x1111111111111111111111111111111111111111',
  amount: eth('1.25'),
  txHash: '0xd1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f81',
  ccTxHash: '0xcc21a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f72',
  ccBlock: 5343920n,
});

export const FIXTURE_FACTS = {
  aDisburse: A_DISBURSE,
  aFaucet: A_FAUCET,
  aRepay: A_REPAY,
  bDisburse: B_DISBURSE,
  bFunding: B_FUNDING,
  bRepay: B_REPAY,
  dDisburse: D_DISBURSE,
} as const;

export type FixtureFact = (typeof FIXTURE_FACTS)[keyof typeof FIXTURE_FACTS];

export function factIdOf(f: TransferFact): Hex {
  return computeFactId(f.chainKey, f.blockHeight, f.txIndex, f.logIndex);
}

/** factId -> fact, so the challenge console can resolve a pasted identifier. */
export const FIXTURE_FACT_INDEX: Record<string, FixtureFact> = Object.fromEntries(
  Object.values(FIXTURE_FACTS).map((f) => [factIdOf(f).toLowerCase(), f]),
);

export const FIXTURE_ORIGINATOR: Originator = {
  id: 1n,
  owner: '0xF474Cd59FEdE99ad147889C8AaC0c4FB049B7CFF',
  name: 'Meridian Credit Partners',
  bond: parseUnits('10', 18),
  exposure: parseUnits('3', 18),
  circularWindow: 5_000,
  challengeWindow: 1_200,
  lastClaimBlock: 5344140n,
  covenants: 0x01,
  active: true,
};

/** The addresses this originator bound by signature. */
export const FIXTURE_BOUND_TREASURIES: Address[] = [TREASURY];

export const FIXTURE_LOANS: Loan[] = [
  {
    id: 1n,
    originatorId: 1n,
    token: WETH,
    borrower: BORROWER,
    principal: eth('2.5'),
    maturityBlock: 5_400_000n,
    disbursementFactId: factIdOf(A_DISBURSE),
    repaymentFactId: factIdOf(A_REPAY),
    claimBlock: 5344010n,
    status: LoanStatus.REPAYMENT_CLAIMED,
  },
  {
    id: 2n,
    originatorId: 1n,
    token: WETH,
    borrower: PAYER,
    principal: eth('4.0'),
    maturityBlock: 5_400_000n,
    disbursementFactId: factIdOf(B_DISBURSE),
    repaymentFactId: factIdOf(B_REPAY),
    claimBlock: 5344140n,
    status: LoanStatus.REPAYMENT_CLAIMED,
  },
  {
    id: 3n,
    originatorId: 1n,
    token: WETH,
    borrower: '0x1111111111111111111111111111111111111111',
    principal: eth('1.25'),
    maturityBlock: 5_343_800n,
    disbursementFactId: factIdOf(D_DISBURSE),
    repaymentFactId: '0x0000000000000000000000000000000000000000000000000000000000000000',
    claimBlock: 0n,
    status: LoanStatus.DELINQUENT,
  },
];

/** Which loan each fixture fact backs, mirroring factConsumedBy. */
export const FIXTURE_FACT_CONSUMED_BY: Record<string, bigint> = {
  [factIdOf(A_DISBURSE).toLowerCase()]: 1n,
  [factIdOf(A_REPAY).toLowerCase()]: 1n,
  [factIdOf(B_DISBURSE).toLowerCase()]: 2n,
  [factIdOf(B_REPAY).toLowerCase()]: 2n,
  [factIdOf(D_DISBURSE).toLowerCase()]: 3n,
};

/** treasuryOwner mirror: only bound addresses map to an originator. */
export function fixtureTreasuryOwner(address: string): bigint {
  return FIXTURE_BOUND_TREASURIES.some((a) => a.toLowerCase() === address.toLowerCase()) ? 1n : 0n;
}

/** A block height the preview treats as "now", keeping windows open. */
export const FIXTURE_CURRENT_BLOCK = 5344400n;

export const FIXTURE_PARAMS = {
  bondPerLoan: parseUnits('1', 18),
  slashBps: 10_000,
  bountyBps: 5_000,
  repaymentBps: 10_000,
  protocolSink: '0x000000000000000000000000000000000000dEaD' as Address,
};

/** The scenarios, named as BUILD.md §13.1 names them. */
export const FIXTURE_SCENARIOS = [
  {
    loanId: 1n,
    key: 'A',
    title: 'Legitimate',
    outcome: 'Challenge fails at condition 6',
    detail:
      'The borrower was funded by an address the originator never bound, so the covenant does not reach it. This is the honest control.',
  },
  {
    loanId: 2n,
    key: 'B',
    title: 'Prohibited circular flow',
    outcome: 'Challenge succeeds — bond slashed',
    detail:
      'The treasury funded the payer, and the payer then repaid the treasury inside the published window.',
  },
  {
    loanId: 3n,
    key: 'D',
    title: 'Delinquent',
    outcome: 'Marked by any party after maturity',
    detail: 'Disbursement verified, maturity passed, no repayment claimed.',
  },
] as const;
