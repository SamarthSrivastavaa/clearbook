/**
 * GATE 2 (proof) + GATE 3 (verify) + off-chain decode cross-check.
 *
 * This is the existential technical gate for Clearbook:
 *
 *   real source-chain transaction
 *     -> Attestcoin proof            (GATE 2: ProofBuilder.getProof)
 *     -> Creditcoin verification     (GATE 3: precompile 0x0FD2 verify())
 *     -> verified receipt            (decode receipt from the PROVEN txBytes)
 *     -> ERC-20 Transfer extraction  (token / from / to / amount / logIndex)
 *     -> cross-check against independent source-chain evidence
 *
 * Usage:
 *   npx tsx integration/gate2-proof.ts [txHash] [logIndex]
 * With no arguments it uses the first candidate discovered by gate1-evidence.ts.
 */
import 'dotenv/config';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonRpcProvider } from 'ethers';
import { chainInfo, proofProvider, blockProver } from '@gluwa/usc-sdk';
import { decodeReceiptFields, extractTransfer, getTransactionType, isValidTransactionType } from './lib/decode-receipt.js';
import { ERC20_TRANSFER_TOPIC, resolveChainKey } from './gate1-evidence.js';

const RESULTS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'results');

interface Check {
  name: string;
  expected: string;
  actual: string;
  pass: boolean;
}

function check(name: string, expected: unknown, actual: unknown): Check {
  const e = String(expected).toLowerCase();
  const a = String(actual).toLowerCase();
  const c = { name, expected: String(expected), actual: String(actual), pass: e === a };
  console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${name}: expected=${c.expected} actual=${c.actual}`);
  return c;
}

async function main(): Promise<void> {
  const ccUrl = process.env.CREDITCOIN_RPC_URL;
  const srcUrl = process.env.SOURCE_CHAIN_RPC_URL;
  const proverUrl = process.env.PROOF_BUILDER_URL;
  if (!ccUrl) throw new Error('CREDITCOIN_RPC_URL is not set');
  if (!srcUrl) throw new Error('SOURCE_CHAIN_RPC_URL is not set');
  if (!proverUrl) throw new Error('PROOF_BUILDER_URL is not set');

  // ---- Select the subject transaction ----
  let txHash = process.argv[2];
  let expectedLogIndex = process.argv[3] != null ? Number(process.argv[3]) : undefined;

  if (!txHash) {
    const f = join(RESULTS_DIR, 'gate1-candidates.json');
    const gate1 = JSON.parse(readFileSync(f, 'utf8'));
    const c = gate1.candidates[0];
    txHash = c.txHash;
    expectedLogIndex = c.logIndex;
    console.log(`Using first candidate from ${f}`);
  }

  const targetChainId = Number(process.env.SOURCE_CHAIN_ID ?? 11155111);
  const cc = new JsonRpcProvider(ccUrl);
  const src = new JsonRpcProvider(srcUrl);
  const info = new chainInfo.PrecompileChainInfoProvider(cc);

  const chain = await resolveChainKey(info, targetChainId);
  const chainKey = chain.chainKey;
  console.log(`\nchainId ${targetChainId} -> chainKey ${chainKey} (resolved at runtime)`);
  console.log(`Subject transaction: ${txHash}`);

  // ---- Independent source-chain evidence (the control) ----
  const srcTx = await src.getTransaction(txHash!);
  const srcReceipt = await src.getTransactionReceipt(txHash!);
  if (!srcTx || !srcReceipt) throw new Error(`Transaction ${txHash} not found on the source chain`);
  const blockNumber = srcReceipt.blockNumber;
  console.log(`Source chain says: block=${blockNumber} txIndex=${srcReceipt.index} status=${srcReceipt.status} type=${srcTx.type}`);

  // ---- GATE 2: obtain the proof ----
  console.log(`\n=== GATE 2 — proof generation ===`);
  const pollMs = Number(process.env.PROOF_POLL_INTERVAL_MS ?? 15000);
  const timeoutMs = Number(process.env.PROOF_WAIT_TIMEOUT_MS ?? 2_700_000);
  const pb = new proofProvider.service.ProofBuilder(chainKey, proverUrl, 30_000);

  console.log(`Waiting until height ${blockNumber} is attested AND present in the prover cache...`);
  const tWaitStart = Date.now();
  await pb.waitUntilHeightAttested(chainKey, blockNumber, pollMs, timeoutMs);
  const waitMs = Date.now() - tWaitStart;
  console.log(`Attested and prover-ready after ${waitMs} ms`);

  const tProofStart = Date.now();
  const res = await pb.getProof(txHash!);
  const proofMs = Date.now() - tProofStart;
  if (!res.success || !res.data) {
    console.error(`GATE 2 FAILED: ${res.error}`);
    process.exitCode = 1;
    return;
  }
  const p = res.data;
  console.log(`getProof success in ${proofMs} ms (cached=${p.cached})`);
  console.log(`  chainKey=${p.chainKey} headerNumber=${p.headerNumber} txIndex=${p.txIndex}`);
  console.log(`  txBytes length=${(p.txBytes.length - 2) / 2} bytes`);
  console.log(`  merkleProof.root=${p.merkleProof.root} siblings=${p.merkleProof.siblings.length}`);
  console.log(`  continuityProof.lowerEndpointDigest=${p.continuityProof.lowerEndpointDigest}`);
  console.log(`  continuityProof.roots=${p.continuityProof.roots.length}`);
  console.log(`GATE 2: PASS`);

  // ---- GATE 3: verify through the real Creditcoin precompile ----
  console.log(`\n=== GATE 3 — on-chain verification via precompile 0x0FD2 ===`);
  const prover = new blockProver.PrecompileBlockProver(cc);
  console.log(`BlockProver precompile: ${blockProver.BLOCK_PROVER_PRECOMPILE_ADDRESS}`);

  const tVerifyStart = Date.now();
  const ok = await prover.verifySingle(p.chainKey, p.headerNumber, p.txBytes, p.merkleProof, p.continuityProof);
  const verifyMs = Date.now() - tVerifyStart;
  console.log(`verify() returned ${ok} in ${verifyMs} ms`);
  if (!ok) {
    console.error(`GATE 3 FAILED: precompile returned false`);
    process.exitCode = 1;
    return;
  }

  // txIndex must come from the precompile, never from user input (BUILD.md §3.1)
  const txIndexFromPrecompile = Number(await prover.computeTransactionIndex(p.merkleProof));
  console.log(`calculateTxIndex() -> ${txIndexFromPrecompile}`);
  console.log(`GATE 3: PASS`);

  // ---- Decode the VERIFIED receipt ----
  console.log(`\n=== DECODE — receipt from the proven txBytes ===`);
  const txType = getTransactionType(p.txBytes);
  console.log(`getTransactionType -> ${txType} (valid: ${isValidTransactionType(txType)})`);
  const receipt = decodeReceiptFields(p.txBytes);
  console.log(`receiptStatus=${receipt.receiptStatus} gasUsed=${receipt.receiptGasUsed} logs=${receipt.receiptLogs.length}`);

  const logIndex = expectedLogIndex ?? 0;
  const transfer = extractTransfer(receipt, logIndex, ERC20_TRANSFER_TOPIC);
  console.log(`Transfer at transaction-local logIndex ${logIndex}:`);
  console.log(`  token=${transfer.token}`);
  console.log(`  from=${transfer.from}`);
  console.log(`  to=${transfer.to}`);
  console.log(`  amount=${transfer.amount}`);

  // ---- Cross-check against independent source-chain evidence ----
  console.log(`\n=== CROSS-CHECK — proven receipt vs independent source-chain RPC ===`);
  const srcLog = srcReceipt.logs[logIndex];
  const checks: Check[] = [
    check('chainKey', chainKey, p.chainKey),
    check('blockHeight', blockNumber, p.headerNumber),
    check('txIndex (precompile vs source RPC)', srcReceipt.index, txIndexFromPrecompile),
    check('txIndex (proof bundle vs source RPC)', srcReceipt.index, p.txIndex),
    check('txHash', txHash!, p.txHash),
    check('receiptStatus', srcReceipt.status, receipt.receiptStatus),
    check('receipt log count', srcReceipt.logs.length, receipt.receiptLogs.length),
    check('token', srcLog.address, transfer.token),
    check('from', '0x' + srcLog.topics[1].slice(26), transfer.from),
    check('to', '0x' + srcLog.topics[2].slice(26), transfer.to),
    check('amount', BigInt(srcLog.data).toString(), transfer.amount.toString()),
  ];

  const allPass = checks.every((c) => c.pass);
  console.log(`\n================ PHASE 0 END-TO-END: ${allPass ? 'PASS' : 'FAIL'} ================`);

  mkdirSync(RESULTS_DIR, { recursive: true });
  const file = join(RESULTS_DIR, `gate2-gate3-${txHash!.slice(0, 10)}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      {
        gate: 'GATE 2 (proof) + GATE 3 (verify) + decode cross-check',
        pass: allPass,
        at: new Date().toISOString(),
        creditcoinRpc: ccUrl,
        proofBuilderUrl: proverUrl,
        sourceChainRpc: srcUrl,
        blockProverPrecompile: blockProver.BLOCK_PROVER_PRECOMPILE_ADDRESS,
        chainInfoPrecompile: chainInfo.CHAIN_INFO_PRECOMPILE_ADDRESS,
        chainKey,
        chainId: targetChainId,
        txHash,
        blockNumber,
        timings: { attestationWaitMs: waitMs, proofMs, verifyMs },
        proof: {
          headerNumber: p.headerNumber,
          txIndex: p.txIndex,
          cached: p.cached,
          txBytesLength: (p.txBytes.length - 2) / 2,
          merkleRoot: p.merkleProof.root,
          merkleSiblings: p.merkleProof.siblings.length,
          lowerEndpointDigest: p.continuityProof.lowerEndpointDigest,
          continuityRoots: p.continuityProof.roots.length,
        },
        verification: { verifyReturned: ok, calculateTxIndex: txIndexFromPrecompile },
        decoded: {
          txType,
          receiptStatus: receipt.receiptStatus,
          receiptGasUsed: receipt.receiptGasUsed.toString(),
          logCount: receipt.receiptLogs.length,
          logIndex,
          token: transfer.token,
          from: transfer.from,
          to: transfer.to,
          amount: transfer.amount.toString(),
        },
        checks,
      },
      null,
      2,
    ),
  );
  console.log(`Result written to ${file}`);

  if (!allPass) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FAILED WITH EXCEPTION:');
  console.error(e);
  process.exitCode = 1;
});
