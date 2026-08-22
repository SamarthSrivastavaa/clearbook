/**
 * Seeds a demo-ready book (BUILD.md §13.1).
 *
 * Unlike `demo/seed-clearbook.ts` — which runs GATES 5 and 6 and therefore
 * *consumes* the breach by challenging it — this script stops one step short. It
 * leaves scenario B claimed and challengeable, because the challenge is the beat
 * the judge performs live from their own wallet.
 *
 *   registerOriginator (only if needed) → bindTreasury (only if needed)
 *   → registerLoan A + B → claimRepayment ×2 → dry-run both controls → STOP
 *
 * Two properties make it re-runnable, which matters because a challenge window
 * is only ~5 hours wide and a demo may be given days after the code is written:
 *
 *   1. The originator is reused if this treasury is already bound. Registering a
 *      second one would post another 10 tCTC bond for nothing.
 *   2. Facts are selected NEWEST-FIRST per (scenario, role). The proven-facts
 *      ledger accumulates every round ever staged, and every earlier round's
 *      facts are already consumed — taking the first match would reliably fail
 *      with FactAlreadyUsed.
 *
 * The expected outcomes are read from `demo/scenarios.json` and asserted by
 * simulation, so this file and the presenter's script cannot drift apart.
 *
 *   npx tsx demo/seed.ts
 */
import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract, JsonRpcProvider, Wallet, formatEther, parseEther } from 'ethers';

const HERE = dirname(fileURLToPath(import.meta.url));
const STAGED = join(HERE, 'staged');
const PROVEN = join(STAGED, 'proven-facts.json');
const SCENARIOS = join(HERE, 'scenarios.json');
const OUT = join(STAGED, 'clearbook-state.json');

/** Full compiled ABI — a minimal one cannot name a custom error (see K-013). */
const COMPILED_ABI = JSON.parse(
  readFileSync(join(HERE, '..', 'contracts', 'out', 'Clearbook.sol', 'Clearbook.json'), 'utf8'),
).abi;

const VAULT_ABI = [
  'function computeFactId(uint64,uint64,uint64,uint32) pure returns (bytes32)',
  'function exists(bytes32) view returns (bool)',
];

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
}

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

/** Simulates a challenge and reports how the contract refuses it. */
async function refusalOf(
  clearbook: Contract,
  from: string,
  loanId: bigint,
  fundingFactId: string,
): Promise<string> {
  try {
    await clearbook.challenge.staticCall(loanId, fundingFactId, { from });
    return '';
  } catch (e: unknown) {
    const err = e as { revert?: { name?: string }; shortMessage?: string };
    return err.revert?.name ?? err.shortMessage ?? 'reverted';
  }
}

async function main(): Promise<void> {
  if (!existsSync(PROVEN)) throw new Error('no proven facts; run: npm run demo:prove');
  const facts: ProvenFact[] = JSON.parse(readFileSync(PROVEN, 'utf8')).facts ?? [];
  const scenarios = JSON.parse(readFileSync(SCENARIOS, 'utf8'));
  const expected = (id: string) =>
    scenarios.scenarios.find((s: { id: string }) => s.id === id).expected;

  const cc = new JsonRpcProvider(required('CREDITCOIN_RPC_URL'));
  const owner = new Wallet(required('CC_DEPLOYER_PRIVATE_KEY'), cc);
  const challenger = new Wallet(required('CC_WORKER_PRIVATE_KEY'), cc);
  const treasury = new Wallet(required('DEMO_TREASURY_PRIVATE_KEY'));

  const clearbookAddress = required('CLEARBOOK_ADDRESS');
  const clearbook = new Contract(clearbookAddress, COMPILED_ABI, owner);
  // Simulations need an explicit `from`, which ethers refuses on a contract that
  // already has a signer attached. The controls therefore run through a
  // provider-only instance, which cannot send a transaction even by accident.
  const readOnly = new Contract(clearbookAddress, COMPILED_ABI, cc);
  const vault = new Contract(required('EVIDENCE_VAULT_ADDRESS'), VAULT_ABI, cc);

  /**
   * Newest fact for a role. See the header: earlier rounds are consumed, so
   * "first match" is exactly the wrong choice.
   */
  const find = (scenario: string, role: string): ProvenFact => {
    const matches = facts
      .filter((f) => f.scenario === scenario && f.role === role)
      .sort((a, b) => b.blockHeight - a.blockHeight);
    if (matches.length === 0) throw new Error(`missing proven fact: ${scenario}/${role}`);
    return matches[0]!;
  };

  const factId = (f: ProvenFact): Promise<string> =>
    vault.computeFactId(f.chainKey, f.blockHeight, f.txIndex, f.logIndex);

  console.log(`Clearbook  ${clearbookAddress}`);
  console.log(`Owner      ${owner.address}`);
  console.log(`Challenger ${challenger.address}\n`);

  // ------------------------------------------------- every fact must be in the vault
  console.log('=== 0 · evidence is already in the vault ===');
  for (const [scenario, role] of [
    ['A', 'disbursement'],
    ['A', 'repayment'],
    ['B', 'disbursement'],
    ['B', 'funding'],
    ['B', 'repayment'],
  ] as const) {
    const f = find(scenario, role);
    const id = await factId(f);
    check(
      `${scenario}/${role} block ${f.blockHeight}`,
      await vault.exists(id),
      id.slice(0, 12),
    );
  }
  if (failures > 0) {
    console.log('\n  Facts are missing from the vault. Submit them first:');
    console.log('    npx tsx integration/gate4-decode.ts');
    process.exitCode = 1;
    return;
  }

  // ------------------------------------------------------------------ originator
  console.log('\n=== 1 · originator ===');
  let originatorId: bigint = await clearbook.treasuryOwner(treasury.address);
  if (originatorId === 0n) {
    const tx = await clearbook.registerOriginator(
      'Meridian Credit Partners',
      scenarios.covenant.circularWindowBlocks,
      scenarios.covenant.challengeWindowBlocks,
      scenarios.covenant.bit,
      { value: parseEther('10') },
    );
    await tx.wait();
    originatorId = (await clearbook.nextOriginatorId()) - 1n;
    console.log(`  registered originatorId ${originatorId}  bond 10 tCTC  ${tx.hash}`);

    const network = await cc.getNetwork();
    const nonce: bigint = await clearbook.bindingNonce(treasury.address);
    const signature = await treasury.signTypedData(
      {
        name: 'Clearbook',
        version: '1',
        chainId: Number(network.chainId),
        verifyingContract: clearbookAddress,
      },
      {
        TreasuryBinding: [
          { name: 'originatorId', type: 'uint256' },
          { name: 'ethAddress', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'chainId', type: 'uint256' },
        ],
      },
      { originatorId, ethAddress: treasury.address, nonce, chainId: Number(network.chainId) },
    );
    const bind = await clearbook.bindTreasury(originatorId, treasury.address, signature);
    await bind.wait();
    console.log(`  bound treasury ${treasury.address}  ${bind.hash}`);
  } else {
    console.log(`  reusing originatorId ${originatorId} — treasury already bound`);
  }

  const orig = await clearbook.originators(originatorId);
  const free = BigInt(orig.bond) - BigInt(orig.exposure);
  console.log(
    `  bond ${formatEther(orig.bond)} tCTC · exposure ${formatEther(orig.exposure)} tCTC · free ${formatEther(free)} tCTC`,
  );
  check('free bond covers two more loans', free >= parseEther('2'), `${formatEther(free)} tCTC free`);

  // ------------------------------------------------------------------ the loans
  //
  // A disbursement fact backs at most one loan (invariant I3), so if it is already
  // consumed the loans exist and re-registering would revert with FactAlreadyUsed.
  // Adopting them instead makes the script safe to re-run, which matters because
  // the step most likely to fail is the last one.
  const currentBlock = await cc.getBlockNumber();
  const maturity = BigInt(currentBlock + 100_000);

  const aDisb = find('A', 'disbursement');
  const bDisb = find('B', 'disbursement');
  const aDisbId = await factId(aDisb);
  const bDisbId = await factId(bDisb);

  const existingA: bigint = await clearbook.factConsumedBy(aDisbId);
  const existingB: bigint = await clearbook.factConsumedBy(bDisbId);

  let loanA: bigint;
  let loanB: bigint;

  if (existingA !== 0n && existingB !== 0n) {
    loanA = existingA;
    loanB = existingB;
    console.log('\n=== 2 · loans already registered from this evidence ===');
    console.log(`  A (honest)   loanId ${loanA}`);
    console.log(`  B (circular) loanId ${loanB}`);
  } else {
    console.log('\n=== 2 · registerLoan ×2 ===');
    let tx = await clearbook.registerLoan(
      originatorId, aDisb.token, aDisb.to, BigInt(aDisb.amount), maturity, aDisbId,
    );
    await tx.wait();
    loanA = (await clearbook.nextLoanId()) - 1n;
    console.log(`  A (honest)   loanId ${loanA}  borrower ${aDisb.to}  ${tx.hash}`);

    tx = await clearbook.registerLoan(
      originatorId, bDisb.token, bDisb.to, BigInt(bDisb.amount), maturity, bDisbId,
    );
    await tx.wait();
    loanB = (await clearbook.nextLoanId()) - 1n;
    console.log(`  B (circular) loanId ${loanB}  borrower ${bDisb.to}  ${tx.hash}`);
  }

  console.log('\n=== 3 · claimRepayment ×2 ===');
  for (const [label, loanId, repayment] of [
    ['A', loanA, find('A', 'repayment')],
    ['B', loanB, find('B', 'repayment')],
  ] as const) {
    const loan = await clearbook.loans(loanId);
    if (Number(loan.status) === 2) {
      console.log(`  loan ${loanId} (${label}) already claimed`);
      continue;
    }
    const tx = await clearbook.claimRepayment(loanId, await factId(repayment));
    await tx.wait();
    console.log(`  loan ${loanId} (${label}) claimed  ${tx.hash}`);
  }

  // ------------------------------------- the controls, by simulation only
  //
  // Nothing below sends a transaction. The breach is deliberately left un-taken:
  // it is the judge's to perform.
  console.log('\n=== 4 · controls (simulated — no state changes) ===');
  const bFundingId = await factId(find('B', 'funding'));

  const breachRefusal = await refusalOf(readOnly, challenger.address, loanB, bFundingId);
  check(
    'B · the circular flow IS breachable',
    breachRefusal === '',
    breachRefusal || 'challenge would succeed',
  );

  const honestRefusal = await refusalOf(readOnly, challenger.address, loanA, await factId(aDisb));
  check(
    `A · honest loan refuses with ${expected('A').expectedError}`,
    honestRefusal === expected('A').expectedError,
    honestRefusal,
  );

  const unrelatedRefusal = await refusalOf(
    readOnly, challenger.address, loanA, await factId(find('B', 'repayment')),
  );
  check(
    `C · unrelated citation refuses with ${expected('C').expectedError}`,
    unrelatedRefusal === expected('C').expectedError,
    unrelatedRefusal,
  );

  const claimed = await clearbook.loans(loanB);
  const deadline = BigInt(claimed.claimBlock) + BigInt(orig.challengeWindow);
  const now = BigInt(await cc.getBlockNumber());

  const state = {
    at: new Date().toISOString(),
    clearbook: clearbookAddress,
    originatorId: originatorId.toString(),
    loanA: loanA.toString(),
    loanB: loanB.toString(),
    challengeableUntilBlock: deadline.toString(),
    blocksRemaining: (deadline - now).toString(),
    approxMinutesRemaining: Math.round(Number(deadline - now) * 15 / 60),
    fundingFactId: bFundingId,
    controls: {
      breach: breachRefusal === '' ? 'would succeed' : breachRefusal,
      honest: honestRefusal,
      unrelated: unrelatedRefusal,
    },
    checks: { failures },
    demoReady: failures === 0,
  };
  if (!existsSync(STAGED)) mkdirSync(STAGED, { recursive: true });
  writeFileSync(OUT, JSON.stringify(state, null, 2));

  console.log(`\n================ SEED: ${failures === 0 ? 'DEMO READY' : 'FAIL'} ================`);
  console.log(`  Challenge loan ${loanB} with funding fact ${bFundingId}`);
  console.log(
    `  Window closes at block ${deadline} — about ${state.approxMinutesRemaining} minutes from now.`,
  );
  console.log(`  written ${OUT}`);
  if (failures > 0) process.exitCode = 1;
}

// Direct-invocation guard (KNOWN_ISSUES K-001).
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
