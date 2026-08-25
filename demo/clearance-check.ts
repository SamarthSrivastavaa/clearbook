/**
 * Clearance rehearsal.
 *
 * Runs the exact function the /clearance page runs, from the terminal, against
 * whatever transactions you name. Its purpose is Phase 19: never open a demo on
 * a transaction whose answer you have not already seen.
 *
 * The proof step goes through the Next.js proxy at /api/prover, which is a
 * relative path in the browser and therefore unaddressable from Node. Point
 * PROVER_ORIGIN at a running instance so this exercises the real path rather
 * than reporting a prover failure that is really an addressing failure:
 *
 *   # against a local production build
 *   npx next start -p 3123          # in frontend/
 *   PROVER_ORIGIN=http://localhost:3123 npx tsx demo/clearance-check.ts
 *
 *   # against the deployed site
 *   PROVER_ORIGIN=https://clearbook-sable.vercel.app npx tsx demo/clearance-check.ts 0xabc…
 *
 * With no arguments it checks every distinct transaction in the staged fact set,
 * which is the set the demo is driven from.
 */
import { config as loadEnv } from 'dotenv';
loadEnv();
loadEnv({ path: 'frontend/.env.local' });

import { readFileSync } from 'node:fs';

// Dynamic: ESM hoists static imports above loadEnv(), so config would read its
// NEXT_PUBLIC_* values before the env files were on process.env.
const { checkClearance } = await import('../frontend/lib/clearance.js');
const { SOURCE_CHAINS } = await import('../frontend/lib/config.js');

if (!process.env.PROVER_ORIGIN) {
  console.log(
    '\n  note  PROVER_ORIGIN is not set. The proof step will report the prover as\n' +
      '        unavailable because /api/prover has no origin to be relative to.\n' +
      '        That is an addressing failure, not a prover failure.\n',
  );
}

interface StagedFact {
  scenario: string;
  role: string;
  txHash: string;
  chainKey: number;
}

const args = process.argv.slice(2).filter((a) => /^0x[0-9a-fA-F]{64}$/.test(a));
const chainKeyArg = Number(
  process.argv.slice(2).find((a) => /^--chain-key=\d+$/.test(a))?.split('=')[1] ?? '1',
);

let targets: StagedFact[];
if (args.length > 0) {
  targets = args.map((txHash, i) => ({
    scenario: `arg ${i + 1}`,
    role: 'supplied',
    txHash,
    chainKey: chainKeyArg,
  }));
} else {
  const staged = JSON.parse(readFileSync('demo/staged/proven-facts.json', 'utf8')) as {
    facts: StagedFact[];
  };
  const seen = new Set<string>();
  targets = staged.facts.filter((f) => {
    if (seen.has(f.txHash)) return false;
    seen.add(f.txHash);
    return true;
  });
}

const tally = { clear: 0, encumbered: 0, unverifiable: 0 };

for (const f of targets) {
  const chain = SOURCE_CHAINS[f.chainKey];
  if (!chain) {
    console.log(`\n  skip  chain key ${f.chainKey} is not a configured source chain`);
    continue;
  }

  console.log(`\n=== ${f.scenario} · ${f.role} · ${f.txHash.slice(0, 22)}… · ${chain.name} ===`);
  const r = await checkClearance(chain, f.txHash, (step, detail) => {
    if (detail) console.log(`   ${step.padEnd(9)} ${detail}`);
  });

  tally[r.outcome]++;
  console.log(`   OUTCOME  ${r.outcome.toUpperCase()}${r.reason ? `  (${r.reason})` : ''}`);
  if (r.detail) console.log(`   detail   ${r.detail}`);
  for (const leg of r.legs) {
    console.log(
      `   leg ${leg.logIndex}    fact ${leg.factId.slice(0, 18)}…  ` +
        `inRegistry=${leg.inRegistry}  consumedBy=${leg.consumedBy ?? 'none'}`,
    );
  }
}

console.log(
  `\n${targets.length} checked · ${tally.clear} clear · ${tally.encumbered} encumbered · ` +
    `${tally.unverifiable} unverifiable\n`,
);
