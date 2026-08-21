/**
 * Exercises judge mode's chain path outside the browser.
 *
 * The /verify screen resolves the chain key from the ChainInfo precompile, asks
 * whether a block is attested, fetches a proof, and calls verify() on the Block
 * Prover precompile. Those calls go through viem with hand-written ABI tuples —
 * if any tuple is shaped wrong the screen fails at demo time with an opaque RPC
 * error. This runs the identical code against a real transaction.
 *
 *   npx tsx frontend/scripts/check-verify.ts [txHash]
 */
import {
  attestationBounds,
  resolveSourceChainKey,
  sourceClient,
  verifyOnChain,
  type ProofBundle,
} from '../lib/verifier';

const PROVER = process.env.PROOF_BUILDER_URL ?? 'https://prover.cc3-testnet.creditcoin.network';

/** A transaction verified during Phase 0. Third-party; we did not create it. */
const DEFAULT_TX = '0xc5e1086751fed6419e37c0e223e911cd4c31ace0e20713ad91ac1e5fa44d84f1';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const txHash = (process.argv[2] ?? DEFAULT_TX) as `0x${string}`;
  console.log(`\nSubject transaction: ${txHash}\n`);

  console.log('1. Locate on the source chain');
  const receipt = await sourceClient.getTransactionReceipt({ hash: txHash });
  const block = Number(receipt.blockNumber);
  check('receipt found', !!receipt);
  check('receipt status is success', receipt.status === 'success', `status=${receipt.status}`);
  console.log(`     block ${block}, index ${receipt.transactionIndex}, ${receipt.logs.length} logs`);

  console.log('\n2. Resolve chain key from the ChainInfo precompile');
  const chainKey = await resolveSourceChainKey();
  check('chain key resolved at runtime', Number.isInteger(chainKey), `chainKey=${chainKey}`);

  console.log('\n3. Attestation bounds from the precompile');
  const bounds = await attestationBounds(chainKey, block);
  check('block is attested', bounds.isAttested);
  console.log(`     bounds ${bounds.parentHeight} – ${bounds.childHeight}`);

  console.log('\n4. Proof from the Attestcoin proof builder');
  const res = await fetch(`${PROVER}/api/v1/proof-by-tx/${chainKey}/${txHash}`);
  check('prover responded 200', res.ok, `status=${res.status}`);
  const bundle = (await res.json()) as ProofBundle;
  console.log(
    `     ${bundle.merkleProof.siblings.length} siblings, ${bundle.continuityProof.roots.length} continuity roots, ` +
      `${(bundle.txBytes.length - 2) / 2} bytes`,
  );
  check('proof block matches the receipt', bundle.headerNumber === block);
  check('proof txIndex matches the receipt', bundle.txIndex === receipt.transactionIndex);

  console.log('\n5. verify() at the Block Prover precompile');
  const ok = await verifyOnChain(bundle);
  check('precompile returned true', ok === true, `returned ${ok}`);

  console.log(`\n${failures === 0 ? 'JUDGE MODE PATH VERIFIED' : `${failures} CHECK(S) FAILED`}\n`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error('\nFAILED:', (e as Error).message);
  process.exitCode = 1;
});
