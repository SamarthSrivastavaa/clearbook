/**
 * Runs the reference challenger on its own.
 *
 * The same class the worker uses (`worker/src/enforce.ts`), driven directly so
 * enforcement can be demonstrated without Postgres or the ingestion pipeline.
 * That separation is the point: the challenger needs nothing from Clearbook's
 * infrastructure. It needs an RPC endpoint, two addresses, and gas.
 *
 *   npm run challenger          # one sweep, then exit
 *   npm run challenger -- watch # sweep every 15s until interrupted
 */
import 'dotenv/config';
import { JsonRpcProvider } from 'ethers';

import { ReferenceChallenger } from '../worker/src/enforce.js';

const strip = (v?: string) => (v ?? '').replace(/^['"]|['"]$/g, '');

const RPC = strip(process.env.CREDITCOIN_RPC_URL);
const CLEARBOOK = strip(process.env.CLEARBOOK_ADDRESS);
const VAULT = strip(process.env.EVIDENCE_VAULT_ADDRESS);
const KEY = strip(process.env.CHALLENGER_PRIVATE_KEY);

const SWEEP_INTERVAL_MS = 15_000;

async function main(): Promise<void> {
  if (!RPC || !CLEARBOOK || !VAULT) throw new Error('CREDITCOIN_RPC_URL, CLEARBOOK_ADDRESS and EVIDENCE_VAULT_ADDRESS must be set');
  if (!KEY) throw new Error('CHALLENGER_PRIVATE_KEY is not set');

  const cc = new JsonRpcProvider(RPC);
  const challenger = new ReferenceChallenger(cc, KEY, CLEARBOOK, VAULT);
  const balance = await cc.getBalance(challenger.address);

  console.log('\nReference challenger');
  console.log(`  address   ${challenger.address}`);
  console.log(`  gas       ${balance} wei`);
  console.log('  privilege none - this is an ordinary account calling a public function\n');

  const watch = process.argv.includes('watch');

  for (;;) {
    const started = Date.now();
    const outcomes = await challenger.sweep();

    for (const o of outcomes) {
      switch (o.kind) {
        case 'confirmed':
          console.log(`  CHALLENGE CONFIRMED  loan ${o.loanId}  bounty ${o.bounty} wei  tx ${o.ccTxHash}`);
          console.log(`  detected ${o.detectionLagBlocks} Creditcoin blocks after the evidence was stored`);
          console.log(
            o.shape === 'third-party'
              ? '  shape: a third party the treasury funded repaid this loan'
              : '  shape: the borrower repaid, and the treasury had also funded it (honest re-lending looks the same)',
          );
          break;
        case 'declined-strict':
          console.log(`  DECLINED (strict)    loan ${o.loanId}  fact ${o.fundingFactId}`);
          break;
        case 'simulation-reverted':
          console.log(`  SIMULATION REVERTED  loan ${o.loanId}  ${o.reason.slice(0, 120)}`);
          break;
        case 'lost-race':
          console.log(`  LOST RACE            loan ${o.loanId}  ${o.reason.slice(0, 120)}`);
          break;
      }
    }
    if (outcomes.length === 0) console.log(`  sweep complete - nothing actionable (${Date.now() - started}ms)`);

    if (!watch) return;
    await new Promise((r) => setTimeout(r, SWEEP_INTERVAL_MS));
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
