/**
 * GATE 8a — worker crash safety (BUILD.md §11 Phase 8).
 *
 * Pass criteria, both halves:
 *   1. NO DUPLICATE on-chain submission after a crash and restart
 *   2. NO FACT LOST — every in-flight fact still reaches CONFIRMED
 *
 * How the crash is produced
 * -------------------------
 * Two ways, deliberately:
 *
 *   - A real SIGKILL of the worker process while it is mid-pipeline. This is
 *     faithful but non-deterministic: it lands wherever it lands.
 *   - A forced state, written straight into the database. `advance()` persists
 *     every transition before beginning the next, so a row sitting in
 *     WAITING_ATTESTATION / PROVED / SUBMITTED with no ccTxHash is *exactly* the
 *     state a SIGKILL leaves behind. Inducing it makes "at each state" testable
 *     rather than a race we hope to win.
 *
 * The duplicate check is on-chain, not in the database: it counts
 * TransferFactStored logs for a given factId. A database that merely believes it
 * did not double-submit is worth nothing.
 *
 *   npx tsx integration/gate8a-crash.ts
 */
import 'dotenv/config';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract, JsonRpcProvider, id as keccakId } from 'ethers';
import pg from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(HERE, 'results');
const WORKER = join(HERE, '..', 'worker', 'src', 'main.ts');

/** TransferFactStored(bytes32 indexed factId, uint64 indexed chainKey, ...) */
const FACT_STORED_TOPIC = keccakId(
  'TransferFactStored(bytes32,uint64,uint64,uint64,uint32,address,address,address,uint256,address)',
);

const IN_FLIGHT = ['WAITING_ATTESTATION', 'PROVED', 'SUBMITTED'] as const;

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`    ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs the worker for a bounded window, then stops it the way given. */
async function runWorker(ms: number, how: 'SIGKILL' | 'SIGTERM'): Promise<void> {
  const child: ChildProcess = spawn('npx', ['tsx', WORKER], {
    cwd: join(HERE, '..'),
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  await sleep(ms);
  // On Windows a signal cannot reach the grandchild through npx, so the whole
  // process tree is taken down. That is closer to a real crash anyway.
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill(how);
  }
  await sleep(2_000);
}

async function main(): Promise<void> {
  const pool = new pg.Pool({ connectionString: required('DATABASE_URL'), max: 4 });
  const cc = new JsonRpcProvider(required('CREDITCOIN_RPC_URL'));
  const vaultAddress = required('EVIDENCE_VAULT_ADDRESS');

  /** Counts on-chain storage events for a factId. The authoritative check. */
  const onChainStores = async (factId: string): Promise<number> => {
    // Chunked. This RPC enforces a 10-second query budget and a single wide
    // range blows through it; 5k-block windows measured ~0.85s each.
    const latest = await cc.getBlockNumber();
    const span = 40_000;
    const chunk = 5_000;
    const start = latest > span ? latest - span : 0;
    let found = 0;
    for (let from = start; from <= latest; from += chunk) {
      const to = Math.min(from + chunk - 1, latest);
      const logs = await cc.getLogs({
        address: vaultAddress,
        topics: [FACT_STORED_TOPIC, factId],
        fromBlock: from,
        toBlock: to,
      });
      found += logs.length;
    }
    return found;
  };

  const rows = async () =>
    (await pool.query('SELECT id, fact_id, state, tx_hash FROM facts ORDER BY block_height, log_index')).rows;

  console.log('=== 0 · baseline ===');
  let all = await rows();
  check('worker has discovered facts to work with', all.length > 0, `${all.length} rows`);
  if (all.length === 0) {
    console.log('\n  Run the worker once first so it can discover facts:');
    console.log('    npx tsx worker/src/main.ts');
    process.exitCode = 1;
    return;
  }

  // Establish the precondition rather than assume it. A previous failing run
  // can leave rows stranded, and a baseline assertion that inherits that dirt
  // reports a stale failure instead of testing anything.
  let confirmed = all.filter((r) => r.state === 'CONFIRMED');
  if (confirmed.length !== all.length) {
    console.log(`    normalising: ${all.length - confirmed.length} row(s) not CONFIRMED, draining first`);
    await runWorker(40_000, 'SIGTERM');
    all = await rows();
    confirmed = all.filter((r) => r.state === 'CONFIRMED');
  }
  check('baseline: all facts CONFIRMED', confirmed.length === all.length, `${confirmed.length}/${all.length}`);

  // Every fact must already be stored exactly once. This is the number a
  // duplicate submission would push to 2.
  const baseline = new Map<string, number>();
  for (const r of all) {
    if (!r.fact_id) continue;
    const n = await onChainStores(r.fact_id);
    baseline.set(r.fact_id, n);
    check(`on-chain stores for ${r.fact_id.slice(0, 10)} == 1`, n === 1, String(n));
  }

  // ---------------------------------------------------------- a real SIGKILL
  console.log('\n=== 1 · real SIGKILL mid-pipeline ===');
  const victim = all[0];
  await pool.query(
    `UPDATE facts SET state='DISCOVERED', cc_tx_hash=NULL, last_error=NULL WHERE id=$1`,
    [victim.id],
  );
  check('a fact was re-queued to DISCOVERED', true, `row ${victim.id}`);

  // Killed after ~4s: long enough to be past DISCOVERED, short enough to be
  // somewhere inside the pipeline rather than finished.
  await runWorker(4_000, 'SIGKILL');

  const afterKill = (await rows()).find((r) => r.id === victim.id);
  console.log(`    state after SIGKILL: ${afterKill.state}`);
  const wasInFlight = (IN_FLIGHT as readonly string[]).includes(afterKill.state);

  // ------------------------------------------------- restart: does it recover?
  console.log('\n=== 2 · restart after the kill ===');
  await runWorker(45_000, 'SIGTERM');
  const afterRestart = (await rows()).find((r) => r.id === victim.id);
  check(
    'the killed fact reaches CONFIRMED after restart',
    afterRestart.state === 'CONFIRMED',
    `state=${afterRestart.state}${wasInFlight ? ` (was ${afterKill.state} at kill)` : ''}`,
  );

  // ------------------------------- each in-flight state, induced deterministically
  console.log('\n=== 3 · each in-flight state, induced ===');
  for (const state of IN_FLIGHT) {
    const target = all[1] ?? all[0];
    await pool.query(`UPDATE facts SET state=$2, cc_tx_hash=NULL WHERE id=$1`, [target.id, state]);

    await runWorker(40_000, 'SIGTERM');

    const after = (await rows()).find((r) => r.id === target.id);
    check(
      `crash at ${state} recovers to CONFIRMED`,
      after.state === 'CONFIRMED',
      `state=${after.state}`,
    );
  }

  // -------------------------------------------------- no duplicate on-chain work
  console.log('\n=== 4 · no duplicate on-chain submission ===');
  for (const [factId, before] of baseline) {
    const now = await onChainStores(factId);
    check(
      `${factId.slice(0, 10)} still stored exactly once`,
      now === before && now === 1,
      `before=${before} after=${now}`,
    );
  }

  // ------------------------------------------------------------- nothing lost
  console.log('\n=== 5 · nothing lost ===');
  all = await rows();
  const stuck = all.filter((r) => (IN_FLIGHT as readonly string[]).includes(r.state));
  check('no fact left in an in-flight state', stuck.length === 0, `${stuck.length} stuck`);
  check(
    'every fact is CONFIRMED',
    all.every((r) => r.state === 'CONFIRMED'),
    all.map((r) => r.state).join(','),
  );

  const cursor = (await pool.query('SELECT * FROM scan_cursor')).rows;
  check('scan cursor persisted', cursor.length > 0, JSON.stringify(cursor));

  const result = {
    at: new Date().toISOString(),
    vault: vaultAddress,
    facts: all.length,
    killedRow: { id: victim.id, stateAtKill: afterKill.state },
    statesTested: IN_FLIGHT,
    onChainStoresPerFact: Object.fromEntries(baseline),
    stuck: stuck.map((r) => ({ id: r.id, state: r.state })),
    checks: { failures },
    gate8a: failures === 0,
  };
  if (!existsSync(RESULTS)) mkdirSync(RESULTS, { recursive: true });
  writeFileSync(join(RESULTS, 'gate8a-crash.json'), JSON.stringify(result, null, 2));

  console.log(`\n================ GATE 8a: ${failures === 0 ? 'PASS' : 'FAIL'} ================`);
  console.log(`  written ${join(RESULTS, 'gate8a-crash.json')}`);
  await pool.end();
  if (failures > 0) process.exitCode = 1;
}

// Direct-invocation guard (KNOWN_ISSUES K-001).
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
