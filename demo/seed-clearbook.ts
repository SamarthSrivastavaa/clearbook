/**
 * Seeds the Clearbook side of the demo and runs GATES 5 and 6.
 *
 *   registerOriginator → bindTreasury → registerLoan ×2 → claimRepayment ×2
 *   → challenge (scenario B, must SUCCEED)
 *   → challenge (scenario A, must REVERT)
 *
 * GATE 5 (BUILD.md §11 Phase 6): a real circular flow triggers `challenge()`
 * successfully; a non-circular one reverts.
 *
 * GATE 6 (Phase 7): bond decreases by exactly `slash`, the challenger's balance
 * increases by exactly `bounty`, `protocolSink` receives the remainder,
 * `exposure` decrements, and I1/I2 hold on-chain.
 *
 * Every figure is read from the chain before and after, and compared. Nothing is
 * assumed from the contract source.
 *
 *   npx tsx demo/seed-clearbook.ts
 */
import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract, JsonRpcProvider, Wallet, formatEther, parseEther } from 'ethers';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'staged');
const PROVEN = join(DIR, 'proven-facts.json');
const OUT = join(DIR, 'clearbook-state.json');
const RESULTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'integration', 'results');

/**
 * The FULL compiled ABI, not a hand-written subset.
 *
 * A minimal ABI cannot decode custom errors — ethers reports "unknown custom
 * error" and the negative controls become unreadable. Since the whole point of
 * scenario A is *which condition* refuses it, the error definitions are
 * load-bearing here.
 */
const COMPILED_ABI = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'contracts', 'out', 'Clearbook.sol', 'Clearbook.json'),
    'utf8',
  ),
).abi;

const CLEARBOOK_ABI_UNUSED = [
  'function registerOriginator(string name, uint32 circularWindow, uint32 challengeWindow, uint16 covenants) payable returns (uint256)',
  'function bindTreasury(uint256 originatorId, address ethAddress, bytes signature)',
  'function registerLoan(uint256 originatorId, address token, address borrower, uint256 principal, uint64 maturityBlock, bytes32 disbursementFactId) returns (uint256)',
  'function claimRepayment(uint256 loanId, bytes32 repaymentFactId)',
  'function challenge(uint256 loanId, bytes32 fundingFactId) returns (uint256)',
  'function originators(uint256) view returns (address owner, string name, uint256 bond, uint256 exposure, uint32 circularWindow, uint32 challengeWindow, uint64 lastClaimBlock, uint16 covenants, bool active)',
  'function loans(uint256) view returns (uint256 originatorId, address token, address borrower, uint256 principal, uint64 maturityBlock, bytes32 disbursementFactId, bytes32 repaymentFactId, uint64 claimBlock, uint8 status)',
  'function treasuryOwner(address) view returns (uint256)',
  'function bindingNonce(address) view returns (uint256)',
  'function nextOriginatorId() view returns (uint256)',
  'function nextLoanId() view returns (uint256)',
  'function BOND_PER_LOAN() view returns (uint256)',
  'function BOUNTY_BPS() view returns (uint16)',
  'function SLASH_BPS() view returns (uint16)',
  'function PROTOCOL_SINK() view returns (address)',
];

interface ProvenFact {
  scenario: string;
  role: string;
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

const VAULT_ABI = ['function computeFactId(uint64,uint64,uint64,uint32) pure returns (bytes32)'];

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`    ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

async function main(): Promise<void> {
  if (!existsSync(PROVEN)) throw new Error('no proven facts; run: npm run demo:prove');
  const facts: ProvenFact[] = JSON.parse(readFileSync(PROVEN, 'utf8')).facts ?? [];

  const cc = new JsonRpcProvider(required('CREDITCOIN_RPC_URL'));
  const owner = new Wallet(required('CC_DEPLOYER_PRIVATE_KEY'), cc);
  const challenger = new Wallet(required('CC_WORKER_PRIVATE_KEY'), cc);
  const treasuryKey = required('DEMO_TREASURY_PRIVATE_KEY');
  const treasury = new Wallet(treasuryKey);

  const clearbookAddress = required('CLEARBOOK_ADDRESS');
  const clearbook = new Contract(clearbookAddress, COMPILED_ABI, owner);
  const vault = new Contract(required('EVIDENCE_VAULT_ADDRESS'), VAULT_ABI, cc);

  const factId = (f: ProvenFact): Promise<string> =>
    vault.computeFactId(f.chainKey, f.blockHeight, f.txIndex, f.logIndex);

  const find = (scenario: string, role: string) => {
    const f = facts.find((x) => x.scenario === scenario && x.role === role);
    if (!f) throw new Error(`missing proven fact: ${scenario}/${role}`);
    return f;
  };

  console.log(`Clearbook ${clearbookAddress}`);
  console.log(`Owner     ${owner.address}`);
  console.log(`Challenger ${challenger.address}\n`);

  // ---------------------------------------------------------------- originator
  console.log('=== 1 · registerOriginator ===');
  const CIRCULAR_WINDOW = 5_000;
  const CHALLENGE_WINDOW = 1_200;
  let tx = await clearbook.registerOriginator('Meridian Credit Partners', CIRCULAR_WINDOW, CHALLENGE_WINDOW, 1, {
    value: parseEther('10'),
  });
  await tx.wait();
  const originatorId: bigint = (await clearbook.nextOriginatorId()) - 1n;
  console.log(`  originatorId ${originatorId}  bond 10 tCTC  ${tx.hash}\n`);

  // ------------------------------------------------------------------- binding
  console.log('=== 2 · bindTreasury (EIP-712 signature by the Sepolia key) ===');
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
    {
      originatorId,
      ethAddress: treasury.address,
      nonce,
      chainId: Number(network.chainId),
    },
  );
  tx = await clearbook.bindTreasury(originatorId, treasury.address, signature);
  await tx.wait();
  check('treasury bound to this originator', (await clearbook.treasuryOwner(treasury.address)) === originatorId);
  console.log(`  ${treasury.address}  ${tx.hash}\n`);

  // ---------------------------------------------------------------- loan A + B
  const currentBlock = await cc.getBlockNumber();
  const maturity = BigInt(currentBlock + 100_000);

  console.log('=== 3 · registerLoan — scenario A (honest) ===');
  const aDisb = find('A', 'disbursement');
  tx = await clearbook.registerLoan(
    originatorId,
    aDisb.token,
    aDisb.to,
    BigInt(aDisb.amount),
    maturity,
    await factId(aDisb),
  );
  await tx.wait();
  const loanA: bigint = (await clearbook.nextLoanId()) - 1n;
  console.log(`  loanId ${loanA}  borrower ${aDisb.to}  ${tx.hash}\n`);

  console.log('=== 4 · registerLoan — scenario B (will be breached) ===');
  const bDisb = find('B', 'disbursement');
  tx = await clearbook.registerLoan(
    originatorId,
    bDisb.token,
    bDisb.to,
    BigInt(bDisb.amount),
    maturity,
    await factId(bDisb),
  );
  await tx.wait();
  const loanB: bigint = (await clearbook.nextLoanId()) - 1n;
  console.log(`  loanId ${loanB}  borrower ${bDisb.to}  ${tx.hash}\n`);

  // ------------------------------------------------------------------- claims
  console.log('=== 5 · claimRepayment ×2 ===');
  tx = await clearbook.claimRepayment(loanA, await factId(find('A', 'repayment')));
  await tx.wait();
  console.log(`  loan ${loanA} claimed  ${tx.hash}`);
  tx = await clearbook.claimRepayment(loanB, await factId(find('B', 'repayment')));
  await tx.wait();
  console.log(`  loan ${loanB} claimed  ${tx.hash}\n`);

  // ---------------------------------------------------- GATE 5 + 6: the breach
  console.log('=== GATE 5 · challenge scenario B — must SUCCEED ===');

  const before = await clearbook.originators(originatorId);
  const sink: string = await clearbook.PROTOCOL_SINK();
  const bondPerLoan: bigint = await clearbook.BOND_PER_LOAN();
  const bountyBps: bigint = BigInt(await clearbook.BOUNTY_BPS());
  const slashBps: bigint = BigInt(await clearbook.SLASH_BPS());

  const challengerBefore: bigint = await cc.getBalance(challenger.address);
  const sinkBefore: bigint = await cc.getBalance(sink);
  const contractBefore: bigint = await cc.getBalance(clearbookAddress);

  const bFunding = find('B', 'funding');
  const asChallenger = clearbook.connect(challenger) as Contract;
  const challengeTx = await asChallenger.challenge(loanB, await factId(bFunding));
  const challengeReceipt = await challengeTx.wait();
  const gasCost = BigInt(challengeReceipt.gasUsed) * BigInt(challengeReceipt.gasPrice);

  check('challenge succeeded', challengeReceipt.status === 1, challengeTx.hash);

  const after = await clearbook.originators(originatorId);
  const loanBAfter = await clearbook.loans(loanB);
  const challengerAfter: bigint = await cc.getBalance(challenger.address);
  const sinkAfter: bigint = await cc.getBalance(sink);
  const contractAfter: bigint = await cc.getBalance(clearbookAddress);

  const expectedSlash = (bondPerLoan * slashBps) / 10_000n;
  const expectedBounty = (expectedSlash * bountyBps) / 10_000n;
  const expectedSink = expectedSlash - expectedBounty;

  console.log('\n=== GATE 6 · economics, measured on-chain ===');
  check('loan status is BREACHED (5)', Number(loanBAfter.status) === 5, `status=${loanBAfter.status}`);
  check(
    'bond decreased by exactly slash',
    BigInt(before.bond) - BigInt(after.bond) === expectedSlash,
    `${formatEther(BigInt(before.bond) - BigInt(after.bond))} tCTC`,
  );
  check(
    'exposure decremented by bondPerLoan',
    BigInt(before.exposure) - BigInt(after.exposure) === bondPerLoan,
    `${formatEther(BigInt(before.exposure) - BigInt(after.exposure))} tCTC`,
  );
  check(
    'challenger received exactly bounty (net of gas)',
    challengerAfter - challengerBefore + gasCost === expectedBounty,
    `${formatEther(challengerAfter - challengerBefore + gasCost)} tCTC`,
  );
  check(
    'protocolSink received the remainder',
    sinkAfter - sinkBefore === expectedSink,
    `${formatEther(sinkAfter - sinkBefore)} tCTC`,
  );
  check(
    'contract balance fell by exactly the slash',
    contractBefore - contractAfter === expectedSlash,
    `${formatEther(contractBefore - contractAfter)} tCTC`,
  );
  check('I1 · contract balance covers remaining bond', contractAfter >= BigInt(after.bond));
  check('I2 · bond >= exposure', BigInt(after.bond) >= BigInt(after.exposure));

  // ------------------------------------------- GATE 5, the other half: honesty
  console.log('\n=== GATE 5 · challenge scenario A — must REVERT ===');
  let reverted = false;
  let errorName = '';
  try {
    await (clearbook.connect(challenger) as Contract).challenge.staticCall(
      loanA,
      await factId(find('A', 'disbursement')),
    );
  } catch (e: unknown) {
    reverted = true;
    const err = e as { revert?: { name?: string }; shortMessage?: string };
    errorName = err.revert?.name ?? err.shortMessage ?? 'reverted';
  }
  check('honest loan is NOT breachable', reverted, errorName);
  // Which condition refuses it is the interesting part. Citing the loan's own
  // disbursement is refused by condition 11 — the check that exists precisely so
  // that an honest loan does not look circular.
  check(
    'refused by a named covenant condition',
    errorName === 'DisbursementNotFunding',
    errorName,
  );

  const state = {
    at: new Date().toISOString(),
    clearbook: clearbookAddress,
    originatorId: originatorId.toString(),
    loanA: loanA.toString(),
    loanB: loanB.toString(),
    challengeTxHash: challengeTx.hash,
    economics: {
      slash: expectedSlash.toString(),
      bounty: expectedBounty.toString(),
      toSink: expectedSink.toString(),
      bondBefore: BigInt(before.bond).toString(),
      bondAfter: BigInt(after.bond).toString(),
      exposureBefore: BigInt(before.exposure).toString(),
      exposureAfter: BigInt(after.exposure).toString(),
    },
    honestLoanRevert: errorName,
    gate5: reverted && challengeReceipt.status === 1,
    gate6: failures === 0,
  };

  mkdirSync(DIR, { recursive: true });
  writeFileSync(OUT, JSON.stringify(state, null, 2));
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(join(RESULTS, 'gate5-gate6.json'), JSON.stringify(state, null, 2));

  console.log(`\n================ GATES 5 + 6: ${failures === 0 ? 'PASS' : 'FAIL'} ================`);
  console.log(`Written to ${OUT}`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`\nFAILED: ${(e as Error).message ?? e}`);
  process.exitCode = 1;
});
