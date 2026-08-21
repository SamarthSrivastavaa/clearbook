/**
 * Presenter checklist (BUILD.md §13.4).
 *
 * Prints the pre-warmed evidence and the live state of everything the demo
 * depends on, so nothing has to be remembered or looked up mid-demo.
 *
 * Reads from the staged and proven ledgers rather than restating them, so it
 * cannot drift from what was actually broadcast and verified.
 *
 *   npx tsx demo/run.ts
 */
import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonRpcProvider } from 'ethers';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'staged');
const STAGED = join(DIR, 'source-transactions.json');
const PROVEN = join(DIR, 'proven-facts.json');

const SEPOLIA_EXPLORER = 'https://sepolia.etherscan.io';
const CC_EXPLORER = 'https://creditcoin-testnet.blockscout.com';

interface ProvenFact {
  scenario: string;
  role: string;
  txHash: string;
  blockHeight: number;
  txIndex: number;
  logIndex: number;
  token: string;
  from: string;
  to: string;
  amount: string;
  verified: boolean;
  crossChecksPassed: number;
  crossChecksTotal: number;
}

const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;
const ok = (b: boolean) => (b ? 'OK  ' : 'MISS');

async function main(): Promise<void> {
  console.log('\n══════════ CLEARBOOK — PRESENTER CHECKLIST ══════════\n');

  // --- pre-warmed evidence ---
  if (!existsSync(PROVEN)) {
    console.log('  MISS  No proven facts. Run: npm run demo:stage && npm run demo:prove\n');
  } else {
    const facts: ProvenFact[] = JSON.parse(readFileSync(PROVEN, 'utf8')).facts ?? [];
    const allVerified = facts.every((f) => f.verified && f.crossChecksPassed === f.crossChecksTotal);
    console.log(`EVIDENCE — ${facts.length} facts, ${ok(allVerified)} all verified\n`);

    for (const scenario of ['A', 'B', 'D']) {
      const group = facts.filter((f) => f.scenario === scenario);
      if (group.length === 0) continue;
      console.log(`  Scenario ${scenario}`);
      for (const f of group) {
        console.log(
          `    ${f.role.padEnd(13)} block ${f.blockHeight}  txIdx ${String(f.txIndex).padStart(3)}  ` +
            `logIdx ${f.logIndex}  ${f.crossChecksPassed}/${f.crossChecksTotal} checks`,
        );
        console.log(`      ${SEPOLIA_EXPLORER}/tx/${f.txHash}`);
      }
      console.log('');
    }
  }

  // --- the narrative, with its expected outcomes declared up front ---
  console.log('EXPECTED OUTCOMES — say these before demonstrating them\n');
  console.log('  A  Legitimate        challenge REVERTS at condition 11 (DisbursementNotFunding)');
  console.log('                       the only treasury->borrower transfer IS the disbursement');
  console.log('  B  Circular flow     challenge SUCCEEDS — bond slashed, bounty paid');
  console.log('                       a second, distinct treasury->payer transfer exists');
  console.log('  C  Invalid challenge cite an unrelated transfer -> FundingNotFromBoundTreasury');
  console.log('  D  Delinquent        markDelinquent() callable by anyone after maturity\n');
  console.log('  Note: A and C both fail, and that is the point. A mechanism that only ever');
  console.log('  succeeds demonstrates nothing.\n');

  // --- live infrastructure ---
  console.log('LIVE STATE\n');

  const ccUrl = process.env.CREDITCOIN_RPC_URL;
  const srcUrl = process.env.SOURCE_CHAIN_RPC_URL;

  if (srcUrl) {
    try {
      const head = await new JsonRpcProvider(srcUrl).getBlockNumber();
      console.log(`  OK    Sepolia head            ${head}`);
    } catch {
      console.log('  MISS  Sepolia RPC unreachable');
    }
  }

  if (ccUrl) {
    try {
      const cc = new JsonRpcProvider(ccUrl);
      const net = await cc.getNetwork();
      const block = await cc.getBlockNumber();
      console.log(`  OK    Creditcoin chainId      ${net.chainId} @ block ${block}`);
    } catch {
      console.log('  MISS  Creditcoin RPC unreachable');
    }
  }

  try {
    const res = await fetch('https://prover.cc3-testnet.creditcoin.network/api/v1/attested-height/1');
    const body = (await res.json()) as { attestedHeight?: number };
    console.log(`  OK    Prover attested height  ${body.attestedHeight ?? 'unknown'}`);
  } catch {
    console.log('  MISS  Proof builder unreachable — the challenge is unaffected,');
    console.log('        because facts are already in the vault');
  }

  // --- deployment ---
  const vault = process.env.EVIDENCE_VAULT_ADDRESS;
  const clearbook = process.env.CLEARBOOK_ADDRESS;
  console.log('');
  if (vault && clearbook) {
    console.log(`  OK    EvidenceVault  ${vault}`);
    console.log(`        ${CC_EXPLORER}/address/${vault}`);
    console.log(`  OK    Clearbook      ${clearbook}`);
    console.log(`        ${CC_EXPLORER}/address/${clearbook}`);
  } else {
    console.log('  MISS  Contracts not deployed — set EVIDENCE_VAULT_ADDRESS and CLEARBOOK_ADDRESS');
    console.log('        Deployment needs a funded Creditcoin account (~0.0015 tCTC plus the bond)');
  }

  // --- the four-second proof that we deployed nothing on Ethereum ---
  const staged = existsSync(STAGED) ? JSON.parse(readFileSync(STAGED, 'utf8')) : null;
  if (staged?.token) {
    console.log('\nTHE FOUR-SECOND CHECK — run this on camera\n');
    console.log(`  cast code ${staged.token} --rpc-url $SOURCE_CHAIN_RPC_URL`);
    console.log('    -> bytecode. A token we do not control.');
    console.log(`  cast code ${process.env.DEMO_TREASURY_ADDRESS ?? '$TREASURY'} --rpc-url $SOURCE_CHAIN_RPC_URL`);
    console.log('    -> 0x. We deployed nothing on Ethereum.');
  }

  console.log('\n  Language: "prohibited circular flow under covenant CIRCULAR_REPAYMENT."');
  console.log('  Never "fraud". The covenant establishes that a published rule was not met.\n');
}

main().catch((e) => {
  console.error(`FAILED: ${(e as Error).message}`);
  process.exitCode = 1;
});
