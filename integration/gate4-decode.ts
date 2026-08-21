/**
 * GATE 4 — on-chain decode (BUILD.md §11 Phase 5).
 *
 * Submits real proof bundles to the deployed `EvidenceVault` and asserts that
 * the `TransferFactStored` event it emits matches the source chain exactly.
 *
 * This is the gate that proves the **Solidity** decode path works on live data.
 * Everything before it decoded receipts in TypeScript — a mirror that is
 * explicitly not the production code (DECISIONS D-010). Here the official
 * `EvmV1Decoder` runs on-chain, inside the vault, on bytes the precompile has
 * just verified.
 *
 * Pass criteria:
 *   1. the submission succeeds
 *   2. a `TransactionVerified` event from 0x0FD2 appears in the same receipt
 *   3. decoded token / from / to / amount match the source chain exactly
 *   4. re-submitting the same bundle is a no-op (no second event)
 *
 *   npx tsx integration/gate4-decode.ts [txHash] [logIndex]
 * With no arguments it submits every fact from demo/staged/proven-facts.json.
 */
import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract, JsonRpcProvider, Wallet, id as keccakId } from 'ethers';
import { chainInfo, proofProvider } from '@gluwa/usc-sdk';

import { asSdkProvider } from './lib/provider.js';

const RESULTS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'results');
const PROVEN = join(dirname(fileURLToPath(import.meta.url)), '..', 'demo', 'staged', 'proven-facts.json');

/** `TransactionVerified(uint64,uint64,uint64)` — emitted by the precompile itself. */
const TRANSACTION_VERIFIED_TOPIC = keccakId('TransactionVerified(uint64,uint64,uint64)');

const VAULT_ABI = [
  'function submitTransferFact(uint64 chainKey, uint64 blockHeight, bytes encodedTransaction, bytes32 merkleRoot, (bytes32 hash, bool isLeft)[] siblings, bytes32 lowerEndpointDigest, bytes32[] continuityRoots, uint32 logIndex) returns (bytes32)',
  'function exists(bytes32) view returns (bool)',
  'function computeFactId(uint64,uint64,uint64,uint32) pure returns (bytes32)',
  'function getFact(bytes32) view returns ((uint64 chainKey,uint64 blockHeight,uint64 txIndex,uint32 logIndex,address token,address from,address to,uint256 amount,address submitter,uint64 ccBlock))',
  'event TransferFactStored(bytes32 indexed factId, uint64 indexed chainKey, uint64 blockHeight, uint64 txIndex, uint32 logIndex, address indexed token, address from, address to, uint256 amount, address submitter)',
];

interface Subject {
  txHash: string;
  logIndex: number;
  scenario?: string;
  role?: string;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

async function main(): Promise<void> {
  const vaultAddress = required('EVIDENCE_VAULT_ADDRESS');
  const cc = new JsonRpcProvider(required('CREDITCOIN_RPC_URL'));
  const src = new JsonRpcProvider(required('SOURCE_CHAIN_RPC_URL'));
  const signer = new Wallet(required('CC_WORKER_PRIVATE_KEY'), cc);
  const vault = new Contract(vaultAddress, VAULT_ABI, signer);

  const info = new chainInfo.PrecompileChainInfoProvider(asSdkProvider(cc));
  const targetChainId = Number(process.env.SOURCE_CHAIN_ID ?? 11155111);
  const chains = await info.getSupportedChains();
  const chain = chains.find((c) => c.chainId === targetChainId);
  if (!chain) throw new Error(`chainId ${targetChainId} is not supported`);

  const pb = new proofProvider.service.ProofBuilder(
    chain.chainKey,
    required('PROOF_BUILDER_URL'),
    30_000,
  );

  // --- choose subjects ---
  let subjects: Subject[];
  if (process.argv[2]) {
    subjects = [{ txHash: process.argv[2], logIndex: Number(process.argv[3] ?? 0) }];
  } else {
    if (!existsSync(PROVEN)) throw new Error('no proven facts; run: npm run demo:prove');
    subjects = (JSON.parse(readFileSync(PROVEN, 'utf8')).facts ?? []).map(
      (f: { txHash: string; logIndex: number; scenario: string; role: string }) => ({
        txHash: f.txHash,
        logIndex: f.logIndex,
        scenario: f.scenario,
        role: f.role,
      }),
    );
  }

  console.log(`Vault ${vaultAddress}`);
  console.log(`Submitter ${signer.address}`);
  console.log(`chainKey ${chain.chainKey} (resolved at runtime)\n`);

  const results: unknown[] = [];
  let failures = 0;

  for (const subject of subjects) {
    const label = subject.scenario ? `${subject.scenario} · ${subject.role}` : subject.txHash.slice(0, 12);
    console.log(`=== ${label} ===`);

    // Independent control, read straight from the source chain.
    const receipt = await src.getTransactionReceipt(subject.txHash);
    if (!receipt) {
      console.log('  SKIP: not found on the source chain\n');
      failures++;
      continue;
    }

    const res = await pb.getProof(subject.txHash);
    if (!res.success || !res.data) {
      console.log(`  FAILED to prove: ${res.error}\n`);
      failures++;
      continue;
    }
    const p = res.data;

    const factId: string = await vault.computeFactId(
      p.chainKey,
      p.headerNumber,
      p.txIndex,
      subject.logIndex,
    );

    const alreadyStored: boolean = await vault.exists(factId);
    if (alreadyStored) {
      console.log(`  already stored (${factId.slice(0, 12)}…) — verifying idempotence instead`);
    }

    const tx = await vault.submitTransferFact(
      p.chainKey,
      p.headerNumber,
      p.txBytes,
      p.merkleProof.root,
      p.merkleProof.siblings.map((s) => [s.hash, s.isLeft]),
      p.continuityProof.lowerEndpointDigest,
      p.continuityProof.roots,
      subject.logIndex,
    );
    const ccReceipt = await tx.wait();
    if (!ccReceipt || ccReceipt.status !== 1) {
      console.log(`  FAILED: submission reverted (${tx.hash})\n`);
      failures++;
      continue;
    }

    // --- did the precompile itself emit? ---
    const precompileEmitted = ccReceipt.logs.some(
      (l: { topics: readonly string[] }) => l.topics[0] === TRANSACTION_VERIFIED_TOPIC,
    );

    // --- did the vault store it? ---
    const storedEvent = ccReceipt.logs
      .map((l: { topics: readonly string[]; data: string }) => {
        try {
          return vault.interface.parseLog({ topics: [...l.topics], data: l.data });
        } catch {
          return null;
        }
      })
      .find((e: { name: string } | null) => e?.name === 'TransferFactStored');

    const fact = await vault.getFact(factId);

    // --- the control: the same log, read from the source chain ---
    const srcLog = receipt.logs[subject.logIndex];

    const checks: Array<[string, boolean, string]> = [
      ['submission succeeded', ccReceipt.status === 1, `status=${ccReceipt.status}`],
      [
        'TransactionVerified emitted by 0x0FD2',
        alreadyStored ? true : precompileEmitted,
        alreadyStored ? 'skipped (idempotent no-op)' : String(precompileEmitted),
      ],
      [
        'TransferFactStored emitted',
        alreadyStored ? storedEvent === undefined : storedEvent !== undefined,
        alreadyStored ? 'correctly absent on re-submission' : String(storedEvent !== undefined),
      ],
      ['fact exists in the vault', await vault.exists(factId), factId.slice(0, 14)],
      ['chainKey matches', Number(fact.chainKey) === p.chainKey, String(fact.chainKey)],
      ['blockHeight matches', Number(fact.blockHeight) === receipt.blockNumber, String(fact.blockHeight)],
      ['txIndex matches source', Number(fact.txIndex) === receipt.index, String(fact.txIndex)],
      ['token matches source', fact.token.toLowerCase() === srcLog.address.toLowerCase(), fact.token],
      [
        'from matches source',
        fact.from.toLowerCase() === ('0x' + srcLog.topics[1].slice(26)).toLowerCase(),
        fact.from,
      ],
      [
        'to matches source',
        fact.to.toLowerCase() === ('0x' + srcLog.topics[2].slice(26)).toLowerCase(),
        fact.to,
      ],
      ['amount matches source', fact.amount === BigInt(srcLog.data), fact.amount.toString()],
      ['submitter is us', fact.submitter.toLowerCase() === signer.address.toLowerCase(), fact.submitter],
    ];

    let passed = 0;
    for (const [name, ok, detail] of checks) {
      if (ok) passed++;
      console.log(`    ${ok ? 'PASS' : 'FAIL'}  ${name}  (${detail})`);
    }
    if (passed !== checks.length) failures++;

    console.log(
      `  ccTx ${tx.hash}  gas ${ccReceipt.gasUsed}  ${passed}/${checks.length} checks\n`,
    );

    results.push({
      scenario: subject.scenario,
      role: subject.role,
      sourceTxHash: subject.txHash,
      factId,
      ccTxHash: tx.hash,
      ccBlock: ccReceipt.blockNumber,
      gasUsed: ccReceipt.gasUsed.toString(),
      precompileEmitted,
      newlyStored: storedEvent !== undefined,
      checksPassed: passed,
      checksTotal: checks.length,
      decoded: {
        chainKey: Number(fact.chainKey),
        blockHeight: Number(fact.blockHeight),
        txIndex: Number(fact.txIndex),
        logIndex: Number(fact.logIndex),
        token: fact.token,
        from: fact.from,
        to: fact.to,
        amount: fact.amount.toString(),
      },
    });
  }

  const pass = failures === 0;
  console.log(`================ GATE 4: ${pass ? 'PASS' : 'FAIL'} ================`);
  console.log(`${results.length} fact(s) submitted, ${failures} failure(s)`);

  mkdirSync(RESULTS_DIR, { recursive: true });
  const file = join(RESULTS_DIR, 'gate4-decode.json');
  writeFileSync(
    file,
    JSON.stringify(
      {
        gate: 'GATE 4 — on-chain decode against the deployed vault',
        pass,
        at: new Date().toISOString(),
        vault: vaultAddress,
        submitter: signer.address,
        results,
      },
      null,
      2,
    ),
  );
  console.log(`Result written to ${file}`);
  if (!pass) process.exitCode = 1;
}

main().catch((e) => {
  console.error('GATE 4 FAILED WITH EXCEPTION:');
  console.error((e as Error).message ?? e);
  process.exitCode = 1;
});
