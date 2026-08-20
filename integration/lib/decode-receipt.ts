/**
 * Off-chain mirror of `EvmV1Decoder.decodeReceiptFields` from
 * @gluwa/usc-contracts/contracts/write-ability/common/EvmV1Decoder.sol.
 *
 * This exists ONLY to cross-check the proof bundle during Phase 0, before the
 * on-chain EvidenceVault exists. The authoritative decode is the Solidity one
 * inside EvidenceVault (Gate 4). Nothing in the production trust path may rely
 * on this file.
 *
 * Layout verified by reading BOTH sides of the protocol:
 *   - encoder: @gluwa/usc-sdk/src/encoding/abi/v1.ts  -> abi.encode(['uint8','bytes[]'], [txType, chunks])
 *   - decoder: EvmV1Decoder.sol `_decodeReceiptChunk` -> receiptIdx = (txType <= 2) ? 2 : 3
 *   - receipt chunk types: ['uint8','uint64','tuple(address,bytes32[],bytes)[]','bytes']
 */
import { AbiCoder, getAddress } from 'ethers';

const coder = AbiCoder.defaultAbiCoder();

export interface DecodedLog {
  address_: string;
  topics: string[];
  data: string;
}

export interface DecodedReceipt {
  txType: number;
  receiptStatus: number;
  receiptGasUsed: bigint;
  receiptLogs: DecodedLog[];
  receiptLogsBloom: string;
}

/** Reads the leading type byte, mirroring EvmV1Decoder.getTransactionType. */
export function getTransactionType(encodedTx: string): number {
  const [txType] = coder.decode(['uint8'], encodedTx.slice(0, 66));
  return Number(txType);
}

/** Mirrors EvmV1Decoder.isValidTransactionType. */
export function isValidTransactionType(txType: number): boolean {
  return txType <= 4;
}

export function decodeReceiptFields(encodedTx: string): DecodedReceipt {
  const [rawType, chunks] = coder.decode(['uint8', 'bytes[]'], encodedTx) as unknown as [bigint, string[]];
  const txType = Number(rawType);

  if (!isValidTransactionType(txType)) {
    throw new Error(`EvmV1Decoder mirror: invalid transaction type ${txType}`);
  }

  const receiptIdx = txType <= 2 ? 2 : 3;
  const expectedChunks = txType <= 2 ? 3 : 4;
  if (chunks.length !== expectedChunks) {
    throw new Error(`EvmV1Decoder mirror: bad chunks (type ${txType}): expected ${expectedChunks}, got ${chunks.length}`);
  }

  const [status, gasUsed, logs, bloom] = coder.decode(
    ['uint8', 'uint64', 'tuple(address,bytes32[],bytes)[]', 'bytes'],
    chunks[receiptIdx],
  ) as unknown as [bigint, bigint, Array<[string, string[], string]>, string];

  return {
    txType,
    receiptStatus: Number(status),
    receiptGasUsed: BigInt(gasUsed),
    receiptLogs: logs.map((l) => ({ address_: getAddress(l[0]), topics: [...l[1]], data: l[2] })),
    receiptLogsBloom: bloom,
  };
}

export interface ExtractedTransfer {
  token: string;
  from: string;
  to: string;
  amount: bigint;
}

/**
 * Mirrors EvidenceVault.submitTransferFact steps 7-11 (BUILD.md §5.1) exactly,
 * including the ERC-721 rejection (topics.length != 3) and the malformed-data guard.
 */
export function extractTransfer(
  receipt: DecodedReceipt,
  logIndex: number,
  transferTopic: string,
): ExtractedTransfer {
  if (logIndex >= receipt.receiptLogs.length) {
    throw new Error(`LogIndexOutOfRange: ${logIndex} >= ${receipt.receiptLogs.length}`);
  }
  const lg = receipt.receiptLogs[logIndex];
  if (lg.topics.length !== 3 || lg.topics[0].toLowerCase() !== transferTopic.toLowerCase()) {
    throw new Error(`NotATransferLog: topics=${lg.topics.length} topic0=${lg.topics[0]}`);
  }
  // 32 bytes = 66 hex chars including the 0x prefix
  if (lg.data.length !== 66) {
    throw new Error(`MalformedTransferLog: data length ${(lg.data.length - 2) / 2} bytes, expected 32`);
  }
  return {
    token: lg.address_,
    from: getAddress('0x' + lg.topics[1].slice(26)),
    to: getAddress('0x' + lg.topics[2].slice(26)),
    amount: BigInt(lg.data),
  };
}
