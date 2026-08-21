/**
 * Proves and verifies every staged source-chain transaction.
 *
 * Reads `demo/staged/source-transactions.json`, and for each entry:
 *   1. waits until the source block is attested and in the prover's cache
 *   2. fetches the proof bundle
 *   3. has the Block Prover precompile verify it (read-only — no wallet, no gas)
 *   4. decodes the ERC-20 Transfer from the PROVEN bytes
 *   5. cross-checks the decoded values against the source chain independently
 *
 * The result is the demo's pre-warmed evidence set. BUILD.md §13 leans on this:
 * every source-chain transaction is created and proven hours in advance, so the
 * only live action during the demo is a single Creditcoin call.
 *
 * This needs no Creditcoin tokens. Submitting these facts to the vault does, but
 * proving and verifying them does not.
 *
 *   npx tsx demo/prove-staged.ts
 */
import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonRpcProvider } from 'ethers';
import { blockProver, chainInfo, proofProvider } from '@gluwa/usc-sdk';

import { asSdkProvider } from '../integration/lib/provider.js';
import {
  decodeReceiptFields,
  extractTransfer,
  getTransactionType,
  isValidTransactionType,
} from '../integration/lib/decode-receipt.js';
import { ERC20_TRANSFER_TOPIC } from '../integration/gate1-evidence.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'staged');
const LEDGER = join(DIR, 'source-transactions.json');
const OUT = join(DIR, 'proven-facts.json');

interface StagedTx {
  role: string;
  scenario: string;
  txHash: string;
  blockNumber: number;
  from: string;
  to: string;
  amountWei: string;
}

interface ProvenFact {
  scenario: string;
  role: string;
  txHash: string;
  chainKey: number;
  blockHeight: number;
  txIndex: number;
  logIndex: number;
  token: string;
  from: string;
  to: string;
  amount: string;
  receiptStatus: number;
  verified: boolean;
  crossChecksPassed: number;
  crossChecksTotal: number;
  merkleSiblings: number;
  continuityRoots: number;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

async function main(): Promise<void> {
  if (!existsSync(LEDGER)) throw new Error(`no staged transactions at ${LEDGER}`);
  const staged: StagedTx[] = JSON.parse(readFileSync(LEDGER, 'utf8')).transactions ?? [];
  if (staged.length === 0) throw new Error('the staged ledger is empty');

  const cc = new JsonRpcProvider(required('CREDITCOIN_RPC_URL'));
  const src = new JsonRpcProvider(required('SOURCE_CHAIN_RPC_URL'));
  const info = new chainInfo.PrecompileChainInfoProvider(asSdkProvider(cc));
  const prover = new blockProver.PrecompileBlockProver(asSdkProvider(cc));

  const targetChainId = Number(process.env.SOURCE_CHAIN_ID ?? 11155111);
  const chains = await info.getSupportedChains();
  const chain = chains.find((c) => c.chainId === targetChainId);
  if (!chain) throw new Error(`chainId ${targetChainId} is not supported`);
  console.log(`chainId ${targetChainId} -> chainKey ${chain.chainKey} (resolved at runtime)\n`);

  const pb = new proofProvider.service.ProofBuilder(
    chain.chainKey,
    required('PROOF_BUILDER_URL'),
    30_000,
  );

  const results: ProvenFact[] = [];
  let failures = 0;

  for (const tx of staged) {
    console.log(`=== ${tx.scenario} · ${tx.role} · block ${tx.blockNumber} ===`);
    console.log(`  ${tx.txHash}`);

    // The receipt is the independent control we check the proof against.
    const receipt = await src.getTransactionReceipt(tx.txHash);
    if (!receipt) {
      console.log('  SKIP: not found on the source chain\n');
      failures++;
      continue;
    }

    await pb.waitUntilHeightAttested(
      chain.chainKey,
      tx.blockNumber,
      Number(process.env.PROOF_POLL_INTERVAL_MS ?? 15_000),
      Number(process.env.PROOF_WAIT_TIMEOUT_MS ?? 2_700_000),
    );

    const res = await pb.getProof(tx.txHash);
    if (!res.success || !res.data) {
      console.log(`  FAILED to prove: ${res.error}\n`);
      failures++;
      continue;
    }
    const p = res.data;

    const verified = await prover.verifySingle(
      p.chainKey,
      p.headerNumber,
      p.txBytes,
      p.merkleProof,
      p.continuityProof,
    );
    const txIndex = Number(await prover.computeTransactionIndex(p.merkleProof));

    // Decode from the proven bytes, then locate the Transfer we staged.
    const txType = getTransactionType(p.txBytes);
    if (!isValidTransactionType(txType)) throw new Error(`unsupported tx type ${txType}`);
    const decoded = decodeReceiptFields(p.txBytes);

    // Our staged transfers are direct WETH.transfer calls, so the relevant log is
    // the first Transfer whose from/to match what we broadcast.
    let logIndex = -1;
    for (let i = 0; i < decoded.receiptLogs.length; i++) {
      const lg = decoded.receiptLogs[i];
      if (lg.topics.length !== 3 || lg.topics[0].toLowerCase() !== ERC20_TRANSFER_TOPIC) continue;
      const from = '0x' + lg.topics[1].slice(26);
      const to = '0x' + lg.topics[2].slice(26);
      if (from.toLowerCase() === tx.from.toLowerCase() && to.toLowerCase() === tx.to.toLowerCase()) {
        logIndex = i;
        break;
      }
    }
    if (logIndex < 0) {
      console.log('  FAILED: no matching Transfer log in the proven receipt\n');
      failures++;
      continue;
    }

    const transfer = extractTransfer(decoded, logIndex, ERC20_TRANSFER_TOPIC);

    // Independent cross-check against the source chain's own receipt.
    const srcLog = receipt.logs.find(
      (l) =>
        l.topics.length === 3 &&
        l.topics[0].toLowerCase() === ERC20_TRANSFER_TOPIC &&
        ('0x' + l.topics[1].slice(26)).toLowerCase() === tx.from.toLowerCase() &&
        ('0x' + l.topics[2].slice(26)).toLowerCase() === tx.to.toLowerCase(),
    );

    const checks: Array<[string, boolean]> = [
      ['verify() returned true', verified === true],
      ['blockHeight matches', p.headerNumber === tx.blockNumber],
      ['txIndex matches receipt', txIndex === receipt.index],
      ['receiptStatus is 1', decoded.receiptStatus === 1],
      ['token matches', !!srcLog && transfer.token.toLowerCase() === srcLog.address.toLowerCase()],
      ['from matches', transfer.from.toLowerCase() === tx.from.toLowerCase()],
      ['to matches', transfer.to.toLowerCase() === tx.to.toLowerCase()],
      ['amount matches', transfer.amount.toString() === tx.amountWei],
    ];
    const passed = checks.filter(([, ok]) => ok).length;
    for (const [name, ok] of checks) console.log(`    ${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (passed !== checks.length) failures++;

    console.log(
      `  verified=${verified} txIndex=${txIndex} logIndex=${logIndex} ` +
        `siblings=${p.merkleProof.siblings.length} roots=${p.continuityProof.roots.length}\n`,
    );

    results.push({
      scenario: tx.scenario,
      role: tx.role,
      txHash: tx.txHash,
      chainKey: p.chainKey,
      blockHeight: p.headerNumber,
      txIndex,
      logIndex,
      token: transfer.token,
      from: transfer.from,
      to: transfer.to,
      amount: transfer.amount.toString(),
      receiptStatus: decoded.receiptStatus,
      verified,
      crossChecksPassed: passed,
      crossChecksTotal: checks.length,
      merkleSiblings: p.merkleProof.siblings.length,
      continuityRoots: p.continuityProof.roots.length,
    });
  }

  mkdirSync(DIR, { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        note:
          'Transactions we created on Sepolia, proven by the Attestcoin proof builder and verified ' +
          'by the Creditcoin Block Prover precompile. Verification is read-only; submitting these ' +
          'as facts to EvidenceVault additionally requires a funded Creditcoin account.',
        provenAt: new Date().toISOString(),
        facts: results,
      },
      null,
      2,
    ),
  );

  console.log(`${results.length}/${staged.length} proven and verified · ${failures} failure(s)`);
  console.log(`Written to ${OUT}`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`\nFAILED: ${(e as Error).message}`);
  process.exitCode = 1;
});
