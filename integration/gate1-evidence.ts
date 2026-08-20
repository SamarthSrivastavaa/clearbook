/**
 * GATE 1 — Evidence discovery (BUILD.md §7: "Never invent a token address").
 *
 * Finds a REAL, third-party ERC-20 `Transfer` log on the supported source chain,
 * inside the currently attested range. Nothing here is invented: the token, the
 * transaction and the log are all read live from the source chain.
 *
 * Emits a candidate record carrying the TRANSACTION-LOCAL log index (the index
 * within the receipt's log array), which is what BUILD.md §3.1 requires — NOT the
 * block-global logIndex that eth_getLogs returns.
 */
import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonRpcProvider } from 'ethers';
import { asSdkProvider } from './lib/provider.js';
import { chainInfo } from '@gluwa/usc-sdk';

const RESULTS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'results');

/** keccak256("Transfer(address,address,uint256)") — independently verified with `cast keccak`. */
export const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export interface TransferCandidate {
  chainKey: number;
  chainId: number;
  txHash: string;
  blockNumber: number;
  txIndex: number;
  /** index within the receipt's log array (transaction-local), per BUILD.md §3.1 */
  logIndex: number;
  /** block-global log index, recorded only to show it differs from logIndex */
  blockLogIndex: number;
  token: string;
  from: string;
  to: string;
  amount: string;
  receiptStatus: number;
  txType: number;
}

/** Resolves the chain key for a given chainId at runtime. Never hardcoded. */
export async function resolveChainKey(
  info: chainInfo.PrecompileChainInfoProvider,
  chainId: number,
): Promise<chainInfo.ChainInfo> {
  const chains = await info.getSupportedChains();
  const match = chains.find((c) => c.chainId === chainId);
  if (!match) {
    throw new Error(
      `chainId ${chainId} is not supported by the ChainInfo precompile. ` +
        `Supported: ${chains.map((c) => `key=${c.chainKey}/id=${c.chainId}`).join(', ')}`,
    );
  }
  return match;
}

export async function findTransferCandidates(
  src: JsonRpcProvider,
  chainKey: number,
  chainId: number,
  fromBlock: number,
  toBlock: number,
  want: number,
): Promise<TransferCandidate[]> {
  const logs = await src.getLogs({ fromBlock, toBlock, topics: [ERC20_TRANSFER_TOPIC] });
  console.log(`  eth_getLogs [${fromBlock}, ${toBlock}] -> ${logs.length} Transfer logs`);

  const out: TransferCandidate[] = [];
  const seenTx = new Set<string>();

  for (const log of logs) {
    if (out.length >= want) break;
    // ERC-721 Transfer shares topic0 but has 4 topics; ERC-20 has exactly 3 (BUILD.md T7).
    if (log.topics.length !== 3) continue;
    // ERC-20 Transfer data is exactly one uint256.
    if (log.data.length !== 66) continue;
    if (seenTx.has(log.transactionHash)) continue;
    seenTx.add(log.transactionHash);

    const receipt = await src.getTransactionReceipt(log.transactionHash);
    if (!receipt || receipt.status !== 1) continue;

    const tx = await src.getTransaction(log.transactionHash);
    if (!tx) continue;
    // EvmV1Decoder supports transaction types 0-4 only.
    if (tx.type == null || tx.type > 4) continue;

    // TRANSACTION-LOCAL log index: position within this receipt's log array.
    const localIndex = receipt.logs.findIndex((l) => l.index === log.index);
    if (localIndex < 0) continue;

    out.push({
      chainKey,
      chainId,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      txIndex: receipt.index,
      logIndex: localIndex,
      blockLogIndex: log.index,
      token: log.address,
      from: '0x' + log.topics[1].slice(26),
      to: '0x' + log.topics[2].slice(26),
      amount: BigInt(log.data).toString(),
      receiptStatus: receipt.status,
      txType: tx.type,
    });
  }

  return out;
}

async function main(): Promise<void> {
  const ccUrl = process.env.CREDITCOIN_RPC_URL;
  const srcUrl = process.env.SOURCE_CHAIN_RPC_URL;
  if (!ccUrl) throw new Error('CREDITCOIN_RPC_URL is not set');
  if (!srcUrl) throw new Error('SOURCE_CHAIN_RPC_URL is not set');

  const targetChainId = Number(process.env.SOURCE_CHAIN_ID ?? 11155111);

  const cc = new JsonRpcProvider(ccUrl);
  const info = new chainInfo.PrecompileChainInfoProvider(asSdkProvider(cc));

  const chain = await resolveChainKey(info, targetChainId);
  console.log(`Resolved chainId ${targetChainId} -> chainKey ${chain.chainKey} (encoding ${chain.chainEncoding})`);

  const attested = await info.getLatestAttestedHeightAndHash(chain.chainKey);
  if (!attested.exists) throw new Error(`chainKey ${chain.chainKey} has no attestations`);
  console.log(`Latest attested height on chainKey ${chain.chainKey}: ${attested.height}`);

  const src = new JsonRpcProvider(srcUrl);
  const srcHead = await src.getBlockNumber();
  console.log(`Source chain head: ${srcHead}  (attestation lag: ${srcHead - attested.height} blocks)`);

  // Search comfortably INSIDE the attested range so the proof is available now.
  const MARGIN = 20;
  const toBlock = attested.height - MARGIN;
  const SPAN = 4;

  const candidates: TransferCandidate[] = [];
  for (let end = toBlock; end > toBlock - 200 && candidates.length < 5; end -= SPAN) {
    const found = await findTransferCandidates(
      src,
      chain.chainKey,
      chain.chainId,
      end - SPAN + 1,
      end,
      5 - candidates.length,
    );
    candidates.push(...found);
  }

  if (candidates.length === 0) throw new Error('No suitable ERC-20 Transfer found in the scanned range');

  console.log(`\n--- CANDIDATES (${candidates.length}) ---`);
  for (const c of candidates) {
    console.log(
      `tx=${c.txHash} block=${c.blockNumber} txIndex=${c.txIndex} ` +
        `logIndex=${c.logIndex} (blockLogIndex=${c.blockLogIndex}) type=${c.txType}`,
    );
    console.log(`   token=${c.token} from=${c.from} to=${c.to} amount=${c.amount}`);
  }

  mkdirSync(RESULTS_DIR, { recursive: true });
  const file = join(RESULTS_DIR, 'gate1-candidates.json');
  writeFileSync(
    file,
    JSON.stringify(
      {
        gate: 'GATE 1 — evidence discovery',
        at: new Date().toISOString(),
        chainKey: chain.chainKey,
        chainId: chain.chainId,
        attestedHeight: attested.height,
        sourceHead: srcHead,
        candidates,
      },
      null,
      2,
    ),
  );
  console.log(`\nResult written to ${file}`);
}

// Only run when invoked directly. Without this guard, importing the helpers above
// (as gate2-proof.ts does) re-scans the chain and overwrites gate1-candidates.json.
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
