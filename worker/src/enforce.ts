/**
 * The reference challenger.
 *
 * An open-source, permissionless process that watches the shared book and
 * submits real `challenge()` transactions when a covenant breach becomes
 * provable. It holds no role the protocol recognises: it is an ordinary account
 * with gas, calling the same public function the challenge console calls.
 *
 * Clearbook does not depend on this process. Nothing here can slash anyone —
 * only the deployed contract can, and it re-checks every condition itself.
 *
 * Two rules govern everything below.
 *
 * 1. THE CONTRACT IS THE AUTHORITY. The off-chain filtering is an optimisation
 *    that decides which candidates are worth a simulation, never whether a
 *    breach occurred. No transaction is broadcast unless `eth_call` against the
 *    deployed `challenge()` succeeds first with the exact arguments intended.
 *
 * 2. REPORT THE SHAPE, DO NOT FLATTEN IT. Transfer facts cannot distinguish
 *    money that funded a repayment from money that merely preceded it, so a
 *    second tranche satisfies the funding leg exactly as a circular flow does
 *    (SECURITY.md §9). Both are genuine breaches of a rule the originator
 *    published and bonded against, so both are actionable — but they are not
 *    equally telling, and the challenger says which it found rather than
 *    presenting them as the same discovery.
 *
 *    Set CHALLENGER_STRICT=true to refuse the weaker shape entirely. That is a
 *    deliberate under-enforcement of the published covenant, appropriate for an
 *    operator who would rather miss breaches than press an arguable one.
 */
import { Contract, JsonRpcProvider, Wallet, type TransactionReceipt } from 'ethers';

import { log, metrics } from './log.js';

/** Minimal ABI — only what the challenger reads and calls. */
export const CLEARBOOK_ABI = [
  'function nextLoanId() view returns (uint256)',
  'function loans(uint256) view returns (uint256 originatorId, address token, address borrower, uint256 principal, uint64 maturityBlock, bytes32 disbursementFactId, bytes32 repaymentFactId, uint64 claimBlock, uint8 status)',
  'function originators(uint256) view returns (address owner, string name, uint256 bond, uint256 exposure, uint32 circularWindow, uint32 challengeWindow, uint64 lastClaimBlock, uint16 covenants, bool active)',
  'function treasuryOwner(address) view returns (uint256)',
  'function challenge(uint256 loanId, bytes32 fundingFactId) returns (uint256)',
  'event CovenantBreached(uint256 indexed loanId, uint16 indexed covenantId, bytes32 fundingFactId, bytes32 repaymentFactId, address indexed challenger)',
  'event BountyPaid(uint256 indexed loanId, address indexed challenger, uint256 bounty, uint256 toSink)',
];

export const VAULT_FACTS_ABI = [
  'function getFact(bytes32 factId) view returns ((uint64 chainKey, uint64 blockHeight, uint64 txIndex, uint32 logIndex, address token, address from, address to, uint256 amount, address submitter, uint64 ccBlock))',
  'event TransferFactStored(bytes32 indexed factId, uint64 indexed chainKey, uint64 blockHeight, uint64 txIndex, uint32 logIndex, address indexed token, address from, address to, uint256 amount, address submitter)',
];

/** `LoanStatus.REPAYMENT_CLAIMED` — the only status a challenge can act on. */
const REPAYMENT_CLAIMED = 2;

/** Creditcoin blocks scanned for evidence. Chunked: wide ranges time the RPC out. */
const FACT_LOOKBACK_BLOCKS = 20_000n;
const FACT_CHUNK_BLOCKS = 5_000n;

export interface Fact {
  factId: string;
  chainKey: bigint;
  blockHeight: bigint;
  token: string;
  from: string;
  to: string;
  amount: bigint;
  /** Creditcoin block in which the fact was stored — used for detection latency. */
  storedAt: bigint;
}

export interface OpenClaim {
  loanId: bigint;
  originatorId: bigint;
  borrower: string;
  disbursementFactId: string;
  repaymentFactId: string;
  circularWindow: bigint;
  blocksLeft: bigint;
}

export type Outcome =
  | { kind: 'confirmed'; loanId: bigint; fundingFactId: string; ccTxHash: string; bounty: bigint; detectionLagBlocks: bigint; shape: Shape }
  | { kind: 'simulation-reverted'; loanId: bigint; fundingFactId: string; reason: string }
  | { kind: 'lost-race'; loanId: bigint; fundingFactId: string; reason: string }
  | { kind: 'declined-strict'; loanId: bigint; fundingFactId: string };

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** How strongly the evidence points, independent of whether the covenant broke. */
export type Shape = 'third-party' | 'same-borrower';

/**
 * Which shape a funding leg has.
 *
 * `third-party` — someone other than the borrower repaid the loan, and the
 * treasury had funded them. There is no ordinary lending explanation for that.
 *
 * `same-borrower` — the borrower repaid, and the treasury had also sent the
 * borrower money inside the window. The published covenant is broken either
 * way, but this is the same shape honest re-lending produces (SECURITY.md §9),
 * so it is reported as the weaker finding it is.
 */
export function fundingLegShape(fundingTo: string, borrower: string): Shape {
  return eq(fundingTo, borrower) ? 'same-borrower' : 'third-party';
}

/** True when this operator has opted out of acting on the weaker shape. */
export function isStrict(env: Record<string, string | undefined> = process.env): boolean {
  return (env.CHALLENGER_STRICT ?? '').toLowerCase() === 'true';
}

/** The repayment fields the off-chain filter compares against. */
export interface RepaymentView {
  chainKey: bigint;
  blockHeight: bigint;
  token: string;
  from: string;
  amount: bigint;
}

/**
 * Rule 1's cheap half: does this fact look like a funding leg worth simulating?
 *
 * Mirrors conditions 3-5 and 7-11 so that hopeless candidates never reach an
 * `eth_call`. It is an optimisation and nothing more — a `true` here is a
 * request for the contract's opinion, never a finding.
 */
export function matchesFundingLeg(
  f: Fact,
  repayment: RepaymentView,
  circularWindow: bigint,
  claim: Pick<OpenClaim, 'repaymentFactId' | 'disbursementFactId'>,
): boolean {
  if (f.factId === claim.repaymentFactId) return false; // 10
  if (f.factId === claim.disbursementFactId) return false; // 11
  if (f.chainKey !== repayment.chainKey) return false; // 3
  if (!eq(f.token, repayment.token)) return false; // 4
  if (!eq(f.to, repayment.from)) return false; // 5
  if (f.amount < repayment.amount) return false; // 7
  if (f.blockHeight > repayment.blockHeight) return false; // 8
  if (repayment.blockHeight - f.blockHeight > circularWindow) return false; // 9
  return true;
}

/**
 * The broadcast gate, isolated so its one guarantee is testable in isolation:
 * `broadcast` is unreachable unless `simulate` resolved.
 */
export async function gatedChallenge<T>(
  simulate: () => Promise<unknown>,
  broadcast: () => Promise<T>,
): Promise<{ sent: true; result: T } | { sent: false; reason: string }> {
  try {
    await simulate();
  } catch (e: unknown) {
    return { sent: false, reason: (e as Error).message ?? String(e) };
  }
  return { sent: true, result: await broadcast() };
}

export class ReferenceChallenger {
  private clearbook: Contract;
  private vault: Contract;
  private wallet: Wallet;
  private cc: JsonRpcProvider;

  /** Claim/fact pairs already simulated and refused, so each is tried once per run. */
  private refused = new Set<string>();

  /** Opt-in refusal of the weaker shape. Off by default. */
  private readonly strict = isStrict();

  constructor(cc: JsonRpcProvider, privateKey: string, clearbookAddress: string, vaultAddress: string) {
    this.cc = cc;
    this.wallet = new Wallet(privateKey, cc);
    this.clearbook = new Contract(clearbookAddress, CLEARBOOK_ABI, this.wallet);
    this.vault = new Contract(vaultAddress, VAULT_FACTS_ABI, cc);
  }

  /** The challenger is an ordinary account. The protocol grants it nothing. */
  get address(): string {
    return this.wallet.address;
  }

  /**
   * One pass over the book.
   *
   * Reads live state every time rather than trusting anything cached, so a
   * restart mid-flight simply re-derives the world and continues. Every claim
   * this could act on has already been re-read from the chain.
   */
  async sweep(): Promise<Outcome[]> {
    const head = await this.cc.getBlockNumber();
    const claims = await this.openClaims(BigInt(head));

    log.info('WATCHER_SCAN', { head, openClaims: claims.length });
    if (claims.length === 0) return [];

    const facts = await this.recentFacts(BigInt(head));
    const outcomes: Outcome[] = [];

    for (const claim of claims) {
      const candidates = await this.candidatesFor(claim, facts);
      for (const funding of candidates) {
        const outcome = await this.act(claim, funding);
        if (outcome) outcomes.push(outcome);
        // One successful challenge settles the claim; the rest are now stale.
        if (outcome?.kind === 'confirmed') break;
      }
    }
    return outcomes;
  }

  /** Claims in REPAYMENT_CLAIMED whose challenge window is still open. */
  private async openClaims(head: bigint): Promise<OpenClaim[]> {
    const nextLoanId: bigint = await this.clearbook.nextLoanId();
    const open: OpenClaim[] = [];

    for (let id = 1n; id < nextLoanId; id++) {
      const loan = await this.clearbook.loans(id);
      if (Number(loan.status) !== REPAYMENT_CLAIMED) continue;

      const orig = await this.clearbook.originators(loan.originatorId);
      const deadline = BigInt(loan.claimBlock) + BigInt(orig.challengeWindow);
      if (head > deadline) continue;

      open.push({
        loanId: id,
        originatorId: BigInt(loan.originatorId),
        borrower: loan.borrower,
        disbursementFactId: loan.disbursementFactId,
        repaymentFactId: loan.repaymentFactId,
        circularWindow: BigInt(orig.circularWindow),
        blocksLeft: deadline - head,
      });
    }
    return open;
  }

  /** Verified facts stored recently, read from the vault's own events. */
  private async recentFacts(head: bigint): Promise<Fact[]> {
    const from = head > FACT_LOOKBACK_BLOCKS ? head - FACT_LOOKBACK_BLOCKS : 0n;
    const filter = this.vault.filters.TransferFactStored();
    const facts: Fact[] = [];

    for (let start = from; start <= head; start += FACT_CHUNK_BLOCKS) {
      const end = start + FACT_CHUNK_BLOCKS - 1n > head ? head : start + FACT_CHUNK_BLOCKS - 1n;
      const events = await this.vault.queryFilter(filter, Number(start), Number(end));
      for (const e of events) {
        const a = (e as unknown as { args: Record<string, unknown> }).args;
        facts.push({
          factId: a.factId as string,
          chainKey: BigInt(a.chainKey as bigint),
          blockHeight: BigInt(a.blockHeight as bigint),
          token: a.token as string,
          from: a.from as string,
          to: a.to as string,
          amount: BigInt(a.amount as bigint),
          storedAt: BigInt(e.blockNumber),
        });
      }
    }
    return facts;
  }

  /**
   * Cheap off-chain filter. Mirrors the covenant only to decide what deserves a
   * simulation — it never decides that a breach occurred.
   */
  private async candidatesFor(claim: OpenClaim, facts: Fact[]): Promise<Fact[]> {
    const repayment = await this.vault.getFact(claim.repaymentFactId);

    const view: RepaymentView = {
      chainKey: BigInt(repayment.chainKey),
      blockHeight: BigInt(repayment.blockHeight),
      token: repayment.token,
      from: repayment.from,
      amount: BigInt(repayment.amount),
    };
    const matching = facts.filter((f) => matchesFundingLeg(f, view, claim.circularWindow, claim));

    const eligible: Fact[] = [];
    for (const f of matching) {
      // Condition 6 will check this on-chain anyway; doing it here avoids
      // simulating candidates that cannot possibly pass.
      const owner: bigint = await this.clearbook.treasuryOwner(f.from);
      if (owner !== claim.originatorId) continue;
      eligible.push(f);
    }
    return eligible;
  }

  /**
   * Simulate, then act. The contract decides; this only asks.
   */
  private async act(claim: OpenClaim, funding: Fact): Promise<Outcome | null> {
    const key = `${claim.loanId}:${funding.factId}`;
    if (this.refused.has(key)) return null;

    // --- Rule 2: report the shape; refuse the weaker one only in strict mode. ---
    const shape = fundingLegShape(funding.to, claim.borrower);

    if (shape === 'same-borrower' && this.strict) {
      this.refused.add(key);
      log.info('DECLINED_STRICT', {
        loanId: claim.loanId.toString(),
        factId: funding.factId,
        reason: 'funding leg paid the loan borrower; honest re-lending produces the same shape',
      });
      metrics.increment('challenger_declined_strict_total');
      return { kind: 'declined-strict', loanId: claim.loanId, fundingFactId: funding.factId };
    }

    log.info('CANDIDATE_FOUND', {
      loanId: claim.loanId.toString(),
      factId: funding.factId,
      shape,
      blocksLeft: claim.blocksLeft.toString(),
    });

    // --- Rule 1: the deployed contract is the authority. ---
    // Routed through gatedChallenge so the "no broadcast after a failed
    // simulation" guarantee lives in one tested function rather than in the
    // discipline of whoever edits this next.
    let gate: Awaited<ReturnType<typeof gatedChallenge<{ hash: string; wait: () => Promise<TransactionReceipt | null> }>>>;
    try {
      gate = await gatedChallenge(
        () => this.clearbook.challenge.staticCall(claim.loanId, funding.factId),
        () => this.clearbook.challenge(claim.loanId, funding.factId),
      );
    } catch (e: unknown) {
      // Broadcast itself failed: nonce conflict, gas estimation, RPC drop.
      // The simulation had already passed, so this is an operational race.
      const reason = (e as Error).message ?? String(e);
      this.refused.add(key);
      log.warn('LOST_RACE', { loanId: claim.loanId.toString(), factId: funding.factId, reason });
      return { kind: 'lost-race', loanId: claim.loanId, fundingFactId: funding.factId, reason };
    }

    if (!gate.sent) {
      this.refused.add(key);
      log.info('SIMULATION', {
        loanId: claim.loanId.toString(),
        factId: funding.factId,
        result: 'REVERT',
        reason: gate.reason,
      });
      return { kind: 'simulation-reverted', loanId: claim.loanId, fundingFactId: funding.factId, reason: gate.reason };
    }

    log.info('SIMULATION', { loanId: claim.loanId.toString(), factId: funding.factId, result: 'SUCCESS' });

    try {
      const tx = gate.result;
      log.info('CHALLENGE_SUBMITTED', { loanId: claim.loanId.toString(), factId: funding.factId, ccTxHash: tx.hash });

      const receipt: TransactionReceipt | null = await tx.wait();
      if (!receipt || receipt.status !== 1) {
        // Simulation passed but inclusion did not: another actor almost
        // certainly won the claim in between. Not an error, and not retried.
        this.refused.add(key);
        log.warn('LOST_RACE', { loanId: claim.loanId.toString(), factId: funding.factId, ccTxHash: tx.hash });
        return { kind: 'lost-race', loanId: claim.loanId, fundingFactId: funding.factId, reason: 'reverted on inclusion' };
      }

      const bounty = this.bountyFrom(receipt);
      const detectionLagBlocks = BigInt(receipt.blockNumber) - funding.storedAt;

      metrics.increment('challenges_confirmed_total');
      log.info('CHALLENGE_CONFIRMED', {
        loanId: claim.loanId.toString(),
        factId: funding.factId,
        ccTxHash: tx.hash,
        bounty: bounty.toString(),
        detectionLagBlocks: detectionLagBlocks.toString(),
        shape,
      });

      return { kind: 'confirmed', loanId: claim.loanId, fundingFactId: funding.factId, ccTxHash: tx.hash, bounty, detectionLagBlocks, shape };
    } catch (e: unknown) {
      // Nonce conflicts, gas failures, a claim closing mid-flight. Give up on
      // this pair for the run; the next sweep re-derives from live state.
      const reason = (e as Error).message ?? String(e);
      this.refused.add(key);
      log.warn('LOST_RACE', { loanId: claim.loanId.toString(), factId: funding.factId, reason });
      return { kind: 'lost-race', loanId: claim.loanId, fundingFactId: funding.factId, reason };
    }
  }

  /** Reads the bounty from BountyPaid rather than recomputing it. */
  private bountyFrom(receipt: TransactionReceipt): bigint {
    for (const l of receipt.logs) {
      try {
        const parsed = this.clearbook.interface.parseLog({ topics: [...l.topics], data: l.data });
        if (parsed?.name === 'BountyPaid') return BigInt(parsed.args.bounty as bigint);
      } catch {
        // Not one of ours.
      }
    }
    return 0n;
  }
}
