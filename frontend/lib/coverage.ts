/**
 * Activity coverage.
 *
 * The obvious objection to any evidence-bound loan book is that the originator
 * simply does not register the activity it would rather nobody looked at.
 * Clearbook cannot prevent that. What it can do is measure it.
 *
 * Coverage is the fraction of an originator's qualifying outbound source-chain
 * transfers, from treasuries it has bound by signature, that were actually
 * committed to a claim:
 *
 *     coverage = committed / qualifying
 *
 * It is a ratio with a stated denominator and an explicit scope. It is NOT a
 * score, a rating, or an opinion about creditworthiness, and nothing here may
 * be rendered without its denominator beside it.
 *
 * WHAT IT CANNOT SEE
 *
 * Only bound treasuries are measurable. An originator operating from an address
 * it never declared is invisible to this number, and that limitation ships next
 * to every figure rather than in a footnote. What makes the measurement worth
 * anything is that binding is permanent — `Clearbook.bindTreasury` reverts with
 * `AlreadyBound` on any address already bound, and no unbind path exists — so a
 * treasury cannot be quietly un-declared once its activity looks inconvenient.
 */
import { keccak256, encodeAbiParameters, parseAbiItem, type Address, type Hex } from 'viem';

import { sourceClientFor, ccClient } from './verifier';
import { clearbookAbi, evidenceVaultAbi } from './abi';
import { contracts } from './config';

/**
 * The ERC-20 Transfer event, given to viem as a parsed item rather than as raw
 * topics. viem's `getLogs` has no raw `topics` parameter: passing one is
 * silently dropped, which produces every transfer of the token instead of the
 * treasury's, and therefore a denominator wrong by orders of magnitude.
 */
const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

/** Source-chain blocks measured. Bounded because an unbounded scan is not servable. */
export const COVERAGE_WINDOW_BLOCKS = 20_000n;

/**
 * Creditcoin blocks searched for treasury bindings. Same bound as the fact
 * registry, and raised for the same reason: at 20,000 blocks a binding older
 * than about three and a half days fell out of range, and an originator whose
 * treasury had aged out measured as having declared nothing at all. Coverage
 * would then report "no treasury" for a book that had one. The single binding
 * on this deployment sits 26,459 blocks back, which the old bound missed.
 */
export const BINDING_LOOKBACK_BLOCKS = 60_000n;

/**
 * The source RPC rejects `eth_getLogs` spans above 10,000 blocks outright
 * ("range 20000 exceeds limit of 10000"), so 5,000 sits safely under it while
 * covering the window in four calls rather than forty. Filtering `from`
 * server-side is what keeps each response small enough for that to work.
 */
const SOURCE_CHUNK = 5_000n;

/** Creditcoin's RPC times out at 10s on wider spans for sparse events. */
const CC_CHUNK = 2_000n;

/**
 * Chunk size for the binding scan, measured rather than guessed.
 *
 * Scanning the Clearbook contract is heavier than scanning the vault because it
 * carries far more events. A single `getLogs` measured 1.45s at 10,000 blocks
 * and 4.9s at 20,000; three 20,000-block calls issued together exceeded the
 * RPC's 10s query timeout outright. 10,000 with a fan-out of two keeps every
 * request comfortably inside it.
 */
const CC_SCAN_CHUNK = 10_000n;

export interface CoverageScope {
  chainKey: number;
  /**
   * The tokens this originator's own claims are denominated in, read from the
   * book rather than configured. Measuring a token an originator never lends in
   * would pad the denominator; ignoring one they do would hide activity.
   */
  tokens: Address[];
  fromBlock: bigint;
  toBlock: bigint;
}

export interface BoundTreasury {
  address: Address;
  /** Creditcoin block the binding was recorded in. */
  boundAt: bigint;
}

export interface Coverage {
  originatorId: bigint;
  treasuries: BoundTreasury[];
  scope: CoverageScope;
  /** The denominator: qualifying outbound transfers in scope. */
  qualifying: number;
  /** The numerator: those committed as a claim's disbursement. */
  committed: number;
  /** Proved into the vault, never claimed. */
  verifiedNotCommitted: number;
  /** Never entered the verification pipeline at all. */
  unverified: number;
  /** Transactions skipped because the receipt did not succeed. */
  revertedSkipped: number;
}

/**
 * The vault's fact identity, derived locally.
 *
 * Must agree with `EvidenceVault.computeFactId` exactly; `scripts/_coverage_probe.ts`
 * asserts that against the deployed contract for every transfer it measures.
 */
export function factIdOf(chainKey: number, blockHeight: bigint, txIndex: bigint, logIndex: number): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'uint64' }, { type: 'uint64' }, { type: 'uint64' }, { type: 'uint32' }],
      [BigInt(chainKey), blockHeight, txIndex, logIndex],
    ),
  );
}

/**
 * Runs `work` over `items` at most `limit` at a time.
 *
 * A full `Promise.all` fan-out over the chunked span timed out: the Creditcoin
 * RPC tolerates a 20,000-block `getLogs` in about 3.4s on its own, but eight of
 * them at once exceeded its 10s query timeout, and the Clearbook contract is the
 * heavier of the two to scan because it carries far more events than the vault.
 * Three at a time keeps every individual request inside the timeout while still
 * finishing in a third of the sequential wall time.
 */
async function mapLimit<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await work(items[i]!);
    }
  });
  await Promise.all(runners);
  return out;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const treasuryBoundEvent = (clearbookAbi as any).find(
  (e: any) => e.type === 'event' && e.name === 'TreasuryBound',
);

/** Every treasury bound to an originator, from the protocol's own events. */
export async function boundTreasuries(originatorId: bigint, ccHead: bigint): Promise<BoundTreasury[]> {
  if (!contracts.clearbook) return [];
  const from = ccHead > BINDING_LOOKBACK_BLOCKS ? ccHead - BINDING_LOOKBACK_BLOCKS : 0n;

  // Chunked and issued together. Sequentially, 160,000 blocks at the old chunk
  // size was eighty round trips; in parallel at this size it is eight.
  const spans: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
  for (let start = from; start <= ccHead; start += CC_SCAN_CHUNK) {
    const end = start + CC_SCAN_CHUNK - 1n > ccHead ? ccHead : start + CC_SCAN_CHUNK - 1n;
    spans.push({ fromBlock: start, toBlock: end });
  }

  const batches = await mapLimit(spans, 2, (span) =>
    ccClient.getLogs({
      address: contracts.clearbook!,
      event: treasuryBoundEvent,
      args: { originatorId } as never,
      fromBlock: span.fromBlock,
      toBlock: span.toBlock,
    }),
  );

  const found: BoundTreasury[] = [];
  for (const l of batches.flat() as unknown as Array<{
    args: { ethAddress: Address; ccBlock: bigint };
  }>) {
    found.push({ address: l.args.ethAddress, boundAt: BigInt(l.args.ccBlock) });
  }
  return found;
}

/**
 * Measures one originator.
 *
 * `committedFactIds` is the set of disbursement facts already on the book; the
 * caller reads it once and shares it across originators rather than re-deriving
 * it per treasury.
 */
export async function measureCoverage(
  originatorId: bigint,
  treasuries: BoundTreasury[],
  scope: CoverageScope,
  committedFactIds: Set<string>,
): Promise<Coverage> {
  const src = sourceClientFor(scope.chainKey);
  let qualifying = 0;
  let committed = 0;
  let verifiedNotCommitted = 0;
  let unverified = 0;
  let revertedSkipped = 0;

  // One receipt fetch per transaction, not per log: a single transaction can
  // carry many Transfer logs and they all share the same receipt.
  const receiptCache = new Map<string, number[] | null>();

  for (const treasury of treasuries) {
    for (const token of scope.tokens) {
      for (let start = scope.fromBlock; start <= scope.toBlock; start += SOURCE_CHUNK) {
        const end = start + SOURCE_CHUNK - 1n > scope.toBlock ? scope.toBlock : start + SOURCE_CHUNK - 1n;

        // `args.from` is what builds the indexed topic filter. viem has no raw
        // `topics` parameter — passing one is silently dropped, which returns
        // every transfer of the token and inflates the denominator enormously.
        const logs = await src.getLogs({
          address: token,
          event: TRANSFER_EVENT,
          args: { from: treasury.address },
          fromBlock: start,
          toBlock: end,
        });

        for (const entry of logs) {
          let indices = receiptCache.get(entry.transactionHash);
          if (indices === undefined) {
            const receipt = await src.getTransactionReceipt({ hash: entry.transactionHash });
            indices = receipt.status === 'success' ? receipt.logs.map((l) => l.logIndex) : null;
            receiptCache.set(entry.transactionHash, indices);
          }
          if (indices === null) {
            revertedSkipped++;
            continue;
          }

          // The vault keys facts by the log's position within its own receipt,
          // not by the block-global index getLogs reports. Conflating the two
          // yields a valid-looking factId for a fact that does not exist.
          const localIndex = indices.indexOf(entry.logIndex);
          if (localIndex < 0) continue;

          qualifying++;
          const factId = factIdOf(scope.chainKey, entry.blockNumber, BigInt(entry.transactionIndex), localIndex);

          if (committedFactIds.has(factId.toLowerCase())) {
            committed++;
          } else if (contracts.evidenceVault) {
            const exists = await ccClient.readContract({
              address: contracts.evidenceVault,
              abi: evidenceVaultAbi,
              functionName: 'exists',
              args: [factId],
            });
            if (exists) verifiedNotCommitted++;
            else unverified++;
          } else {
            unverified++;
          }
        }
      }
    }
  }

  return {
    originatorId,
    treasuries,
    scope,
    qualifying,
    committed,
    verifiedNotCommitted,
    unverified,
    revertedSkipped,
  };
}

/**
 * How a coverage result should be read.
 *
 * An originator with no declared treasury is not at 0% — there is no
 * denominator, so there is no ratio. Rendering 0% there would state something
 * false about a book nobody has measured.
 */
export type CoverageState = 'no-treasury' | 'no-activity' | 'measured';

export function coverageState(c: Coverage): CoverageState {
  if (c.treasuries.length === 0) return 'no-treasury';
  if (c.qualifying === 0) return 'no-activity';
  return 'measured';
}

/** One decimal place. Any more would imply precision the sample size lacks. */
export function coveragePercent(c: Coverage): string | null {
  if (coverageState(c) !== 'measured') return null;
  return `${((c.committed / c.qualifying) * 100).toFixed(1)}%`;
}
