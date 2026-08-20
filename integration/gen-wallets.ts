/**
 * Generates the throwaway wallets BUILD.md §10 lists, writes their private keys
 * into .env (which is gitignored), and prints ONLY the public addresses.
 *
 * Testnet only. These keys must never hold anything of value.
 * Re-running does not overwrite a key that is already set.
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Wallet } from 'ethers';

const ENV_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '.env');

const KEYS = [
  { name: 'CC_DEPLOYER_PRIVATE_KEY', network: 'Creditcoin CC3', purpose: 'deploys EvidenceVault + Clearbook' },
  { name: 'CC_WORKER_PRIVATE_KEY', network: 'Creditcoin CC3', purpose: 'submits proof bundles to the vault' },
  { name: 'DEMO_TREASURY_PRIVATE_KEY', network: 'Sepolia', purpose: 'originator treasury (bound by signature)' },
  { name: 'DEMO_BORROWER_PRIVATE_KEY', network: 'Sepolia', purpose: 'borrower — honest scenario A' },
  { name: 'DEMO_PAYER_PRIVATE_KEY', network: 'Sepolia', purpose: 'payer — circular scenario B' },
] as const;

function main(): void {
  if (!existsSync(ENV_PATH)) throw new Error('.env not found — copy .env.example to .env first');
  let env = readFileSync(ENV_PATH, 'utf8');

  const rows: Array<{ name: string; network: string; purpose: string; address: string; created: boolean }> = [];

  for (const k of KEYS) {
    const existing = process.env[k.name];
    if (existing && existing.length > 0) {
      rows.push({ ...k, address: new Wallet(existing).address, created: false });
      continue;
    }
    const w = Wallet.createRandom();
    // Replace the empty assignment in place; never append a duplicate.
    const re = new RegExp(`^${k.name}=""$`, 'm');
    if (!re.test(env)) throw new Error(`${k.name}="" not found in .env — cannot write key safely`);
    env = env.replace(re, `${k.name}="${w.privateKey}"`);
    rows.push({ ...k, address: w.address, created: true });
  }

  writeFileSync(ENV_PATH, env);

  console.log('\nThrowaway wallets (TESTNET ONLY). Private keys are in .env, which is gitignored.\n');
  for (const network of ['Creditcoin CC3', 'Sepolia']) {
    console.log(`--- ${network} ---`);
    for (const r of rows.filter((x) => x.network === network)) {
      console.log(`  ${r.address}   ${r.name.replace('_PRIVATE_KEY', '').toLowerCase()}`);
      console.log(`      ${r.purpose}${r.created ? '' : '   (already existed, reused)'}`);
    }
    console.log('');
  }
  console.log('Never send anything of real value to these addresses.');
}

main();
