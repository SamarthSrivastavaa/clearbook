/**
 * Measures end-to-end evidence latency (BUILD.md §1.2, §16).
 *
 * BUILD.md lists "end-to-end latency for a fresh tx" as UNVERIFIED and requires
 * the submission to publish *measured* numbers rather than quoted ones. This
 * broadcasts a real transfer and times every stage:
 *
 *   broadcast → included → attested → proved → verified
 *
 * The published "~15 seconds" refers only to on-chain verification, after
 * attestation. The interesting number — how long before a fresh transaction can
 * be used as evidence at all — is dominated by attestation, because attestors
 * attest finalized blocks.
 *
 * Read-only on Creditcoin: verification uses the `verify()` view, so this needs
 * no tCTC. It does spend a little Sepolia gas to create the subject transaction.
 *
 *   npx tsx integration/measure-latency.ts [samples]
 */
import 'dotenv/config';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract, JsonRpcProvider, Wallet, parseEther } from 'ethers';
import { blockProver, chainInfo, proofProvider } from '@gluwa/usc-sdk';

import { asSdkProvider } from './lib/provider.js';

const RESULTS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'results');
const OUT = join(RESULTS_DIR, 'latency-samples.json');

const WETH = '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9';
const WETH_ABI = ['function transfer(address to, uint256 value) returns (bool)'];

interface Sample {
  txHash: string;
  blockNumber: number;
  chainKey: number;
  /** ms from broadcast to inclusion in a block */
  broadcastToIncluded: number;
  /** ms from inclusion to the prover reporting the block attested */
  includedToAttested: number;
  /** ms to fetch the proof bundle once attested */
  proofFetch: number;
  /** ms for the precompile verify() call */
  verify: number;
  /** ms from broadcast to usable evidence */
  totalToVerified: number;
  attestationLagBlocks: number;
  measuredAt: string;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function pct(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

const ms = (n: number) => `${(n / 1000).toFixed(1)}s`;

async function measureOne(
  src: JsonRpcProvider,
  treasury: Wallet,
  recipient: string,
  chainKey: number,
  pb: proofProvider.service.ProofBuilder,
  prover: blockProver.PrecompileBlockProver,
): Promise<Sample> {
  const weth = new Contract(WETH, WETH_ABI, treasury);

  // --- broadcast ---
  const tBroadcast = Date.now();
  const tx = await weth.transfer(recipient, parseEther('0.0001'));
  console.log(`  broadcast ${tx.hash}`);

  // --- inclusion ---
  const receipt = await tx.wait();
  const tIncluded = Date.now();
  const blockNumber: number = receipt.blockNumber;
  console.log(`  included in block ${blockNumber} after ${ms(tIncluded - tBroadcast)}`);

  // --- attestation ---
  console.log('  waiting for attestation…');
  await pb.waitUntilHeightAttested(chainKey, blockNumber, 10_000, 2_700_000);
  const tAttested = Date.now();
  console.log(`  attested after a further ${ms(tAttested - tIncluded)}`);

  // How far behind the head attestation was sitting when we became usable.
  const headNow = await src.getBlockNumber();
  const attestationLagBlocks = headNow - blockNumber;

  // --- proof ---
  const tProofStart = Date.now();
  const res = await pb.getProof(tx.hash);
  if (!res.success || !res.data) throw new Error(`proof failed: ${res.error}`);
  const tProved = Date.now();
  console.log(`  proof fetched in ${ms(tProved - tProofStart)}`);

  // --- verification ---
  const tVerifyStart = Date.now();
  const ok = await prover.verifySingle(
    res.data.chainKey,
    res.data.headerNumber,
    res.data.txBytes,
    res.data.merkleProof,
    res.data.continuityProof,
  );
  const tVerified = Date.now();
  if (!ok) throw new Error('verify() returned false for a freshly proven transaction');
  console.log(`  verified in ${ms(tVerified - tVerifyStart)}`);

  return {
    txHash: tx.hash,
    blockNumber,
    chainKey,
    broadcastToIncluded: tIncluded - tBroadcast,
    includedToAttested: tAttested - tIncluded,
    proofFetch: tProved - tProofStart,
    verify: tVerified - tVerifyStart,
    totalToVerified: tVerified - tBroadcast,
    attestationLagBlocks,
    measuredAt: new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  const samples = Number(process.argv[2] ?? 1);

  const cc = new JsonRpcProvider(required('CREDITCOIN_RPC_URL'));
  const src = new JsonRpcProvider(required('SOURCE_CHAIN_RPC_URL'));
  const treasury = new Wallet(required('DEMO_TREASURY_PRIVATE_KEY'), src);
  const recipient = new Wallet(required('DEMO_BORROWER_PRIVATE_KEY')).address;

  const info = new chainInfo.PrecompileChainInfoProvider(asSdkProvider(cc));
  const prover = new blockProver.PrecompileBlockProver(asSdkProvider(cc));

  const targetChainId = Number(process.env.SOURCE_CHAIN_ID ?? 11155111);
  const chains = await info.getSupportedChains();
  const chain = chains.find((c) => c.chainId === targetChainId);
  if (!chain) throw new Error(`chainId ${targetChainId} is not supported`);

  const pb = new proofProvider.service.ProofBuilder(
    chain.chainKey,
    required('PROOF_BUILDER_URL'),
    30_000,
  );

  console.log(`Measuring ${samples} sample(s) on chainKey ${chain.chainKey}\n`);

  const existing: Sample[] = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')).samples ?? [] : [];
  const fresh: Sample[] = [];

  for (let i = 0; i < samples; i++) {
    console.log(`=== sample ${i + 1}/${samples} ===`);
    const s = await measureOne(src, treasury, recipient, chain.chainKey, pb, prover);
    fresh.push(s);
    console.log(`  TOTAL broadcast -> verified: ${ms(s.totalToVerified)}\n`);
  }

  const all = [...existing, ...fresh];
  const totals = all.map((s) => s.totalToVerified);
  const attestations = all.map((s) => s.includedToAttested);
  const verifies = all.map((s) => s.verify);

  const summary = {
    samples: all.length,
    broadcastToVerified: { p50: pct(totals, 0.5), p90: pct(totals, 0.9), max: Math.max(...totals) },
    includedToAttested: {
      p50: pct(attestations, 0.5),
      p90: pct(attestations, 0.9),
      max: Math.max(...attestations),
    },
    verifyCall: { p50: pct(verifies, 0.5), p90: pct(verifies, 0.9) },
  };

  console.log('=== SUMMARY ===');
  console.log(`  samples: ${summary.samples}`);
  console.log(
    `  broadcast -> verified   p50 ${ms(summary.broadcastToVerified.p50)}  p90 ${ms(summary.broadcastToVerified.p90)}`,
  );
  console.log(
    `  attestation wait        p50 ${ms(summary.includedToAttested.p50)}  p90 ${ms(summary.includedToAttested.p90)}`,
  );
  console.log(
    `  verify() call           p50 ${ms(summary.verifyCall.p50)}  p90 ${ms(summary.verifyCall.p90)}`,
  );

  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        note:
          'End-to-end latency for freshly broadcast Sepolia transactions, measured rather than quoted. ' +
          'Verification uses the read-only verify() view, so no Creditcoin tokens were spent.',
        summary,
        samples: all,
      },
      null,
      2,
    ),
  );
  console.log(`\nWritten to ${OUT}`);
}

main().catch((e) => {
  console.error(`\nFAILED: ${(e as Error).message}`);
  process.exitCode = 1;
});
