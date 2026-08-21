/**
 * Stages source-chain transactions for the demo (BUILD.md §13.1).
 *
 * These are REAL Sepolia transactions that we create, using canonical WETH — a
 * third-party contract we do not control and cannot modify. Clearbook still
 * deploys nothing on the source chain; we are simply an ordinary user of an
 * ordinary token, which is exactly what the architecture claims.
 *
 * Staging is deliberately separate from proving. Attestation lags the chain head
 * by roughly eight minutes, so this script broadcasts and records; proving and
 * verification happen afterwards against the recorded hashes.
 *
 *   npx tsx demo/stage-source.ts wrap      # wrap ETH into WETH on the treasury
 *   npx tsx demo/stage-source.ts fund-gas  # send gas to borrower and payer
 *   npx tsx demo/stage-source.ts disburse  # treasury -> borrower (scenario A)
 *   npx tsx demo/stage-source.ts repay-a   # borrower -> treasury (scenario A repayment)
 *   npx tsx demo/stage-source.ts scenario-b# the full circular flow (scenario B)
 *   npx tsx demo/stage-source.ts status    # balances and staged transactions
 */
import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract, JsonRpcProvider, Wallet, formatEther, parseEther } from 'ethers';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'staged');
const LEDGER = join(OUT_DIR, 'source-transactions.json');

/** Canonical Sepolia WETH. Verified live: "Wrapped Ether", 18 decimals. */
const WETH = '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9';

const WETH_ABI = [
  'function deposit() payable',
  'function transfer(address to, uint256 value) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

interface StagedTx {
  role: string;
  scenario: string;
  txHash: string;
  blockNumber: number;
  from: string;
  to: string;
  amountWei: string;
  stagedAt: string;
  note: string;
}

function loadLedger(): StagedTx[] {
  if (!existsSync(LEDGER)) return [];
  return JSON.parse(readFileSync(LEDGER, 'utf8')).transactions ?? [];
}

function saveLedger(transactions: StagedTx[]): void {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    LEDGER,
    JSON.stringify(
      {
        note:
          'Real Sepolia transactions created by us for demonstration. The token is canonical ' +
          'WETH, which we do not control. These describe no real borrower and no real loan.',
        token: WETH,
        transactions,
      },
      null,
      2,
    ),
  );
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set in .env`);
  return v;
}

async function main(): Promise<void> {
  const rpc = required('SOURCE_CHAIN_RPC_URL');
  const provider = new JsonRpcProvider(rpc);

  const treasury = new Wallet(required('DEMO_TREASURY_PRIVATE_KEY'), provider);
  const borrower = new Wallet(required('DEMO_BORROWER_PRIVATE_KEY'), provider);
  const payer = new Wallet(required('DEMO_PAYER_PRIVATE_KEY'), provider);

  const weth = new Contract(WETH, WETH_ABI, treasury);
  const command = process.argv[2] ?? 'status';

  const showBalances = async () => {
    for (const [name, w] of [
      ['treasury', treasury],
      ['borrower', borrower],
      ['payer', payer],
    ] as const) {
      const eth = await provider.getBalance(w.address);
      const wethBal: bigint = await weth.balanceOf(w.address);
      console.log(
        `  ${name.padEnd(9)} ${w.address}  ${formatEther(eth).padStart(10)} ETH  ${formatEther(wethBal).padStart(10)} WETH`,
      );
    }
  };

  console.log(`Source chain RPC: ${rpc}`);
  console.log(`Token: ${await weth.symbol()} at ${WETH}\n`);

  if (command === 'status') {
    console.log('=== balances ===');
    await showBalances();
    const staged = loadLedger();
    console.log(`\n=== staged transactions (${staged.length}) ===`);
    for (const t of staged) {
      console.log(`  ${t.scenario.padEnd(3)} ${t.role.padEnd(12)} block ${t.blockNumber}  ${t.txHash}`);
    }
    if (staged.length === 0) console.log('  (none yet)');
    return;
  }

  if (command === 'wrap') {
    const amount = parseEther(process.argv[3] ?? '0.05');
    console.log(`Wrapping ${formatEther(amount)} ETH into WETH on the treasury…`);
    const tx = await weth.deposit({ value: amount });
    console.log(`  broadcast ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`  confirmed in block ${receipt.blockNumber}`);
    console.log('\n=== balances ===');
    await showBalances();
    return;
  }

  if (command === 'fund-gas') {
    const amount = parseEther(process.argv[3] ?? '0.01');
    for (const [name, w] of [
      ['borrower', borrower],
      ['payer', payer],
    ] as const) {
      const current = await provider.getBalance(w.address);
      if (current >= amount) {
        console.log(`  ${name} already funded (${formatEther(current)} ETH), skipping`);
        continue;
      }
      console.log(`  sending ${formatEther(amount)} ETH to ${name} ${w.address}…`);
      const tx = await treasury.sendTransaction({ to: w.address, value: amount });
      await tx.wait();
      console.log(`    ${tx.hash}`);
    }
    console.log('\n=== balances ===');
    await showBalances();
    return;
  }

  if (command === 'disburse') {
    const amount = parseEther(process.argv[3] ?? '0.01');
    const available: bigint = await weth.balanceOf(treasury.address);
    if (available < amount) {
      throw new Error(
        `treasury holds ${formatEther(available)} WETH, need ${formatEther(amount)}. Run: wrap`,
      );
    }

    console.log(`Disbursing ${formatEther(amount)} WETH: treasury -> borrower`);
    const tx = await weth.transfer(borrower.address, amount);
    console.log(`  broadcast ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`  confirmed in block ${receipt.blockNumber}`);

    const staged = loadLedger();
    staged.push({
      role: 'disbursement',
      scenario: 'A',
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      from: treasury.address,
      to: borrower.address,
      amountWei: amount.toString(),
      stagedAt: new Date().toISOString(),
      note: 'ERC-20 Transfer on canonical Sepolia WETH, created by us. Closes KNOWN_ISSUES K-008.',
    });
    saveLedger(staged);

    console.log(`\n  Recorded to ${LEDGER}`);
    console.log(`\n  Attestation lags the chain head by roughly 8 minutes.`);
    console.log(`  Prove it with:  npx tsx integration/gate2-proof.ts ${tx.hash} 0`);
    return;
  }


  if (command === 'repay-a') {
    // Scenario A: the borrower repays from its own balance. Nothing else funded
    // it, so the only treasury -> borrower transfer is the disbursement itself —
    // which condition 11 excludes. That is what makes A unbreachable.
    const amount = parseEther(process.argv[3] ?? '0.01');
    const borrowerWeth = new Contract(WETH, WETH_ABI, borrower);
    const held: bigint = await borrowerWeth.balanceOf(borrower.address);
    if (held < amount) {
      throw new Error(`borrower holds ${formatEther(held)} WETH, need ${formatEther(amount)}. Run: disburse`);
    }

    console.log(`Repaying ${formatEther(amount)} WETH: borrower -> treasury`);
    const tx = await borrowerWeth.transfer(treasury.address, amount);
    console.log(`  broadcast ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`  confirmed in block ${receipt.blockNumber}`);

    const staged = loadLedger();
    staged.push({
      role: 'repayment',
      scenario: 'A',
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      from: borrower.address,
      to: treasury.address,
      amountWei: amount.toString(),
      stagedAt: new Date().toISOString(),
      note: 'Honest repayment. The borrower was never separately funded by a bound treasury.',
    });
    saveLedger(staged);
    console.log(`\n  Recorded. Prove with: npx tsx integration/gate2-proof.ts ${tx.hash} 0`);
    return;
  }

  if (command === 'scenario-b') {
    // Scenario B: the prohibited circular flow.
    //   1. treasury -> payer   (disbursement of loan B)
    //   2. treasury -> payer   (the funding leg — a SECOND, distinct transfer)
    //   3. payer    -> treasury (the repayment)
    // Step 2 must be distinct from step 1, because condition 11 excludes a loan's
    // own disbursement from serving as the funding leg.
    const amount = parseEther(process.argv[3] ?? '0.01');
    const payerWeth = new Contract(WETH, WETH_ABI, payer);
    const staged = loadLedger();

    const legs: Array<[string, string, () => Promise<{ hash: string }>, string, string, string]> = [
      ['disbursement', 'treasury -> payer (disbursement)', () => weth.transfer(payer.address, amount), treasury.address, payer.address, 'Loan B disbursement.'],
      ['funding', 'treasury -> payer (funding leg)', () => weth.transfer(payer.address, amount), treasury.address, payer.address, 'The funding leg. Distinct from the disbursement, which condition 11 excludes.'],
      ['repayment', 'payer -> treasury (repayment)', () => payerWeth.transfer(treasury.address, amount), payer.address, treasury.address, 'Repayment sourced from money the treasury itself sent.'],
    ];

    for (const [role, label, send, from, to, note] of legs) {
      console.log(`${label}…`);
      const tx = await send();
      console.log(`  broadcast ${tx.hash}`);
      const receipt = await (tx as never as { wait: () => Promise<{ blockNumber: number }> }).wait();
      console.log(`  confirmed in block ${receipt.blockNumber}`);
      staged.push({
        role,
        scenario: 'B',
        txHash: tx.hash,
        blockNumber: receipt.blockNumber,
        from,
        to,
        amountWei: amount.toString(),
        stagedAt: new Date().toISOString(),
        note,
      });
      saveLedger(staged);
    }

    console.log('\n  All three legs of scenario B are staged and recorded.');
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

main().catch((e) => {
  console.error(`\nFAILED: ${(e as Error).message}`);
  process.exitCode = 1;
});
