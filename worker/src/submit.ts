/**
 * Submission to EvidenceVault (BUILD.md §8.1).
 *
 * The worker holds no privileged role. It acquires proof bundles and pays gas.
 * If it submits a corrupted bundle the transaction reverts; if it disappears,
 * anyone else can submit the identical bundle and the on-chain result is
 * unchanged. Nothing here is trusted.
 *
 * Re-submission is safe because the vault is idempotent at the factId, so a crash
 * between broadcast and confirmation replays as a no-op rather than a duplicate.
 */
import { Contract, JsonRpcProvider, Wallet, type TransactionReceipt } from 'ethers';

import { log, metrics } from './log.js';
import type { ProofBundle } from './prove.js';

/** Minimal ABI — only what the worker calls and reads. */
export const EVIDENCE_VAULT_ABI = [
  'function submitTransferFact(uint64 chainKey, uint64 blockHeight, bytes encodedTransaction, bytes32 merkleRoot, (bytes32 hash, bool isLeft)[] siblings, bytes32 lowerEndpointDigest, bytes32[] continuityRoots, uint32 logIndex) returns (bytes32)',
  'function exists(bytes32 factId) view returns (bool)',
  'function computeFactId(uint64 chainKey, uint64 blockHeight, uint64 txIndex, uint32 logIndex) pure returns (bytes32)',
  'event TransferFactStored(bytes32 indexed factId, uint64 indexed chainKey, uint64 blockHeight, uint64 txIndex, uint32 logIndex, address indexed token, address from, address to, uint256 amount, address submitter)',
];

export interface SubmitResult {
  factId: string;
  ccTxHash: string;
  gasUsed: bigint;
  /** True when the vault already had the fact and no event was emitted. */
  alreadyExisted: boolean;
}

export class Submitter {
  private vault: Contract;
  private wallet: Wallet;

  constructor(cc: JsonRpcProvider, privateKey: string, vaultAddress: string) {
    this.wallet = new Wallet(privateKey, cc);
    this.vault = new Contract(vaultAddress, EVIDENCE_VAULT_ABI, this.wallet);
  }

  get address(): string {
    return this.wallet.address;
  }

  async computeFactId(bundle: ProofBundle, txIndex: number, logIndex: number): Promise<string> {
    return this.vault.computeFactId(bundle.chainKey, bundle.headerNumber, txIndex, logIndex);
  }

  async exists(factId: string): Promise<boolean> {
    return this.vault.exists(factId);
  }

  /**
   * Submits a bundle. Checks `exists` first purely to avoid burning gas on a
   * transaction the vault would no-op anyway; the vault's own dedupe is what
   * actually guarantees correctness.
   */
  async submit(bundle: ProofBundle, txIndex: number, logIndex: number): Promise<SubmitResult> {
    const factId: string = await this.computeFactId(bundle, txIndex, logIndex);

    if (await this.exists(factId)) {
      log.info('fact already in vault, skipping submission', { factId, txHash: bundle.txHash });
      return { factId, ccTxHash: '', gasUsed: 0n, alreadyExisted: true };
    }

    const started = Date.now();
    const tx = await this.vault.submitTransferFact(
      bundle.chainKey,
      bundle.headerNumber,
      bundle.txBytes,
      bundle.merkleProof.root,
      bundle.merkleProof.siblings.map((s) => [s.hash, s.isLeft]),
      bundle.continuityProof.lowerEndpointDigest,
      bundle.continuityProof.roots,
      logIndex,
    );
    log.info('submission broadcast', { factId, ccTxHash: tx.hash, txHash: bundle.txHash });

    const receipt: TransactionReceipt | null = await tx.wait();
    if (!receipt) throw new Error(`no receipt for ${tx.hash}`);
    if (receipt.status !== 1) throw new Error(`submission reverted: ${tx.hash}`);

    const latencyMs = Date.now() - started;
    metrics.increment('facts_submitted_total');
    metrics.observe('submit_latency_ms', latencyMs);

    // A TransferFactStored event means it was newly stored rather than deduped.
    const stored = receipt.logs.some((l) => {
      try {
        return this.vault.interface.parseLog({ topics: [...l.topics], data: l.data })?.name === 'TransferFactStored';
      } catch {
        return false;
      }
    });

    log.info('submission confirmed', {
      factId,
      ccTxHash: tx.hash,
      gasUsed: receipt.gasUsed.toString(),
      latencyMs,
      newlyStored: stored,
    });

    return { factId, ccTxHash: tx.hash, gasUsed: receipt.gasUsed, alreadyExisted: !stored };
  }
}
