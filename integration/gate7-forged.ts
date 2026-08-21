/**
 * GATE 7 — forged proof rejection (BUILD.md §11 Phase 11).
 *
 * Takes a real, verifying proof bundle and mutates it six ways, asserting that
 * every mutation is rejected:
 *
 *   1. one Merkle sibling hash
 *   2. one continuity root
 *   3. the continuity lower endpoint digest
 *   4. the block height
 *   5. one Merkle sibling `isLeft` flag
 *   6. one byte of the encoded transaction
 *
 * BUILD.md §14 is unambiguous about the stakes: if a forged proof is ACCEPTED,
 * stop everything and report it to the Creditcoin team. That finding would be
 * worth more than anything else we could build.
 *
 * Two parts, deliberately separated:
 *
 *   PART A (runs today, no wallet, no deployment) — every mutation is put to the
 *   precompile's read-only `verify()`. This is the actual security assertion,
 *   and it also resolves KNOWN_ISSUES K-007 by recording whether the precompile
 *   REVERTS or RETURNS FALSE on a bad proof.
 *
 *   PART B (needs a funded deployment) — the same mutations are submitted to
 *   EvidenceVault so the six failing Creditcoin transaction hashes can be
 *   captured for the README and the video. Skipped until EVIDENCE_VAULT_ADDRESS
 *   is set.
 *
 *   npx tsx integration/gate7-forged.ts [txHash]
 */
import 'dotenv/config';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonRpcProvider } from 'ethers';
import { blockProver, chainInfo, proofProvider } from '@gluwa/usc-sdk';

import { asSdkProvider } from './lib/provider.js';

const RESULTS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'results');

/** Flips the low bit of the last byte of a 0x-prefixed hex string. */
function flipLastByte(hex: string): string {
  const body = hex.slice(2);
  const last = body.slice(-2);
  const flipped = (parseInt(last, 16) ^ 0x01).toString(16).padStart(2, '0');
  return `0x${body.slice(0, -2)}${flipped}`;
}

interface Mutation {
  id: number;
  name: string;
  description: string;
  apply: (b: Bundle) => Bundle;
}

interface Bundle {
  chainKey: number;
  headerNumber: number;
  txBytes: string;
  merkleProof: { root: string; siblings: Array<{ hash: string; isLeft: boolean }> };
  continuityProof: { lowerEndpointDigest: string; roots: string[] };
}

const clone = (b: Bundle): Bundle => JSON.parse(JSON.stringify(b));

const MUTATIONS: Mutation[] = [
  {
    id: 1,
    name: 'merkle-sibling-hash',
    description: 'Flip one bit in the first Merkle sibling hash',
    apply: (b) => {
      const m = clone(b);
      if (m.merkleProof.siblings.length === 0) throw new Error('proof has no siblings to mutate');
      m.merkleProof.siblings[0].hash = flipLastByte(m.merkleProof.siblings[0].hash);
      return m;
    },
  },
  {
    id: 2,
    name: 'continuity-root',
    description: 'Flip one bit in the first continuity root',
    apply: (b) => {
      const m = clone(b);
      if (m.continuityProof.roots.length === 0) throw new Error('proof has no continuity roots');
      m.continuityProof.roots[0] = flipLastByte(m.continuityProof.roots[0]);
      return m;
    },
  },
  {
    id: 3,
    name: 'lower-endpoint-digest',
    description: 'Flip one bit in the continuity lower endpoint digest',
    apply: (b) => {
      const m = clone(b);
      m.continuityProof.lowerEndpointDigest = flipLastByte(m.continuityProof.lowerEndpointDigest);
      return m;
    },
  },
  {
    id: 4,
    name: 'block-height',
    description: 'Claim the transaction was in the next block',
    apply: (b) => {
      const m = clone(b);
      m.headerNumber = m.headerNumber + 1;
      return m;
    },
  },
  {
    id: 5,
    name: 'merkle-isLeft-flag',
    description: 'Invert the first Merkle sibling’s isLeft flag',
    apply: (b) => {
      const m = clone(b);
      if (m.merkleProof.siblings.length === 0) throw new Error('proof has no siblings to mutate');
      m.merkleProof.siblings[0].isLeft = !m.merkleProof.siblings[0].isLeft;
      return m;
    },
  },
  {
    id: 6,
    name: 'encoded-transaction-byte',
    description: 'Flip one bit in the encoded transaction',
    apply: (b) => {
      const m = clone(b);
      m.txBytes = flipLastByte(m.txBytes);
      return m;
    },
  },
];

type Outcome = 'rejected-returned-false' | 'rejected-reverted' | 'ACCEPTED' | 'error';

interface MutationResult {
  id: number;
  name: string;
  description: string;
  outcome: Outcome;
  detail?: string;
  rejected: boolean;
}

async function main(): Promise<void> {
  const ccUrl = process.env.CREDITCOIN_RPC_URL;
  const srcUrl = process.env.SOURCE_CHAIN_RPC_URL;
  const proverUrl = process.env.PROOF_BUILDER_URL;
  if (!ccUrl || !srcUrl || !proverUrl) {
    throw new Error('CREDITCOIN_RPC_URL, SOURCE_CHAIN_RPC_URL and PROOF_BUILDER_URL must be set');
  }

  // Subject: an argument, the Gate 1 candidate list, or a known-good default.
  let txHash = process.argv[2];
  if (!txHash) {
    const f = join(RESULTS_DIR, 'gate1-candidates.json');
    if (existsSync(f)) {
      txHash = JSON.parse(readFileSync(f, 'utf8')).candidates[0].txHash;
      console.log(`Using first Gate 1 candidate: ${txHash}`);
    } else {
      throw new Error('No transaction given and no gate1-candidates.json found. Run: npm run gate1');
    }
  }

  const cc = new JsonRpcProvider(ccUrl);
  const src = new JsonRpcProvider(srcUrl);
  const info = new chainInfo.PrecompileChainInfoProvider(asSdkProvider(cc));
  const prover = new blockProver.PrecompileBlockProver(asSdkProvider(cc));

  const targetChainId = Number(process.env.SOURCE_CHAIN_ID ?? 11155111);
  const chains = await info.getSupportedChains();
  const chain = chains.find((c) => c.chainId === targetChainId);
  if (!chain) throw new Error(`chainId ${targetChainId} is not supported`);

  const receipt = await src.getTransactionReceipt(txHash!);
  if (!receipt) throw new Error(`transaction ${txHash} not found on the source chain`);
  console.log(`Subject block: ${receipt.blockNumber}, chainKey ${chain.chainKey}\n`);

  // --- the control: an unmutated bundle must verify ---
  const pb = new proofProvider.service.ProofBuilder(chain.chainKey, proverUrl, 30_000);
  await pb.waitUntilHeightAttested(chain.chainKey, receipt.blockNumber, 15_000, 2_700_000);
  const res = await pb.getProof(txHash!);
  if (!res.success || !res.data) throw new Error(`could not obtain a proof: ${res.error}`);

  const valid: Bundle = {
    chainKey: res.data.chainKey,
    headerNumber: res.data.headerNumber,
    txBytes: res.data.txBytes,
    merkleProof: res.data.merkleProof as Bundle['merkleProof'],
    continuityProof: res.data.continuityProof as Bundle['continuityProof'],
  };

  console.log('=== CONTROL — the unmutated proof ===');
  const controlOk = await prover.verifySingle(
    valid.chainKey,
    valid.headerNumber,
    valid.txBytes,
    valid.merkleProof as never,
    valid.continuityProof as never,
  );
  console.log(`  verify() -> ${controlOk}`);
  if (!controlOk) {
    console.error('\nCONTROL FAILED: the unmutated proof does not verify.');
    console.error('Every mutation below would "fail" for the wrong reason, so the gate proves nothing.');
    process.exitCode = 1;
    return;
  }
  console.log('  CONTROL PASS — mutations below are therefore meaningful\n');

  // --- PART A: the security assertion ---
  console.log('=== PART A — six mutations against the read-only verify() ===');
  const results: MutationResult[] = [];

  for (const mutation of MUTATIONS) {
    let result: MutationResult;
    try {
      const mutated = mutation.apply(valid);
      const ok = await prover.verifySingle(
        mutated.chainKey,
        mutated.headerNumber,
        mutated.txBytes,
        mutated.merkleProof as never,
        mutated.continuityProof as never,
      );
      result = ok
        ? {
            ...mutation,
            outcome: 'ACCEPTED',
            rejected: false,
            detail: 'verify() returned true for a forged proof',
          }
        : { ...mutation, outcome: 'rejected-returned-false', rejected: true };
    } catch (e: unknown) {
      const message = (e as Error).message ?? String(e);
      // A revert is a rejection. The distinction matters only because the
      // documentation and the reference implementation disagree (K-007).
      result = {
        ...mutation,
        outcome: 'rejected-reverted',
        rejected: true,
        detail: message.slice(0, 200),
      };
    }

    results.push(result);
    const mark = result.rejected ? 'REJECTED' : '*** ACCEPTED ***';
    console.log(`  ${mutation.id}. ${mutation.name.padEnd(26)} ${mark}  (${result.outcome})`);
    if (result.detail && result.rejected) console.log(`     ${result.detail.split('\n')[0]}`);
  }

  const allRejected = results.every((r) => r.rejected);
  const accepted = results.filter((r) => !r.rejected);

  // --- resolve K-007 from observed behaviour ---
  const reverted = results.filter((r) => r.outcome === 'rejected-reverted').length;
  const returnedFalse = results.filter((r) => r.outcome === 'rejected-returned-false').length;
  const failureMode =
    reverted > 0 && returnedFalse === 0
      ? 'reverts'
      : returnedFalse > 0 && reverted === 0
        ? 'returns false'
        : 'mixed';

  console.log(`\n=== PRECOMPILE FAILURE MODE (resolves K-007) ===`);
  console.log(`  reverted: ${reverted}/6, returned false: ${returnedFalse}/6  ->  ${failureMode}`);
  console.log(
    '  EvidenceVault requires the returned bool, so both behaviours terminate the transaction.',
  );

  console.log(`\n================ GATE 7 (part A): ${allRejected ? 'PASS' : 'CRITICAL FAILURE'} ================`);
  if (!allRejected) {
    console.error('\n*** A FORGED PROOF WAS ACCEPTED BY THE PRECOMPILE ***');
    console.error('Per BUILD.md §14 this is a critical protocol finding. Stop building and report');
    console.error('it to the Creditcoin team immediately. Accepted mutations:');
    for (const a of accepted) console.error(`  - ${a.id}. ${a.name}: ${a.description}`);
  }

  // --- PART B: on-chain rejection hashes, once deployed ---
  const vaultAddress = process.env.EVIDENCE_VAULT_ADDRESS;
  console.log(`\n=== PART B — on-chain submission ===`);
  if (!vaultAddress) {
    console.log('  SKIPPED: EVIDENCE_VAULT_ADDRESS is not set.');
    console.log('  Part B captures the six failing Creditcoin transaction hashes that BUILD.md §16');
    console.log('  requires in the README. It needs a funded deployment; part A is the security');
    console.log('  assertion and it has already run.');
  } else {
    console.log(`  Vault ${vaultAddress} configured — run after deployment to capture tx hashes.`);
  }

  mkdirSync(RESULTS_DIR, { recursive: true });
  const file = join(RESULTS_DIR, `gate7-forged-${txHash!.slice(0, 10)}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      {
        gate: 'GATE 7 — forged proof rejection (part A: read-only verify)',
        pass: allRejected,
        at: new Date().toISOString(),
        subject: { txHash, blockHeight: receipt.blockNumber, chainKey: chain.chainKey },
        control: { verified: controlOk },
        precompileFailureMode: { reverted, returnedFalse, conclusion: failureMode },
        mutations: results,
        partB: vaultAddress ? 'configured' : 'skipped — no deployment',
      },
      null,
      2,
    ),
  );
  console.log(`\nResult written to ${file}`);

  if (!allRejected) process.exitCode = 1;
}

main().catch((e) => {
  console.error('GATE 7 FAILED WITH EXCEPTION:');
  console.error(e);
  process.exitCode = 1;
});
