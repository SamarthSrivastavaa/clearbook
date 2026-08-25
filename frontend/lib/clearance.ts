import { keccak256, encodeAbiParameters, type Address, type Hex } from 'viem';

import { contracts, type SourceChainInfo } from './config';
import { clearbookAbi, evidenceVaultAbi } from './abi';
import {
  attestationBounds,
  ccClient,
  fetchProof,
  resolveSourceChainKey,
  sourceClientFor,
  verifyOnChain,
  type ProofBundle,
} from './verifier';

/**
 * Clearance: is this evidence already spoken for?
 *
 * `/verify` answers a question about the world (did this transaction occur).
 * Clearance answers a question about the book (is this verified evidence already
 * committed to a claim). They are deliberately separate surfaces because they
 * are separate questions, and because only one of them is a lending decision.
 *
 * The entire module is read-only. It never signs, never writes, and never asks
 * for a wallet: a lender running a pre-advance check should not have to hold a
 * key, and a judge should be able to drive it from a cold browser.
 *
 * The scope rule, which governs every string this module can produce:
 *
 *   CLEAR means clear *in Clearbook*. It means this verified fact is not
 *   currently consumed by a Clearbook claim. It does not establish that the
 *   underlying real-world obligation is unpledged somewhere else, because
 *   Clearbook cannot observe somewhere else. Any rendering of this result that
 *   drops the qualifier is a lie, and the qualifier is therefore carried in the
 *   data rather than left to the caller to remember.
 */

/** ERC-20 `Transfer(address,address,uint256)`. Matches `EvidenceVault.ERC20_TRANSFER_TOPIC`. */
export const ERC20_TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' as const;

/**
 * The vault's fact identity, derived locally.
 *
 * Must agree with `EvidenceVault.computeFactId` exactly. `integration/gate11-clearance.ts`
 * asserts that against the deployed contract rather than trusting this comment.
 */
export function factIdOf(
  chainKey: number,
  blockHeight: bigint,
  txIndex: bigint,
  logIndex: number,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'uint64' }, { type: 'uint64' }, { type: 'uint64' }, { type: 'uint32' }],
      [BigInt(chainKey), blockHeight, txIndex, logIndex],
    ),
  );
}

/** One ERC-20 transfer inside a transaction, at its transaction-local index. */
export interface TransferLeg {
  /**
   * Position in the transaction's own log array.
   *
   * This is NOT the block-global `logIndex` that `eth_getLogs` returns. The vault
   * indexes `receipt.receiptLogs[logIndex]` on a per-transaction receipt, so the
   * transaction-local position is the one that reproduces its fact identity. Using
   * the block-global value here would compute a factId for a different log, or for
   * no log at all, and the answer would silently be about the wrong thing.
   */
  logIndex: number;
  token: Address;
  from: Address;
  to: Address;
  amount: bigint;
  factId: Hex;
}

/** Why a transaction produced no citable evidence. */
export type UnverifiableReason =
  | 'malformed-hash'
  | 'not-found'
  | 'reverted'
  | 'no-transfer-log'
  | 'not-attested'
  | 'proof-unavailable'
  | 'proof-rejected'
  | 'source-unreachable';

export type ClearanceOutcome = 'clear' | 'encumbered' | 'unverifiable';

/** The state of one transfer leg with respect to the book. */
export interface LegStatus extends TransferLeg {
  /** True once `EvidenceVault.exists` reports the fact is stored. */
  inRegistry: boolean;
  /** The loan that consumed this fact, or null. Read from the global `factConsumedBy`. */
  consumedBy: bigint | null;
}

export interface ClearanceResult {
  outcome: ClearanceOutcome;
  txHash: Hex;
  chainKey: number;
  chainId: number;
  blockHeight: bigint;
  txIndex: bigint;
  /** Every qualifying transfer in the transaction, with its book status. */
  legs: LegStatus[];
  /** Populated when the precompile ruled on the transaction. */
  proof: ProofBundle | null;
  reason: UnverifiableReason | null;
  /** Operator-facing detail for an unverifiable result. Never a guess. */
  detail: string | null;
}

/** Progress reporting, so the page can show the pipeline rather than a spinner. */
export type ClearanceStep =
  | 'locate'
  | 'chainkey'
  | 'attest'
  | 'proof'
  | 'verify'
  | 'identity'
  | 'registry'
  | 'consumed';

export type StepReporter = (step: ClearanceStep, detail?: string) => void;

/**
 * Qualifying transfer legs in a receipt, under the vault's own rules.
 *
 * Mirrors `EvidenceVault._decodeAndStore` guards 8 through 10 exactly:
 *
 *   - `topics.length !== 3` is rejected. This is what excludes an ERC-721
 *     Transfer, which shares topic0 but carries a fourth indexed topic that
 *     would otherwise be misread as an amount.
 *   - `topics[0]` must be the ERC-20 Transfer topic.
 *   - `data.length` must be exactly 32 bytes.
 *
 * A transaction may contain several qualifying legs, so this returns a list.
 * Reporting only the first would let a router call that moves value twice be
 * cleared on the strength of whichever leg happened to be unencumbered.
 */
export function transferLegs(
  logs: readonly { address: string; topics: readonly string[]; data: string }[],
  chainKey: number,
  blockHeight: bigint,
  txIndex: bigint,
): TransferLeg[] {
  const legs: TransferLeg[] = [];

  // The array position is the identity. Filtering before indexing would
  // renumber the legs and produce fact identities the vault never assigned.
  logs.forEach((log, logIndex) => {
    if (log.topics.length !== 3) return;
    if (log.topics[0]?.toLowerCase() !== ERC20_TRANSFER_TOPIC) return;
    const data = log.data.startsWith('0x') ? log.data.slice(2) : log.data;
    if (data.length !== 64) return;

    legs.push({
      logIndex,
      token: log.address as Address,
      from: `0x${log.topics[1]!.slice(-40)}` as Address,
      to: `0x${log.topics[2]!.slice(-40)}` as Address,
      amount: BigInt(`0x${data}`),
      factId: factIdOf(chainKey, blockHeight, txIndex, logIndex),
    });
  });

  return legs;
}

function unverifiable(
  txHash: Hex,
  chainKey: number,
  chainId: number,
  reason: UnverifiableReason,
  detail: string,
): ClearanceResult {
  return {
    outcome: 'unverifiable',
    txHash,
    chainKey,
    chainId,
    blockHeight: 0n,
    txIndex: 0n,
    legs: [],
    proof: null,
    reason,
    detail,
  };
}

/**
 * The clearance check, end to end.
 *
 * Order matters and is not negotiable. Verification comes before any registry
 * lookup, because a clearance answer about an unverified transaction would be an
 * answer about a claim rather than about evidence. A caller cannot reach the
 * `clear` branch without the precompile having returned true first.
 */
export async function checkClearance(
  chain: SourceChainInfo,
  txHashInput: string,
  report: StepReporter = () => {},
): Promise<ClearanceResult> {
  const { chainId } = chain;
  const trimmed = txHashInput.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
    return unverifiable(
      trimmed as Hex,
      0,
      chainId,
      'malformed-hash',
      'A transaction hash is 32 bytes of hex, written as 0x followed by 64 hex characters.',
    );
  }
  const txHash = trimmed as Hex;

  // 1 - locate on the source chain, independently of any proof.
  report('locate');
  let receipt;
  try {
    receipt = await sourceClientFor(chain.chainKey).getTransactionReceipt({ hash: txHash });
  } catch (e) {
    const message = (e as Error).message ?? String(e);
    const missing = /not be found|not found/i.test(message);
    return unverifiable(
      txHash,
      0,
      chainId,
      missing ? 'not-found' : 'source-unreachable',
      missing
        ? 'No transaction with this hash on the selected chain. Check the hash and the chain.'
        : `The source chain could not be reached: ${message}`,
    );
  }

  if (receipt.status !== 'success') {
    return unverifiable(
      txHash,
      0,
      chainId,
      'reverted',
      'The transaction reverted. Clearbook rejects reverted transactions as evidence, so there is nothing here to clear or encumber. The precompile does not check receipt status; the vault does.',
    );
  }

  const blockHeight = BigInt(receipt.blockNumber);
  const txIndex = BigInt(receipt.transactionIndex);
  report('locate', `Block ${blockHeight}, index ${receipt.transactionIndex}, receipt status 1`);

  // 2 - resolve the chain key at run time. Never hardcoded: chainKey and the EVM
  //     chain id collide at 1 while meaning different chains.
  report('chainkey');
  const chainKey = await resolveSourceChainKey(chainId);
  report('chainkey', `Resolved to chain key ${chainKey}`);

  // 3 - qualifying legs, under the vault's rules.
  report('identity');
  const legs = transferLegs(
    receipt.logs as unknown as { address: string; topics: readonly string[]; data: string }[],
    chainKey,
    blockHeight,
    txIndex,
  );
  if (legs.length === 0) {
    return unverifiable(
      txHash,
      chainKey,
      chainId,
      'no-transfer-log',
      'This transaction succeeded but contains no ERC-20 Transfer log the vault would accept. Clearbook cites token transfers; a transaction that moves no tokens carries no fact to clear.',
    );
  }
  report(
    'identity',
    `${legs.length} qualifying transfer ${legs.length === 1 ? 'leg' : 'legs'}, identified at transaction-local log ${legs.map((l) => l.logIndex).join(', ')}`,
  );

  // 4 - is the block attested? Until quorum, the evidence does not exist here.
  report('attest');
  const bounds = await attestationBounds(chainKey, Number(blockHeight));
  if (!bounds.isAttested) {
    return unverifiable(
      txHash,
      chainKey,
      chainId,
      'not-attested',
      `Not yet attested. The precompile reports bounds ${bounds.parentHeight}-${bounds.childHeight}. Attestors attest finalized blocks, so a recent transaction typically needs about eight minutes before it can be cleared.`,
    );
  }
  report('attest', `Attested, covered by bounds ${bounds.parentHeight}-${bounds.childHeight}`);

  // 5 - proof material from the untrusted proof builder.
  report('proof');
  let proof: ProofBundle;
  try {
    proof = await fetchProof(chainKey, txHash);
  } catch (e) {
    return unverifiable(
      txHash,
      chainKey,
      chainId,
      'proof-unavailable',
      `The proof builder could not supply proof material: ${(e as Error).message ?? String(e)}. This says nothing about the transaction; it says the prover is unavailable.`,
    );
  }
  report(
    'proof',
    `${proof.merkleProof.siblings.length} Merkle siblings, ${proof.continuityProof.roots.length} continuity roots`,
  );

  // 6 - the precompile decides. Nothing downstream runs unless it returns true.
  report('verify');
  const ok = await verifyOnChain(proof);
  if (!ok) {
    return unverifiable(
      txHash,
      chainKey,
      chainId,
      'proof-rejected',
      'The Block Prover precompile returned false. This proof does not establish inclusion, so no clearance answer can be given.',
    );
  }
  report('verify', 'The Block Prover precompile returned true');

  // 7 - registry presence, then the global consumption mapping.
  report('registry');
  const statuses: LegStatus[] = [];

  if (!contracts.evidenceVault || !contracts.clearbook) {
    // No deployment configured. Verification still happened and is reportable;
    // the book question is simply unanswerable, and saying "clear" here would
    // mean "clear in a book that does not exist".
    return unverifiable(
      txHash,
      chainKey,
      chainId,
      'source-unreachable',
      'No Clearbook deployment is configured for this build, so registry state cannot be read.',
    );
  }

  const vault = contracts.evidenceVault;
  const book = contracts.clearbook;

  // There is no multicall3 on this chain, so these go out as parallel eth_calls,
  // the same way every other batched read in this codebase does.
  const present = await Promise.all(
    legs.map(
      (l) =>
        ccClient.readContract({
          address: vault,
          abi: evidenceVaultAbi,
          functionName: 'exists',
          args: [l.factId],
        }) as Promise<boolean>,
    ),
  );
  report('registry', `${present.filter(Boolean).length} of ${legs.length} already stored in the vault`);

  report('consumed');
  const consumers = await Promise.all(
    legs.map(
      (l) =>
        ccClient.readContract({
          address: book,
          abi: clearbookAbi,
          functionName: 'factConsumedBy',
          args: [l.factId],
        }) as Promise<bigint>,
    ),
  );

  legs.forEach((l, i) => {
    statuses.push({
      ...l,
      inRegistry: present[i] ?? false,
      consumedBy: (consumers[i] ?? 0n) === 0n ? null : consumers[i]!,
    });
  });

  const encumbered = statuses.filter((s) => s.consumedBy !== null);
  report(
    'consumed',
    encumbered.length === 0
      ? 'No leg of this transaction is consumed by a Clearbook claim'
      : `${encumbered.length} of ${statuses.length} already consumed`,
  );

  return {
    // Any encumbered leg encumbers the transaction. A transaction is not a safe
    // thing to advance against because one of its legs happens to be free.
    outcome: encumbered.length > 0 ? 'encumbered' : 'clear',
    txHash,
    chainKey,
    chainId,
    blockHeight,
    txIndex,
    legs: statuses,
    proof,
    reason: null,
    detail: null,
  };
}

/**
 * The scope sentence.
 *
 * Exported as data, not prose, so that no surface can render an outcome without
 * it. The qualifier travels with the answer.
 */
export const SCOPE: Record<ClearanceOutcome, string> = {
  clear:
    'Clear in Clearbook means this verified fact is not currently consumed by a Clearbook claim. It does not establish that the underlying real-world obligation is unpledged elsewhere.',
  encumbered:
    'Encumbered in Clearbook means this exact verified fact is already committed to a claim on this book. The protocol will refuse a second claim citing it.',
  unverifiable:
    'Unverifiable means no clearance answer can be given, and Clearbook says so rather than defaulting to clear.',
};
