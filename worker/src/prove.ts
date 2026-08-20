/**
 * Proof acquisition (BUILD.md §8.1).
 *
 * Waits for attestation, then fetches the proof bundle, classifying failures so
 * the caller can distinguish "come back later" from "this will never work".
 *
 * The proof builder is UNTRUSTED. It supplies proof *material*; the precompile is
 * what makes that material meaningful. A malicious builder can deny service here,
 * but it cannot forge a fact — a corrupted bundle simply fails verification.
 */
import { proofProvider } from '@gluwa/usc-sdk';

import { log, metrics } from './log.js';

export type ProofFailureClass = 'NOT_ATTESTED' | 'NOT_FOUND' | 'SERVICE_ERROR';

export interface ProofBundle {
  chainKey: number;
  headerNumber: number;
  txIndex: number;
  txHash: string;
  txBytes: string;
  merkleProof: { root: string; siblings: Array<{ hash: string; isLeft: boolean }> };
  continuityProof: { lowerEndpointDigest: string; roots: string[] };
  cached: boolean;
}

export class ProofError extends Error {
  constructor(
    public readonly failureClass: ProofFailureClass,
    message: string,
  ) {
    super(message);
    this.name = 'ProofError';
  }

  /** Whether waiting and trying again could plausibly succeed. */
  get retriable(): boolean {
    return this.failureClass !== 'NOT_FOUND';
  }
}

function classify(error: string): ProofFailureClass {
  const e = error.toLowerCase();
  if (e.includes('not attested') || e.includes('attestation') || e.includes('not yet')) return 'NOT_ATTESTED';
  if (e.includes('404') || e.includes('not found')) return 'NOT_FOUND';
  return 'SERVICE_ERROR';
}

export interface ProveOptions {
  pollIntervalMs?: number;
  waitTimeoutMs?: number;
  /** Attempts for the getProof call itself, after attestation is confirmed. */
  maxAttempts?: number;
  requestTimeoutMs?: number;
}

export class Prover {
  private builder: proofProvider.service.ProofBuilder;

  constructor(
    private readonly chainKey: number,
    builderUrl: string,
    requestTimeoutMs = 30_000,
  ) {
    this.builder = new proofProvider.service.ProofBuilder(chainKey, builderUrl, requestTimeoutMs);
  }

  /**
   * Blocks until the prover reports the height as attested AND present in its
   * cache. Uses the ProofBuilder implementation, not the legacy ChainInfo one:
   * on-chain attestation can precede availability in the builder's cache, and
   * asking for a proof too early fails.
   */
  async waitUntilAttested(blockHeight: number, opts: ProveOptions = {}): Promise<number> {
    const pollIntervalMs = opts.pollIntervalMs ?? Number(process.env.PROOF_POLL_INTERVAL_MS ?? 15_000);
    const waitTimeoutMs = opts.waitTimeoutMs ?? Number(process.env.PROOF_WAIT_TIMEOUT_MS ?? 2_700_000);

    const started = Date.now();
    try {
      await this.builder.waitUntilHeightAttested(this.chainKey, blockHeight, pollIntervalMs, waitTimeoutMs);
    } catch (e: unknown) {
      throw new ProofError('NOT_ATTESTED', `timed out waiting for height ${blockHeight}: ${(e as Error).message}`);
    }
    const waitedMs = Date.now() - started;
    metrics.observe('attestation_wait_ms', waitedMs);
    log.info('height attested', { blockHeight, waitedMs, chainKey: this.chainKey });
    return waitedMs;
  }

  /** Fetches a proof bundle with exponential backoff on retriable failures. */
  async getProof(txHash: string, opts: ProveOptions = {}): Promise<ProofBundle> {
    const maxAttempts = opts.maxAttempts ?? 5;
    let lastError: ProofError | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const started = Date.now();
      const res = await this.builder.getProof(txHash);

      if (res.success && res.data) {
        const latencyMs = Date.now() - started;
        metrics.observe('proof_latency_ms', latencyMs);
        metrics.increment('proofs_fetched_total');
        log.info('proof acquired', { txHash, attempt, latencyMs, cached: res.data.cached });
        return res.data as ProofBundle;
      }

      const failureClass = classify(res.error ?? 'unknown');
      lastError = new ProofError(failureClass, res.error ?? 'unknown proof failure');
      metrics.increment('errors_total', { class: failureClass });
      log.warn('proof attempt failed', { txHash, attempt, failureClass, error: res.error });

      if (!lastError.retriable) break;
      if (attempt < maxAttempts) {
        // Exponential backoff with jitter.
        const delay = Math.min(30_000, 500 * 2 ** attempt) * (0.5 + Math.random() / 2);
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    throw lastError ?? new ProofError('SERVICE_ERROR', 'proof acquisition failed');
  }
}
