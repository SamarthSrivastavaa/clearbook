-- Worker persistence (BUILD.md §8.2).
--
-- The UNIQUE (chain_key, block_height, tx_index, log_index) constraint mirrors the
-- on-chain factId exactly, so the database and the chain can never disagree about
-- what has been ingested. That is what makes restart safety a property rather than
-- a hope: the vault is idempotent, this key is unique, and the cursor is persisted,
-- so a crash at any point replays as a no-op.

CREATE TABLE IF NOT EXISTS facts (
  id BIGSERIAL PRIMARY KEY,
  chain_key BIGINT NOT NULL,
  block_height BIGINT NOT NULL,
  tx_hash TEXT NOT NULL,
  tx_index BIGINT,
  log_index INT NOT NULL,
  token TEXT,
  sender TEXT,
  recipient TEXT,
  amount NUMERIC(78, 0),
  fact_id TEXT UNIQUE,
  state TEXT NOT NULL,
  attempts INT DEFAULT 0,
  last_error TEXT,
  cc_tx_hash TEXT,
  correlation_id TEXT NOT NULL,
  UNIQUE (chain_key, block_height, tx_index, log_index)
);

CREATE TABLE IF NOT EXISTS scan_cursor (
  chain_key BIGINT PRIMARY KEY,
  last_block BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS latency_samples (
  id BIGSERIAL PRIMARY KEY,
  tx_hash TEXT,
  t_broadcast TIMESTAMPTZ,
  t_included TIMESTAMPTZ,
  t_finalized TIMESTAMPTZ,
  t_attested TIMESTAMPTZ,
  t_proved TIMESTAMPTZ,
  t_cc_confirmed TIMESTAMPTZ
);

-- state ∈ {DISCOVERED, WAITING_ATTESTATION, PROVED, PRECHECK_FAILED,
--          SUBMITTED, CONFIRMED, FAILED}
CREATE INDEX IF NOT EXISTS facts_state_idx ON facts (state);
CREATE INDEX IF NOT EXISTS facts_block_height_idx ON facts (chain_key, block_height);
