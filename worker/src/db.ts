/**
 * Persistence (BUILD.md §8.2). Postgres, one database, no ORM.
 *
 * The unique key here mirrors the on-chain factId exactly. That is the whole
 * restart-safety argument: the vault is idempotent, this key is unique, and the
 * cursor is persisted, so a crash at any point replays as a no-op.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

import { log } from './log.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export type FactState =
  | 'DISCOVERED'
  | 'WAITING_ATTESTATION'
  | 'PROVED'
  | 'PRECHECK_FAILED'
  | 'SUBMITTED'
  | 'CONFIRMED'
  | 'FAILED';

export interface FactRow {
  id: string;
  chainKey: number;
  blockHeight: number;
  txHash: string;
  txIndex: number | null;
  logIndex: number;
  token: string | null;
  sender: string | null;
  recipient: string | null;
  amount: string | null;
  factId: string | null;
  state: FactState;
  attempts: number;
  lastError: string | null;
  ccTxHash: string | null;
  correlationId: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toRow(r: any): FactRow {
  return {
    id: String(r.id),
    chainKey: Number(r.chain_key),
    blockHeight: Number(r.block_height),
    txHash: r.tx_hash,
    txIndex: r.tx_index == null ? null : Number(r.tx_index),
    logIndex: Number(r.log_index),
    token: r.token,
    sender: r.sender,
    recipient: r.recipient,
    amount: r.amount == null ? null : String(r.amount),
    factId: r.fact_id,
    state: r.state as FactState,
    attempts: Number(r.attempts ?? 0),
    lastError: r.last_error,
    ccTxHash: r.cc_tx_hash,
    correlationId: r.correlation_id,
  };
}

export class Db {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 4 });
  }

  async migrate(): Promise<void> {
    const sql = readFileSync(join(MIGRATIONS_DIR, '001_init.sql'), 'utf8');
    await this.pool.query(sql);
    log.info('migrations applied');
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------
  // Facts
  // ---------------------------------------------------------------------

  /**
   * Records a discovered candidate. Idempotent: a second discovery of the same
   * (chainKey, blockHeight, txIndex, logIndex) is a no-op, so an at-least-once
   * watcher cannot create duplicates.
   */
  async insertDiscovered(input: {
    chainKey: number;
    blockHeight: number;
    txHash: string;
    txIndex: number | null;
    logIndex: number;
    token?: string;
    sender?: string;
    recipient?: string;
    amount?: string;
    correlationId: string;
  }): Promise<FactRow | null> {
    const res = await this.pool.query(
      `INSERT INTO facts
         (chain_key, block_height, tx_hash, tx_index, log_index,
          token, sender, recipient, amount, state, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'DISCOVERED',$10)
       ON CONFLICT (chain_key, block_height, tx_index, log_index) DO NOTHING
       RETURNING *`,
      [
        input.chainKey,
        input.blockHeight,
        input.txHash,
        input.txIndex,
        input.logIndex,
        input.token ?? null,
        input.sender ?? null,
        input.recipient ?? null,
        input.amount ?? null,
        input.correlationId,
      ],
    );
    return res.rows.length ? toRow(res.rows[0]) : null;
  }

  /**
   * Re-queues every fact a crash could have stranded.
   *
   * `advance()` persists each transition before starting the next, so a hard kill
   * leaves the row in WAITING_ATTESTATION, PROVED or SUBMITTED. Nothing else ever
   * moves a row out of those states -- the catch block that would reset it does
   * not run on SIGKILL -- so without this the fact is orphaned and silently lost.
   *
   * Replaying from DISCOVERED is safe, which is the whole point of the design:
   * proving is read-only, the vault is idempotent, and the unique key mirrors the
   * on-chain factId. A row already submitted simply re-derives the same factId and
   * the vault reports it as existing rather than storing it twice.
   *
   * This runs at startup only. It assumes a single worker instance: a second
   * process booting would re-queue rows the first still has in flight. That is the
   * documented deployment shape (see KNOWN_ISSUES K-021).
   */
  async requeueStranded(): Promise<number> {
    const res = await this.pool.query(
      `UPDATE facts
          SET state = 'DISCOVERED',
              last_error = COALESCE(last_error, 'requeued after restart')
        WHERE state IN ('WAITING_ATTESTATION', 'PROVED', 'SUBMITTED')`,
    );
    return res.rowCount ?? 0;
  }

  async claimNext(states: FactState[], limit = 10): Promise<FactRow[]> {
    // FOR UPDATE SKIP LOCKED so a second worker instance cannot double-process.
    const res = await this.pool.query(
      `SELECT * FROM facts
        WHERE state = ANY($1)
        ORDER BY block_height ASC, log_index ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED`,
      [states, limit],
    );
    return res.rows.map(toRow);
  }

  async setState(id: string, state: FactState, patch: Partial<FactRow> = {}): Promise<void> {
    await this.pool.query(
      `UPDATE facts SET
         state = $2,
         fact_id = COALESCE($3, fact_id),
         tx_index = COALESCE($4, tx_index),
         cc_tx_hash = COALESCE($5, cc_tx_hash),
         last_error = $6
       WHERE id = $1`,
      [id, state, patch.factId ?? null, patch.txIndex ?? null, patch.ccTxHash ?? null, patch.lastError ?? null],
    );
  }

  async recordAttempt(id: string, error: string): Promise<void> {
    await this.pool.query('UPDATE facts SET attempts = attempts + 1, last_error = $2 WHERE id = $1', [id, error]);
  }

  async countByState(): Promise<Record<string, number>> {
    const res = await this.pool.query('SELECT state, COUNT(*)::int AS n FROM facts GROUP BY state');
    return Object.fromEntries(res.rows.map((r: any) => [r.state, r.n]));
  }

  // ---------------------------------------------------------------------
  // Cursor
  // ---------------------------------------------------------------------

  async getCursor(chainKey: number): Promise<number | null> {
    const res = await this.pool.query('SELECT last_block FROM scan_cursor WHERE chain_key = $1', [chainKey]);
    return res.rows.length ? Number(res.rows[0].last_block) : null;
  }

  async setCursor(chainKey: number, lastBlock: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO scan_cursor (chain_key, last_block) VALUES ($1,$2)
       ON CONFLICT (chain_key) DO UPDATE SET last_block = EXCLUDED.last_block`,
      [chainKey, lastBlock],
    );
  }

  // ---------------------------------------------------------------------
  // Latency
  // ---------------------------------------------------------------------

  async recordLatency(sample: {
    txHash: string;
    tBroadcast?: Date;
    tIncluded?: Date;
    tFinalized?: Date;
    tAttested?: Date;
    tProved?: Date;
    tCcConfirmed?: Date;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO latency_samples
         (tx_hash, t_broadcast, t_included, t_finalized, t_attested, t_proved, t_cc_confirmed)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        sample.txHash,
        sample.tBroadcast ?? null,
        sample.tIncluded ?? null,
        sample.tFinalized ?? null,
        sample.tAttested ?? null,
        sample.tProved ?? null,
        sample.tCcConfirmed ?? null,
      ],
    );
  }
}
