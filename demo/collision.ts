/**
 * P3 — duplicate commitment of verified evidence, rejected on-chain.
 *
 * Two independent originators. The first commits a verified fact to a claim.
 * The second — a separately funded, separately owned, legitimately bonded
 * institution — attempts to commit *the same fact* to a claim of its own.
 *
 * The chain refuses it.
 *
 * What this establishes
 * ---------------------
 *   A verified TransferFact can back at most one credit claim, across every
 *   originator in the registry.
 *
 * What it does NOT establish. The rejected fact is a specific ERC-20 transfer,
 * not a piece of collateral: Clearbook has no notion of collateral identity, so
 * this does not prevent the same underlying obligation being represented by some
 * *other* transaction. It prevents duplicate commitment of the same evidence.
 * That distinction is the difference between a claim we can prove and a claim
 * that would be marketing.
 *
 * The rejection is genuine. The same factId is passed to the same deployed
 * contract, and the revert is read from the chain — nothing here is simulated,
 * pre-labelled, or mocked.
 *
 *   npx tsx demo/collision.ts            # ensure originator B, then collide
 *   npx tsx demo/collision.ts --dry-run  # report what would happen, send nothing
 */
import 'dotenv/config';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract, JsonRpcProvider, Wallet, formatEther, parseEther } from 'ethers';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const RESULTS = join(ROOT, 'integration', 'results');
const ARTIFACT = join(RESULTS, 'collision.json');
const ENV_FILE = join(ROOT, '.env');

/** Originator B's parameters. Deliberately identical policy to A — the point is
 *  that the rejection turns on the evidence, not on anything about the fund. */
const B_NAME = 'Northgate Structured Credit';
const B_CIRCULAR_WINDOW = 5_000;
const B_CHALLENGE_WINDOW = 1_200;
const COVENANT_CIRCULAR_REPAYMENT = 0x01;
const B_BOND = parseEther('2');
const B_GAS_FUNDING = parseEther('1');

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

/**
 * Originator B's key. Generated once and persisted to .env (gitignored) so the
 * demo is reproducible and B keeps a stable on-chain identity across runs.
 */
function originatorBKey(): string {
  const existing = process.env.ORIGINATOR_B_PRIVATE_KEY;
  if (existing) return existing;

  const w = Wallet.createRandom();
  appendFileSync(ENV_FILE, `\nORIGINATOR_B_PRIVATE_KEY="${w.privateKey}"\n`);
  process.env.ORIGINATOR_B_PRIVATE_KEY = w.privateKey;
  console.log(`  generated originator B wallet ${w.address} and wrote its key to .env`);
  return w.privateKey;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const clearbookAddress = required('CLEARBOOK_ADDRESS');
  const cc = new JsonRpcProvider(required('CREDITCOIN_RPC_URL'));

  const abi = JSON.parse(
    readFileSync(join(ROOT, 'contracts', 'out', 'Clearbook.sol', 'Clearbook.json'), 'utf8'),
  ).abi;

  const deployer = new Wallet(required('CC_DEPLOYER_PRIVATE_KEY'), cc);
  const ownerB = new Wallet(originatorBKey(), cc);

  const asA = new Contract(clearbookAddress, abi, deployer);
  const asB = new Contract(clearbookAddress, abi, ownerB);
  const read = new Contract(clearbookAddress, abi, cc);

  console.log('=== 0 · the two originators ===');
  const origA = await read.originators(1n);
  check('originator A exists', origA.owner !== '0x'.padEnd(42, '0'), `${origA.name}`);
  console.log(`    A  ${origA.name}  owner ${origA.owner}`);
  check('originator B is a different address', ownerB.address !== origA.owner, ownerB.address);

  // --- find a fact A has already committed ---
  console.log('\n=== 1 · a fact originator A has already committed ===');
  let targetFactId: string | null = null;
  let targetLoanId = 0n;
  for (let id = 1n; id <= 8n; id++) {
    const loan = await read.loans(id);
    if (loan.originatorId === 0n) continue;
    if (loan.originatorId !== 1n) continue;
    const consumer = await read.factConsumedBy(loan.disbursementFactId);
    if (consumer === id) {
      targetFactId = loan.disbursementFactId;
      targetLoanId = id;
      break;
    }
  }
  check('found a committed fact', !!targetFactId, targetFactId ? `loan ${targetLoanId}` : 'none');
  if (!targetFactId) throw new Error('no committed fact found; run: npm run demo:seed');

  const fact = await new Contract(
    required('EVIDENCE_VAULT_ADDRESS'),
    [
      'function getFact(bytes32) view returns ((uint64 chainKey,uint64 blockHeight,uint64 txIndex,uint32 logIndex,address token,address from,address to,uint256 amount,address submitter,uint64 ccBlock))',
    ],
    cc,
  ).getFact(targetFactId);

  console.log(`    factId        ${targetFactId}`);
  console.log(`    committed to  L-${targetLoanId.toString().padStart(3, '0')} (${origA.name})`);
  console.log(`    transfer      ${fact.from} -> ${fact.to}`);

  // --- ensure B is a real, bonded originator ---
  console.log('\n=== 2 · originator B joins the registry ===');
  let originatorBId = 0n;
  for (let id = 1n; id <= 8n; id++) {
    const o = await read.originators(id);
    if (o.owner.toLowerCase() === ownerB.address.toLowerCase()) {
      originatorBId = id;
      break;
    }
  }

  if (originatorBId > 0n) {
    const o = await read.originators(originatorBId);
    console.log(`    already registered as originator ${originatorBId} (${o.name})`);
    check('originator B is bonded', o.bond >= B_BOND / 2n, `${formatEther(o.bond)} tCTC`);
  } else if (dryRun) {
    console.log('    --dry-run: would fund and register originator B');
  } else {
    const bal = await cc.getBalance(ownerB.address);
    if (bal < B_BOND + B_GAS_FUNDING) {
      const need = B_BOND + B_GAS_FUNDING - bal;
      console.log(`    funding B with ${formatEther(need)} tCTC from the deployer`);
      const f = await deployer.sendTransaction({ to: ownerB.address, value: need });
      await f.wait();
    }
    const tx = await asB.registerOriginator(
      B_NAME,
      B_CIRCULAR_WINDOW,
      B_CHALLENGE_WINDOW,
      COVENANT_CIRCULAR_REPAYMENT,
      { value: B_BOND },
    );
    const rcpt = await tx.wait();
    check('originator B registered', rcpt.status === 1, tx.hash);
    for (let id = 1n; id <= 8n; id++) {
      const o = await read.originators(id);
      if (o.owner.toLowerCase() === ownerB.address.toLowerCase()) {
        originatorBId = id;
        break;
      }
    }
    console.log(`    B is originator ${originatorBId}: ${B_NAME}, bond ${formatEther(B_BOND)} tCTC`);
  }

  if (dryRun) {
    console.log('\n=== 3 · the collision (dry run) ===');
    console.log(`    would call registerLoan(originator ${originatorBId || '?'}, fact ${targetFactId.slice(0, 12)}…)`);
    console.log('    expected: revert FactAlreadyUsed');
    console.log('\n--dry-run: nothing was sent.');
    return;
  }

  // --- the collision ---
  console.log('\n=== 3 · originator B attempts the same fact ===');
  const head = await cc.getBlockNumber();
  const args = [
    originatorBId,
    fact.token,
    fact.to, // same borrower the evidence names
    fact.amount,
    BigInt(head + 100_000), // maturity comfortably in the future
    targetFactId,
  ] as const;

  // Simulate first: this is where the named error is legible.
  let staticError: string | null = null;
  try {
    await asB.registerLoan.staticCall(...args);
  } catch (e: unknown) {
    const err = e as { revert?: { name?: string }; shortMessage?: string };
    staticError = err.revert?.name ?? err.shortMessage ?? String(e);
  }
  check('the contract refuses it', staticError === 'FactAlreadyUsed', staticError ?? 'no revert');

  // Then send it for real, so the rejection is a transaction anyone can inspect.
  let onChainStatus: number | null = null;
  let sentHash: string | null = null;
  try {
    const tx = await asB.registerLoan(...args, { gasLimit: 500_000 });
    sentHash = tx.hash;
    const rcpt = await tx.wait();
    onChainStatus = rcpt?.status ?? null;
  } catch (e: unknown) {
    const err = e as { receipt?: { hash?: string; status?: number }; shortMessage?: string };
    sentHash = err.receipt?.hash ?? sentHash;
    onChainStatus = err.receipt?.status ?? 0;
    console.log(`    reverted on-chain: ${err.shortMessage ?? 'reverted'}`);
  }
  check('the transaction reverted on-chain', onChainStatus === 0, sentHash ?? 'no hash');

  console.log('\n=== 4 · nothing changed ===');
  const stillA = await read.factConsumedBy(targetFactId);
  check('the fact still belongs to A’s claim', stillA === targetLoanId, `loan ${stillA}`);
  const oB = await read.originators(originatorBId);
  check('B gained no exposure', oB.exposure === 0n, `${formatEther(oB.exposure)} tCTC`);
  check('B kept its bond', oB.bond > 0n, `${formatEther(oB.bond)} tCTC`);

  const artifact = {
    phase: 'P3 — duplicate commitment rejected',
    at: new Date().toISOString(),
    clearbook: clearbookAddress,
    establishes: 'A verified TransferFact can back at most one credit claim, across all originators.',
    doesNotEstablish:
      'Collateral identity. The same underlying obligation represented by a different transaction is not detected.',
    fact: {
      factId: targetFactId,
      chainKey: Number(fact.chainKey),
      blockHeight: fact.blockHeight.toString(),
      from: fact.from,
      to: fact.to,
      amount: fact.amount.toString(),
    },
    incumbent: { originatorId: 1, name: origA.name, owner: origA.owner, loanId: targetLoanId.toString() },
    challenger: { originatorId: originatorBId.toString(), name: B_NAME, owner: ownerB.address },
    rejection: { error: staticError, transaction: sentHash, receiptStatus: onChainStatus },
    checks: { failures },
    pass: failures === 0,
  };
  if (!existsSync(RESULTS)) mkdirSync(RESULTS, { recursive: true });
  writeFileSync(ARTIFACT, JSON.stringify(artifact, null, 2));

  console.log(`\n================ P3: ${failures === 0 ? 'PASS' : 'FAIL'} ================`);
  console.log(`  error   ${staticError}`);
  console.log(`  tx      ${sentHash}`);
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
