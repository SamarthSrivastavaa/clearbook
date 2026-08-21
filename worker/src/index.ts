/**
 * Event projection (BUILD.md §8.1).
 *
 * Builds a read model for the UI from `EvidenceVault` and `Clearbook` events.
 *
 * This is a **pure projection**, and that word carries weight here. It derives
 * nothing, decides nothing, and adds nothing that is not already in an event the
 * chain emitted. The frontend reads contract state directly and does not depend
 * on this; the projection exists only to answer questions that would otherwise
 * need a log scan on every page load — notably "which facts back this loan" and
 * "what is this fact's source-chain transaction hash".
 *
 * That second one is the real reason this module exists. `TransferFact` stores
 * (chainKey, blockHeight, txIndex, logIndex) — coordinates, not a hash. The hash
 * only ever appears in the `TransferFactStored` event, so recovering it means
 * reading logs. Rather than have the UI invent one, it reads it from here.
 */
import { Contract, JsonRpcProvider, type Log } from 'ethers';

import { log } from './log.js';

export const VAULT_EVENT_ABI = [
  'event TransferFactStored(bytes32 indexed factId, uint64 indexed chainKey, uint64 blockHeight, uint64 txIndex, uint32 logIndex, address indexed token, address from, address to, uint256 amount, address submitter)',
];

export const CLEARBOOK_EVENT_ABI = [
  'event OriginatorRegistered(uint256 indexed originatorId, address indexed owner, string name, uint256 bond, uint32 circularWindow, uint32 challengeWindow, uint16 covenants)',
  'event TreasuryBound(uint256 indexed originatorId, address indexed ethAddress, uint256 nonce, uint64 ccBlock)',
  'event LoanRegistered(uint256 indexed loanId, uint256 indexed originatorId, address indexed token, address borrower, uint256 principal, uint64 maturityBlock, bytes32 disbursementFactId)',
  'event RepaymentClaimed(uint256 indexed loanId, bytes32 indexed repaymentFactId, uint64 claimBlock)',
  'event LoanDelinquent(uint256 indexed loanId, address indexed caller, uint64 ccBlock)',
  'event LoanSettled(uint256 indexed loanId, uint64 ccBlock)',
  'event CovenantBreached(uint256 indexed loanId, uint16 indexed covenantId, bytes32 fundingFactId, bytes32 repaymentFactId, address indexed challenger)',
  'event BountyPaid(uint256 indexed loanId, address indexed challenger, uint256 bounty, uint256 toSink)',
];

export interface FactRecord {
  factId: string;
  chainKey: number;
  blockHeight: number;
  txIndex: number;
  logIndex: number;
  token: string;
  from: string;
  to: string;
  amount: string;
  submitter: string;
  /** The Creditcoin transaction that carried the verification. */
  ccTxHash: string;
  ccBlock: number;
}

export interface BreachRecord {
  loanId: string;
  covenantId: number;
  fundingFactId: string;
  repaymentFactId: string;
  challenger: string;
  bounty?: string;
  toSink?: string;
  ccTxHash: string;
  ccBlock: number;
}

export interface ReadModel {
  facts: Record<string, FactRecord>;
  boundTreasuries: Record<string, string>;
  breaches: BreachRecord[];
  /** Last Creditcoin block scanned, so a restart resumes rather than rescans. */
  lastScannedBlock: number;
}

export function emptyReadModel(): ReadModel {
  return { facts: {}, boundTreasuries: {}, breaches: [], lastScannedBlock: 0 };
}

/** Creditcoin RPCs cap log ranges; scanning in windows keeps queries accepted. */
const SCAN_WINDOW = 2_000;

export class Projection {
  private vault: Contract;
  private clearbook: Contract;

  constructor(
    private readonly cc: JsonRpcProvider,
    vaultAddress: string,
    clearbookAddress: string,
  ) {
    this.vault = new Contract(vaultAddress, VAULT_EVENT_ABI, cc);
    this.clearbook = new Contract(clearbookAddress, CLEARBOOK_EVENT_ABI, cc);
  }

  /**
   * Advances the model to the chain head. Idempotent: re-processing a block
   * range yields the same model, because every record is keyed by an identifier
   * the chain assigned rather than by arrival order.
   */
  async sync(model: ReadModel, fromBlock?: number): Promise<ReadModel> {
    const head = await this.cc.getBlockNumber();
    let cursor = fromBlock ?? model.lastScannedBlock;
    if (cursor > head) return model;

    while (cursor <= head) {
      const to = Math.min(cursor + SCAN_WINDOW - 1, head);
      await this.scanRange(model, cursor, to);
      model.lastScannedBlock = to;
      cursor = to + 1;
    }

    log.info('projection synced', {
      head,
      facts: Object.keys(model.facts).length,
      treasuries: Object.keys(model.boundTreasuries).length,
      breaches: model.breaches.length,
    });
    return model;
  }

  private async scanRange(model: ReadModel, fromBlock: number, toBlock: number): Promise<void> {
    const [factLogs, boundLogs, breachLogs, bountyLogs] = await Promise.all([
      this.vault.queryFilter(this.vault.filters.TransferFactStored(), fromBlock, toBlock),
      this.clearbook.queryFilter(this.clearbook.filters.TreasuryBound(), fromBlock, toBlock),
      this.clearbook.queryFilter(this.clearbook.filters.CovenantBreached(), fromBlock, toBlock),
      this.clearbook.queryFilter(this.clearbook.filters.BountyPaid(), fromBlock, toBlock),
    ]);

    for (const entry of factLogs) {
      const parsed = this.vault.interface.parseLog({
        topics: [...(entry as Log).topics],
        data: (entry as Log).data,
      });
      if (!parsed) continue;
      const a = parsed.args;
      const factId = String(a.factId);
      model.facts[factId.toLowerCase()] = {
        factId,
        chainKey: Number(a.chainKey),
        blockHeight: Number(a.blockHeight),
        txIndex: Number(a.txIndex),
        logIndex: Number(a.logIndex),
        token: String(a.token),
        from: String(a.from),
        to: String(a.to),
        amount: a.amount.toString(),
        submitter: String(a.submitter),
        ccTxHash: entry.transactionHash,
        ccBlock: entry.blockNumber,
      };
    }

    for (const entry of boundLogs) {
      const parsed = this.clearbook.interface.parseLog({
        topics: [...(entry as Log).topics],
        data: (entry as Log).data,
      });
      if (!parsed) continue;
      model.boundTreasuries[String(parsed.args.ethAddress).toLowerCase()] =
        parsed.args.originatorId.toString();
    }

    // Bounty is emitted alongside the breach in the same transaction, so it is
    // matched by transaction hash rather than by position.
    const bountyByTx = new Map<string, { bounty: string; toSink: string }>();
    for (const entry of bountyLogs) {
      const parsed = this.clearbook.interface.parseLog({
        topics: [...(entry as Log).topics],
        data: (entry as Log).data,
      });
      if (!parsed) continue;
      bountyByTx.set(entry.transactionHash, {
        bounty: parsed.args.bounty.toString(),
        toSink: parsed.args.toSink.toString(),
      });
    }

    for (const entry of breachLogs) {
      const parsed = this.clearbook.interface.parseLog({
        topics: [...(entry as Log).topics],
        data: (entry as Log).data,
      });
      if (!parsed) continue;
      const a = parsed.args;
      const paid = bountyByTx.get(entry.transactionHash);
      const record: BreachRecord = {
        loanId: a.loanId.toString(),
        covenantId: Number(a.covenantId),
        fundingFactId: String(a.fundingFactId),
        repaymentFactId: String(a.repaymentFactId),
        challenger: String(a.challenger),
        bounty: paid?.bounty,
        toSink: paid?.toSink,
        ccTxHash: entry.transactionHash,
        ccBlock: entry.blockNumber,
      };
      // A loan can be breached only once, so replace rather than append on rescan.
      const existing = model.breaches.findIndex((b) => b.loanId === record.loanId);
      if (existing >= 0) model.breaches[existing] = record;
      else model.breaches.push(record);
    }
  }
}
