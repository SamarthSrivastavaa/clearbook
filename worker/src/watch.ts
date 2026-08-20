/**
 * Source-chain watcher (BUILD.md §8.1).
 *
 * Scans for ERC-20 Transfer logs involving a watched address set, resuming from
 * the persisted cursor. At-least-once by design: re-discovering the same log is
 * harmless because the database key and the on-chain factId are both unique.
 *
 * Scanning stays behind the attested height, since a proof cannot be produced for
 * a block that has not been attested yet.
 */
import { JsonRpcProvider, getAddress } from 'ethers';

import { log, metrics } from './log.js';
import type { Db } from './db.js';

/** keccak256("Transfer(address,address,uint256)") */
export const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export interface Candidate {
  chainKey: number;
  blockHeight: number;
  txHash: string;
  txIndex: number;
  /** Index within the receipt's log array — transaction-local, per BUILD.md §3.1. */
  logIndex: number;
  token: string;
  from: string;
  to: string;
  amount: string;
}

export interface WatchConfig {
  chainKey: number;
  token: string;
  /** Addresses we care about, in either direction. */
  watched: string[];
  /** Blocks per eth_getLogs call. */
  batchSize?: number;
  /** How far behind the attested height to start if there is no cursor. */
  lookback?: number;
}

export class Watcher {
  private watchedSet: Set<string>;

  constructor(
    private readonly src: JsonRpcProvider,
    private readonly db: Db,
    private readonly config: WatchConfig,
  ) {
    this.watchedSet = new Set(config.watched.map((a) => getAddress(a).toLowerCase()));
  }

  private isWatched(address: string): boolean {
    return this.watchedSet.has(address.toLowerCase());
  }

  /**
   * Scans up to `attestedHeight`, persisting candidates and advancing the cursor.
   * Returns the number of newly discovered candidates.
   */
  async scan(attestedHeight: number): Promise<number> {
    const batchSize = this.config.batchSize ?? 500;
    const lookback = this.config.lookback ?? 2_000;

    const cursor = await this.db.getCursor(this.config.chainKey);
    let from = cursor != null ? cursor + 1 : Math.max(0, attestedHeight - lookback);
    if (from > attestedHeight) {
      log.debug('cursor is ahead of attested height, nothing to scan', { from, attestedHeight });
      return 0;
    }

    let discovered = 0;
    while (from <= attestedHeight) {
      const to = Math.min(from + batchSize - 1, attestedHeight);
      discovered += await this.scanRange(from, to);
      // Persist after each range so a crash resumes here, not at the beginning.
      await this.db.setCursor(this.config.chainKey, to);
      from = to + 1;
    }

    if (discovered > 0) log.info('scan complete', { discovered, upTo: attestedHeight });
    return discovered;
  }

  private async scanRange(fromBlock: number, toBlock: number): Promise<number> {
    const logs = await this.src.getLogs({
      address: this.config.token,
      fromBlock,
      toBlock,
      topics: [ERC20_TRANSFER_TOPIC],
    });

    let discovered = 0;
    const receiptCache = new Map<string, number[]>();

    for (const entry of logs) {
      // ERC-721 shares topic0 but carries four topics.
      if (entry.topics.length !== 3) continue;
      if (entry.data.length !== 66) continue;

      const from = getAddress('0x' + entry.topics[1].slice(26));
      const to = getAddress('0x' + entry.topics[2].slice(26));
      if (!this.isWatched(from) && !this.isWatched(to)) continue;

      // Translate the block-global index into a transaction-local one.
      let indices = receiptCache.get(entry.transactionHash);
      if (!indices) {
        const receipt = await this.src.getTransactionReceipt(entry.transactionHash);
        if (!receipt || receipt.status !== 1) continue;
        indices = receipt.logs.map((l) => l.index);
        receiptCache.set(entry.transactionHash, indices);
      }
      const localIndex = indices.indexOf(entry.index);
      if (localIndex < 0) continue;

      const correlationId = `${this.config.chainKey}-${entry.blockNumber}-${entry.transactionIndex}-${localIndex}`;
      const row = await this.db.insertDiscovered({
        chainKey: this.config.chainKey,
        blockHeight: entry.blockNumber,
        txHash: entry.transactionHash,
        txIndex: entry.transactionIndex,
        logIndex: localIndex,
        token: getAddress(entry.address),
        sender: from,
        recipient: to,
        amount: BigInt(entry.data).toString(),
        correlationId,
      });

      if (row) {
        discovered++;
        metrics.increment('facts_discovered_total');
        log.info('candidate discovered', {
          correlationId,
          txHash: entry.transactionHash,
          state: 'DISCOVERED',
          blockHeight: entry.blockNumber,
          logIndex: localIndex,
        });
      }
    }

    return discovered;
  }
}
