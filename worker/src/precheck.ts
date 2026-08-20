/**
 * Free pre-flight verification (BUILD.md §8.1).
 *
 * Calls the precompile's `verify()` VIEW before spending any gas. This is purely
 * an economy: it costs nothing and skips bundles that would revert on-chain.
 *
 * It is NOT a security control. A bundle passing precheck is not trusted — the
 * vault re-verifies through `verifyAndEmit` regardless, and that on-chain call is
 * the only thing that makes a fact real. Deleting this module would cost gas, not
 * safety.
 */
import { JsonRpcProvider } from 'ethers';
import { blockProver } from '@gluwa/usc-sdk';

import { log, metrics } from './log.js';
import { asSdkProvider } from './provider.js';
import type { ProofBundle } from './prove.js';

export interface PrecheckResult {
  ok: boolean;
  reason?: string;
}

export class Prechecker {
  private prover: blockProver.PrecompileBlockProver;

  constructor(cc: JsonRpcProvider) {
    this.prover = new blockProver.PrecompileBlockProver(asSdkProvider(cc));
  }

  async verify(bundle: ProofBundle): Promise<PrecheckResult> {
    try {
      const ok = await this.prover.verifySingle(
        bundle.chainKey,
        bundle.headerNumber,
        bundle.txBytes,
        bundle.merkleProof,
        bundle.continuityProof,
      );
      if (!ok) {
        metrics.increment('facts_precheck_failed_total');
        log.warn('precheck returned false', { txHash: bundle.txHash, blockHeight: bundle.headerNumber });
        return { ok: false, reason: 'precompile verify() returned false' };
      }
      return { ok: true };
    } catch (e: unknown) {
      // The precompile's failure mode is still unverified (KNOWN_ISSUES K-007):
      // it may revert rather than return false. Treat both as "do not submit".
      const reason = (e as Error).message ?? String(e);
      metrics.increment('facts_precheck_failed_total');
      log.warn('precheck threw', { txHash: bundle.txHash, blockHeight: bundle.headerNumber, error: reason });
      return { ok: false, reason };
    }
  }

  /** Resolves txIndex from the proof, via the precompile rather than user input. */
  async calculateTxIndex(bundle: ProofBundle): Promise<number> {
    return Number(await this.prover.computeTransactionIndex(bundle.merkleProof));
  }
}
