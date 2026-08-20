/**
 * Worker entry point — orchestration only (BUILD.md §8).
 *
 * The pipeline is:
 *   DISCOVERED -> WAITING_ATTESTATION -> PROVED -> SUBMITTED -> CONFIRMED
 * with PRECHECK_FAILED and FAILED as terminal side-exits.
 *
 * Restart safety: every transition is persisted before the next begins, the
 * database key mirrors the on-chain factId, and the vault is idempotent. Kill the
 * process at any point and the replay is a no-op — no evidence lost, no duplicate
 * submission (BUILD.md Gate 8a).
 *
 * This process decides NOTHING about whether evidence is true. It fetches bundles
 * and pays gas. Delete it and any third party can submit the identical bundle.
 */
import 'dotenv/config';
import { JsonRpcProvider } from 'ethers';

import { Db, type FactRow } from './db.js';
import { resolveChainKey, latestAttestedHeight } from './discover.js';
import { HealthServer } from './health.js';
import { log, metrics } from './log.js';
import { Prechecker } from './precheck.js';
import { Prover, ProofError, type ProofBundle } from './prove.js';
import { Submitter } from './submit.js';
import { Watcher } from './watch.js';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

interface Runtime {
  db: Db;
  cc: JsonRpcProvider;
  src: JsonRpcProvider;
  chainKey: number;
  chainId: number;
  watcher: Watcher;
  prover: Prover;
  prechecker: Prechecker;
  submitter: Submitter;
  health: HealthServer;
}

async function buildRuntime(): Promise<Runtime> {
  const ccUrl = required('CREDITCOIN_RPC_URL');
  const srcUrl = required('SOURCE_CHAIN_RPC_URL');
  const proverUrl = required('PROOF_BUILDER_URL');
  const token = required('SOURCE_TOKEN_ADDRESS');
  const vaultAddress = required('EVIDENCE_VAULT_ADDRESS');
  const workerKey = required('CC_WORKER_PRIVATE_KEY');
  const chainId = Number(process.env.SOURCE_CHAIN_ID ?? 11155111);

  const cc = new JsonRpcProvider(ccUrl);
  const src = new JsonRpcProvider(srcUrl);

  // Fatal if discovery fails. Never fall back to a hardcoded chain key.
  const chain = await resolveChainKey(cc, chainId);

  const db = new Db(required('DATABASE_URL'));
  await db.migrate();

  const watched = [
    process.env.DEMO_TREASURY_ADDRESS,
    process.env.DEMO_BORROWER_ADDRESS,
    process.env.DEMO_PAYER_ADDRESS,
  ].filter((a): a is string => Boolean(a));

  if (watched.length === 0) {
    log.warn('no watched addresses configured; the watcher will discover nothing', {});
  }

  const health = new HealthServer(Number(process.env.HEALTH_PORT ?? 8080));

  return {
    db,
    cc,
    src,
    chainKey: chain.chainKey,
    chainId: chain.chainId,
    watcher: new Watcher(src, db, { chainKey: chain.chainKey, token, watched }),
    prover: new Prover(chain.chainKey, proverUrl),
    prechecker: new Prechecker(cc),
    submitter: new Submitter(cc, workerKey, vaultAddress),
    health,
  };
}

/** Drives one fact from DISCOVERED through to CONFIRMED. */
async function advance(rt: Runtime, row: FactRow): Promise<void> {
  const fields = { correlationId: row.correlationId, txHash: row.txHash };

  try {
    // 1. Wait for the source block to be attested and cached by the prover.
    await rt.db.setState(row.id, 'WAITING_ATTESTATION');
    log.info('waiting for attestation', { ...fields, state: 'WAITING_ATTESTATION' });
    await rt.prover.waitUntilAttested(row.blockHeight);

    // 2. Acquire the proof bundle.
    const bundle: ProofBundle = await rt.prover.getProof(row.txHash);

    // 3. txIndex comes from the precompile, never from the watcher's guess.
    const txIndex = await rt.prechecker.calculateTxIndex(bundle);
    await rt.db.setState(row.id, 'PROVED', { txIndex });
    log.info('proved', { ...fields, state: 'PROVED', txIndex });

    // 4. Free pre-flight check before spending gas.
    const pre = await rt.prechecker.verify(bundle);
    if (!pre.ok) {
      await rt.db.setState(row.id, 'PRECHECK_FAILED', { lastError: pre.reason });
      log.warn('precheck failed, not submitting', { ...fields, state: 'PRECHECK_FAILED', error: pre.reason });
      return;
    }

    // 5. Submit. Idempotent at the vault, so a crash here replays harmlessly.
    const factId = await rt.submitter.computeFactId(bundle, txIndex, row.logIndex);
    await rt.db.setState(row.id, 'SUBMITTED', { factId });
    const result = await rt.submitter.submit(bundle, txIndex, row.logIndex);

    await rt.db.setState(row.id, 'CONFIRMED', { factId: result.factId, ccTxHash: result.ccTxHash });
    log.info('confirmed', {
      ...fields,
      state: 'CONFIRMED',
      factId: result.factId,
      ccTxHash: result.ccTxHash,
      alreadyExisted: result.alreadyExisted,
    });
  } catch (e: unknown) {
    const message = (e as Error).message ?? String(e);
    await rt.db.recordAttempt(row.id, message);
    metrics.increment('errors_total', { class: e instanceof ProofError ? e.failureClass : 'UNKNOWN' });

    // Retriable failures stay in the queue; permanent ones are parked.
    const retriable = !(e instanceof ProofError) || e.retriable;
    if (retriable) {
      await rt.db.setState(row.id, 'DISCOVERED', { lastError: message });
      log.warn('transient failure, will retry', { ...fields, error: message });
    } else {
      await rt.db.setState(row.id, 'FAILED', { lastError: message });
      log.error('permanent failure', { ...fields, state: 'FAILED', error: message });
    }
  }
}

async function tick(rt: Runtime): Promise<void> {
  const attested = await latestAttestedHeight(rt.cc, rt.chainKey);
  if (!attested.exists) {
    rt.health.update({ status: 'degraded', lastError: 'no attestations for chain' });
    log.warn('no attestations yet', { chainKey: rt.chainKey });
    return;
  }

  const sourceHead = await rt.src.getBlockNumber();
  await rt.watcher.scan(attested.height);

  const cursor = await rt.db.getCursor(rt.chainKey);
  rt.health.updateChain(rt.chainKey, {
    chainId: rt.chainId,
    attestedHeight: attested.height,
    sourceHead,
    cursor,
    cursorLag: cursor == null ? null : attested.height - cursor,
  });

  const pending = await rt.db.claimNext(['DISCOVERED'], 5);
  for (const row of pending) await advance(rt, row);

  rt.health.update({
    status: 'ok',
    lastScanAt: new Date().toISOString(),
    dbConnected: await rt.db.ping(),
    factsByState: await rt.db.countByState(),
  });
}

async function main(): Promise<void> {
  const rt = await buildRuntime();
  rt.health.start();

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info('shutting down', { signal });
    await rt.health.stop();
    await rt.db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  log.info('worker started', {
    chainKey: rt.chainKey,
    chainId: rt.chainId,
    submitter: rt.submitter.address,
  });

  const intervalMs = Number(process.env.WORKER_TICK_MS ?? 30_000);
  while (!stopping) {
    try {
      await tick(rt);
    } catch (e: unknown) {
      const message = (e as Error).message ?? String(e);
      rt.health.update({ status: 'degraded', lastError: message });
      log.error('tick failed', { error: message });
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

main().catch((e) => {
  log.error('fatal', { error: (e as Error).message ?? String(e) });
  process.exitCode = 1;
});
