/**
 * Seeds scenario B alone, leaving the breach un-taken.
 *
 * `demo/seed.ts` stages both scenarios and is the right tool when both have
 * fresh evidence. It cannot help when only the circular flow has been re-staged:
 * it would try to reuse scenario A's disbursement, which an earlier round has
 * already consumed, and revert `FactAlreadyUsed`.
 *
 * This registers the newest scenario-B loan and claims its repayment, then
 * stops. The funding leg is deliberately left uncommitted and citable, which is
 * exactly the state a challenger — human or otherwise — acts on.
 *
 *   npx tsx demo/seed-b.ts
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { AbiCoder, Contract, JsonRpcProvider, Wallet, keccak256 } from 'ethers';

const strip = (v?: string) => (v ?? '').replace(/^['"]|['"]$/g, '');

const CLEARBOOK_ABI = [
  'function nextLoanId() view returns (uint256)',
  'function registerLoan(uint256 originatorId, address token, address borrower, uint256 principal, uint64 maturityBlock, bytes32 disbursementFactId) returns (uint256)',
  'function claimRepayment(uint256 loanId, bytes32 repaymentFactId)',
  'function factConsumedBy(bytes32) view returns (uint256)',
  'function originators(uint256) view returns (address owner, string name, uint256 bond, uint256 exposure, uint32 circularWindow, uint32 challengeWindow, uint64 lastClaimBlock, uint16 covenants, bool active)',
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

/** The vault's own fact identity. */
function factIdOf(f: ProvenFact): string {
  return keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ['uint64', 'uint64', 'uint64', 'uint32'],
      [f.chainKey, f.blockHeight, f.txIndex, f.logIndex],
    ),
  );
}

/** Newest first: earlier rounds are already consumed. */
function newest(facts: ProvenFact[], role: string): ProvenFact {
  const matches = facts
    .filter((f) => f.scenario === 'B' && f.role === role)
    .sort((a, b) => b.blockHeight - a.blockHeight);
  if (matches.length === 0) throw new Error(`no proven scenario-B ${role}`);
  return matches[0];
}

async function main(): Promise<void> {
  const cc = new JsonRpcProvider(strip(process.env.CREDITCOIN_RPC_URL));
  const owner = new Wallet(strip(process.env.CC_DEPLOYER_PRIVATE_KEY), cc);
  const clearbook = new Contract(strip(process.env.CLEARBOOK_ADDRESS), CLEARBOOK_ABI, owner);
  const originatorId = 1n;

  // The ledger is an object with metadata, not a bare array.
  const ledger = JSON.parse(readFileSync('demo/staged/proven-facts.json', 'utf8')) as {
    facts: ProvenFact[];
  };
  const facts = ledger.facts;
  const disbursement = newest(facts, 'disbursement');
  const funding = newest(facts, 'funding');
  const repayment = newest(facts, 'repayment');

  const disbId = factIdOf(disbursement);
  const fundId = factIdOf(funding);
  const repayId = factIdOf(repayment);

  console.log('\nScenario B, newest round');
  console.log(`  disbursement  block ${disbursement.blockHeight}  ${disbId}`);
  console.log(`  funding       block ${funding.blockHeight}  ${fundId}`);
  console.log(`  repayment     block ${repayment.blockHeight}  ${repayId}\n`);

  for (const [name, id] of [
    ['disbursement', disbId],
    ['repayment', repayId],
  ] as const) {
    const consumed: bigint = await clearbook.factConsumedBy(id);
    if (consumed !== 0n) throw new Error(`${name} already consumed by loan ${consumed}; re-stage scenario B`);
  }
  const fundingConsumed: bigint = await clearbook.factConsumedBy(fundId);
  if (fundingConsumed !== 0n) throw new Error(`funding leg already consumed by loan ${fundingConsumed}`);

  const head = await cc.getBlockNumber();
  const orig = await clearbook.originators(originatorId);

  console.log('registerLoan…');
  const reg = await clearbook.registerLoan(
    originatorId,
    disbursement.token,
    disbursement.to,
    disbursement.amount,
    BigInt(head) + 1_000n,
    disbId,
  );
  await reg.wait();
  const loanId = (await clearbook.nextLoanId()) - 1n;
  console.log(`  loan ${loanId} registered  borrower ${disbursement.to}  ${reg.hash}`);

  console.log('claimRepayment…');
  const claim = await clearbook.claimRepayment(loanId, repayId);
  const claimReceipt = await claim.wait();
  console.log(`  claimed  ${claim.hash}`);

  const deadline = BigInt(claimReceipt.blockNumber) + BigInt(orig.challengeWindow);
  console.log(`\nLoan ${loanId} is REPAYMENT_CLAIMED.`);
  console.log(`  challenge window open until Creditcoin block ${deadline} (~5 hours)`);
  console.log(`  funding leg left uncommitted and citable: ${fundId}`);
  console.log('\nThe breach is available. Nobody has taken it.\n');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
