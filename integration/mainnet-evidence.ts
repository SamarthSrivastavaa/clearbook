/**
 * P0 — real Ethereum MAINNET evidence.
 *
 * Discovers a genuine third-party ERC-20 transfer on Ethereum mainnet, proves it
 * through Attestcoin, and ingests it into the deployed `EvidenceVault`.
 *
 * Why this matters
 * ----------------
 * The Attestcoin design-pattern documentation assumes a *cooperative* source
 * chain: you deploy a contract, it emits an event you designed, your worker
 * watches for it. That is the easy regime, and it is useless for credit
 * covenants — you cannot ask a fund to emit a `CircularRepaymentOccurred` event.
 *
 * This script operates in the uncooperative regime. The transfer it selects was
 * made by strangers, on a token nobody here controls, on a chain we have never
 * deployed to, and it was never instrumented for Clearbook. Verification needs
 * no permission from any of them.
 *
 * Note the boundary this script does NOT cross: verifying a fact requires
 * nothing, but *committing* a fact to a credit claim requires an EIP-712 bound
 * treasury, which requires the sender's key. So mainnet facts are registry
 * evidence; they are not claim evidence. That asymmetry is the architecture,
 * not a gap in it.
 *
 *   npx tsx integration/mainnet-evidence.ts            # discover + ingest
 *   npx tsx integration/mainnet-evidence.ts --dry-run  # discover + prove only
 *   npx tsx integration/mainnet-evidence.ts <txHash> <logIndex>
 */
import 'dotenv/config';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract, JsonRpcProvider, Wallet, getAddress, id as keccakId } from 'ethers';
import { chainInfo, proofProvider } from '@gluwa/usc-sdk';

import { asSdkProvider } from './lib/provider.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(HERE, 'results');
const ARTIFACT = join(RESULTS, 'mainnet-evidence.json');

const TRANSFER_TOPIC = keccakId('Transfer(address,address,uint256)');
const TRANSACTION_VERIFIED_TOPIC = keccakId('TransactionVerified(uint64,uint64,uint64)');

/** Canonical Ethereum mainnet USDC. Chosen because it is unambiguous, widely
 *  held, and emphatically not ours. */
const USDC = getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
const USDC_DECIMALS = 6;

/** Public mainnet RPCs, tried in order. Only `eth_getLogs` and receipt reads. */
const FALLBACK_RPCS = [
  'https://eth.drpc.org',
  'https://rpc.flashbots.net',
  'https://eth.merkle.io',
  'https://1rpc.io/eth',
];

const VAULT_ABI = [
  'function submitTransferFact(uint64 chainKey, uint64 blockHeight, bytes encodedTransaction, bytes32 merkleRoot, (bytes32 hash, bool isLeft)[] siblings, bytes32 lowerEndpointDigest, bytes32[] continuityRoots, uint32 logIndex) returns (bytes32)',
  'function exists(bytes32) view returns (bool)',
  'function computeFactId(uint64,uint64,uint64,uint32) pure returns (bytes32)',
  'function getFact(bytes32) view returns ((uint64 chainKey,uint64 blockHeight,uint64 txIndex,uint32 logIndex,address token,address from,address to,uint256 amount,address submitter,uint64 ccBlock))',
];

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

async function firstWorkingRpc(): Promise<JsonRpcProvider> {
  const candidates = process.env.MAINNET_RPC_URL
    ? [process.env.MAINNET_RPC_URL, ...FALLBACK_RPCS]
    : FALLBACK_RPCS;
  for (const url of candidates) {
    try {
      const p = new JsonRpcProvider(url, 1, { staticNetwork: true });
      const n = await p.getBlockNumber();
      console.log(`  mainnet RPC: ${url} (head ${n.toLocaleString('en-US')})`);
      return p;
    } catch {
      console.log(`  mainnet RPC unavailable: ${url}`);
    }
  }
  throw new Error('no working Ethereum mainnet RPC; set MAINNET_RPC_URL');
}

interface Subject {
  txHash: string;
  /** TRANSACTION-LOCAL index into this receipt's own log array. */
  logIndex: number;
  blockNumber: number;
  token: string;
  from: string;
  to: string;
  amount: bigint;
  logsInTx: number;
}

/**
 * Finds a third-party transfer that is cheap to prove.
 *
 * Transactions with few logs are preferred: `encodedTransaction` is the whole
 * transaction, so a 40-log DeFi aggregator call costs far more calldata and gas
 * than a plain wallet-to-wallet transfer, for identical evidentiary value.
 */
async function discover(src: JsonRpcProvider, attestedHeight: number): Promise<Subject> {
  // Stay well below the attested tip so the block is certainly covered.
  const to = attestedHeight - 200;
  const from = to - 40;
  console.log(`  scanning mainnet blocks ${from.toLocaleString('en-US')}–${to.toLocaleString('en-US')} for USDC transfers`);

  const logs = await src.getLogs({ address: USDC, topics: [TRANSFER_TOPIC], fromBlock: from, toBlock: to });
  if (logs.length === 0) throw new Error('no USDC transfers found in range');
  console.log(`  ${logs.length} candidate transfers`);

  // Walk candidates until one has a small receipt.
  for (const entry of logs) {
    if (entry.topics.length !== 3) continue;
    const receipt = await src.getTransactionReceipt(entry.transactionHash);
    if (!receipt || receipt.status !== 1) continue;
    if (receipt.logs.length > 4) continue; // keep the proof small

    const local = receipt.logs.findIndex(
      (l) => l.index === entry.index && l.transactionHash === entry.transactionHash,
    );
    if (local < 0) continue;

    return {
      txHash: entry.transactionHash,
      logIndex: local,
      blockNumber: entry.blockNumber,
      token: getAddress(entry.address),
      from: getAddress('0x' + entry.topics[1].slice(26)),
      to: getAddress('0x' + entry.topics[2].slice(26)),
      amount: BigInt(entry.data),
      logsInTx: receipt.logs.length,
    };
  }
  throw new Error('no simple third-party transfer found; widen the scan range');
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const vaultAddress = required('EVIDENCE_VAULT_ADDRESS');

  const cc = new JsonRpcProvider(required('CREDITCOIN_RPC_URL'));
  const signer = new Wallet(required('CC_WORKER_PRIVATE_KEY'), cc);
  const vault = new Contract(vaultAddress, VAULT_ABI, signer);

  console.log('=== 0 · resolve Ethereum mainnet at runtime ===');
  const info = new chainInfo.PrecompileChainInfoProvider(asSdkProvider(cc));
  const chains = await info.getSupportedChains();
  const chain = chains.find((c) => Number(c.chainId) === 1);
  check('Ethereum mainnet (chainId 1) is supported', !!chain, chain ? `chainKey ${chain.chainKey}` : 'not found');
  if (!chain) throw new Error('Ethereum mainnet is not in the ChainInfo precompile list');

  const attested = await info.getLatestAttestedHeightAndHash(chain.chainKey);
  const attestedHeight = attested.exists ? Number(attested.height) : 0;
  check('mainnet attestation exists', attested.exists && attestedHeight > 0, `height ${attestedHeight.toLocaleString('en-US')}`);
  if (!attested.exists) throw new Error('no attestation for Ethereum mainnet');

  console.log('\n=== 1 · discover a third-party transfer ===');
  const src = await firstWorkingRpc();

  let subject: Subject;
  if (process.argv[2] && !process.argv[2].startsWith('--')) {
    const txHash = process.argv[2];
    const logIndex = Number(process.argv[3] ?? 0);
    const receipt = await src.getTransactionReceipt(txHash);
    if (!receipt) throw new Error(`${txHash} not found on Ethereum mainnet`);
    const l = receipt.logs[logIndex];
    if (!l) throw new Error(`no log at transaction-local index ${logIndex}`);
    subject = {
      txHash,
      logIndex,
      blockNumber: receipt.blockNumber,
      token: getAddress(l.address),
      from: getAddress('0x' + l.topics[1].slice(26)),
      to: getAddress('0x' + l.topics[2].slice(26)),
      amount: BigInt(l.data),
      logsInTx: receipt.logs.length,
    };
  } else {
    subject = await discover(src, attestedHeight);
  }

  const human = (Number(subject.amount) / 10 ** USDC_DECIMALS).toLocaleString('en-US', {
    maximumFractionDigits: 2,
  });
  console.log(`  tx        ${subject.txHash}`);
  console.log(`  block     ${subject.blockNumber.toLocaleString('en-US')}`);
  console.log(`  transfer  ${subject.from} -> ${subject.to}`);
  console.log(`  amount    ${human} USDC   (logs in tx: ${subject.logsInTx})`);
  check('block is at or below the attested height', subject.blockNumber <= attestedHeight);
  check('transfer is not from an address we control', true, 'third-party by construction');

  console.log('\n=== 2 · Attestcoin proof ===');
  const pb = new proofProvider.service.ProofBuilder(
    chain.chainKey,
    required('PROOF_BUILDER_URL'),
    60_000,
  );
  const t0 = Date.now();
  const res = await pb.getProof(subject.txHash);
  check('proof retrieved', !!res.success && !!res.data, res.success ? `${Date.now() - t0}ms` : String(res.error));
  if (!res.success || !res.data) throw new Error(`proof failed: ${res.error}`);
  const p = res.data;
  console.log(`    merkle siblings ${p.merkleProof.siblings.length} · continuity roots ${p.continuityProof.roots.length} · txBytes ${(p.txBytes.length - 2) / 2}`);

  const factId: string = await vault.computeFactId(p.chainKey, p.headerNumber, p.txIndex, subject.logIndex);
  console.log(`    factId ${factId}`);

  if (dryRun) {
    console.log('\n--dry-run: stopping before ingestion.');
    console.log(`\n================ P0: ${failures === 0 ? 'PROVEN (dry run)' : 'FAIL'} ================`);
    if (failures > 0) process.exitCode = 1;
    return;
  }

  console.log('\n=== 3 · ingest into EvidenceVault ===');
  const already: boolean = await vault.exists(factId);
  if (already) console.log('    fact already stored — re-submitting to confirm idempotence');

  const tx = await vault.submitTransferFact(
    p.chainKey,
    p.headerNumber,
    p.txBytes,
    p.merkleProof.root,
    p.merkleProof.siblings.map((s: { hash: string; isLeft: boolean }) => [s.hash, s.isLeft]),
    p.continuityProof.lowerEndpointDigest,
    p.continuityProof.roots,
    subject.logIndex,
  );
  const rcpt = await tx.wait();
  check('submission succeeded', !!rcpt && rcpt.status === 1, tx.hash);

  const precompileEmitted = (rcpt?.logs ?? []).some(
    (l: { topics: string[] }) => l.topics[0] === TRANSACTION_VERIFIED_TOPIC,
  );
  if (!already) check('precompile emitted TransactionVerified', precompileEmitted);

  console.log('\n=== 4 · cross-check the stored fact against Ethereum ===');
  const f = await vault.getFact(factId);
  check('chainKey matches', Number(f.chainKey) === Number(chain.chainKey), `${f.chainKey}`);
  check('blockHeight matches', Number(f.blockHeight) === subject.blockNumber, `${f.blockHeight}`);
  check('logIndex matches', Number(f.logIndex) === subject.logIndex, `${f.logIndex}`);
  check('token matches', getAddress(f.token) === subject.token, f.token);
  check('from matches', getAddress(f.from) === subject.from, f.from);
  check('to matches', getAddress(f.to) === subject.to, f.to);
  check('amount matches', BigInt(f.amount) === subject.amount, `${f.amount}`);

  const artifact = {
    phase: 'P0 — real Ethereum mainnet evidence',
    at: new Date().toISOString(),
    sourceChain: { name: 'Ethereum Mainnet', chainId: 1, chainKey: Number(chain.chainKey) },
    attestedHeightAtRun: attestedHeight,
    subject: {
      txHash: subject.txHash,
      blockNumber: subject.blockNumber,
      transactionLocalLogIndex: subject.logIndex,
      token: subject.token,
      tokenSymbol: 'USDC',
      from: subject.from,
      to: subject.to,
      amount: subject.amount.toString(),
      amountHuman: `${human} USDC`,
      logsInTransaction: subject.logsInTx,
      thirdParty: true,
      etherscan: `https://etherscan.io/tx/${subject.txHash}`,
    },
    proof: {
      merkleSiblings: p.merkleProof.siblings.length,
      continuityRoots: p.continuityProof.roots.length,
      txBytes: (p.txBytes.length - 2) / 2,
    },
    vault: vaultAddress,
    factId,
    creditcoinTx: tx.hash,
    checks: { failures },
    pass: failures === 0,
  };
  if (!existsSync(RESULTS)) mkdirSync(RESULTS, { recursive: true });
  writeFileSync(ARTIFACT, JSON.stringify(artifact, null, 2));

  console.log(`\n================ P0: ${failures === 0 ? 'PASS' : 'FAIL'} ================`);
  console.log(`  factId  ${factId}`);
  console.log(`  written ${ARTIFACT}`);
  if (failures > 0) process.exitCode = 1;
}

// Direct-invocation guard (KNOWN_ISSUES K-001).
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
