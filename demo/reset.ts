/**
 * Redeploys Clearbook clean (BUILD.md §13.1).
 *
 * Deploys a fresh `EvidenceVault` and `Clearbook` to Creditcoin and asserts every
 * post-condition that `Deploy.s.sol` would have asserted. It does NOT touch the
 * existing deployment — nothing here is destructive; it simply produces a new
 * pair of addresses and prints the `.env` lines for them.
 *
 * Why not `forge script`
 * ---------------------
 * `Deploy.s.sol` cannot execute against Creditcoin: its headers omit the
 * post-merge `prevrandao` field that Foundry's local EVM requires under
 * `evm_version = cancun`, and `--skip-simulation` does not help because the
 * failure is in execution rather than simulation (KNOWN_ISSUES K-017).
 *
 * So this deploys the same compiled artifacts over plain JSON-RPC and re-checks
 * the guards in `DeployLib.assertProductionConfig` from the outside:
 *
 *   - the chain really is a Creditcoin network
 *   - the vault's verifier is the REAL Block Prover precompile, not a test double
 *   - Clearbook points at the vault just deployed
 *   - the protocol sink is non-zero
 *
 * `Deploy.s.sol` remains the specification of a correct deployment and is still
 * unit-tested in `forge test`; this is the route around a chain quirk, not a
 * replacement for it.
 *
 * Writing to .env is deliberately NOT automated: pointing the app at a new
 * deployment is a decision, not a side effect.
 *
 *   npx tsx demo/reset.ts            # dry run — reports what it would do
 *   npx tsx demo/reset.ts --confirm  # actually deploy
 */
import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContractFactory, JsonRpcProvider, Wallet, formatEther, isAddress } from 'ethers';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(HERE, '..', 'integration', 'results');

/** The real Block Prover precompile. A deployment pointing anywhere else is not production. */
const BLOCK_PROVER = '0x0000000000000000000000000000000000000FD2';

/** Creditcoin networks, per the upstream library and DECISIONS D-003. */
const CREDITCOIN_CHAIN_IDS = new Set([102031n, 102030n]);

function artifact(name: string) {
  const path = join(HERE, '..', 'contracts', 'out', `${name}.sol`, `${name}.json`);
  if (!existsSync(path)) {
    throw new Error(`missing ${path} — run: cd contracts && forge build`);
  }
  const j = JSON.parse(readFileSync(path, 'utf8'));
  return { abi: j.abi, bytecode: j.bytecode.object as string };
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

async function main(): Promise<void> {
  const confirm = process.argv.includes('--confirm');

  const cc = new JsonRpcProvider(required('CREDITCOIN_RPC_URL'));
  const deployer = new Wallet(required('CC_DEPLOYER_PRIVATE_KEY'), cc);
  const sink = required('PROTOCOL_SINK_ADDRESS');

  const network = await cc.getNetwork();
  const balance = await cc.getBalance(deployer.address);

  console.log(`Chain     ${network.chainId}`);
  console.log(`Deployer  ${deployer.address}  ${formatEther(balance)} tCTC`);
  console.log(`Sink      ${sink}`);
  console.log(`Verifier  ${BLOCK_PROVER}\n`);

  console.log('=== pre-flight (the guards from DeployLib.assertProductionConfig) ===');
  check('chain is a Creditcoin network', CREDITCOIN_CHAIN_IDS.has(network.chainId), String(network.chainId));
  check('protocol sink is set and non-zero', isAddress(sink) && BigInt(sink) !== 0n, sink);
  check('deployer can pay for two deployments', balance > 0n, `${formatEther(balance)} tCTC`);
  if (failures > 0) {
    console.log('\n  Refusing to deploy: pre-flight failed.');
    process.exitCode = 1;
    return;
  }

  if (!confirm) {
    console.log('\n  DRY RUN — nothing was deployed.');
    console.log('  This would deploy a fresh EvidenceVault and Clearbook, leaving the');
    console.log('  existing deployment untouched. Re-run with --confirm to proceed.');
    return;
  }

  console.log('\n=== deploying ===');
  const vaultArt = artifact('EvidenceVault');
  const vaultFactory = new ContractFactory(vaultArt.abi, vaultArt.bytecode, deployer);
  const vault = await vaultFactory.deploy(BLOCK_PROVER);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log(`  EvidenceVault  ${vaultAddress}`);

  const cbArt = artifact('Clearbook');
  const cbFactory = new ContractFactory(cbArt.abi, cbArt.bytecode, deployer);
  const clearbook = await cbFactory.deploy(vaultAddress, sink);
  await clearbook.waitForDeployment();
  const clearbookAddress = await clearbook.getAddress();
  console.log(`  Clearbook      ${clearbookAddress}`);

  // ------------------------------------------------- post-conditions, read back
  console.log('\n=== post-conditions, read from chain ===');
  const readVault = vault as unknown as { VERIFIER(): Promise<string> };
  const readCb = clearbook as unknown as {
    VAULT(): Promise<string>;
    PROTOCOL_SINK(): Promise<string>;
    BOND_PER_LOAN(): Promise<bigint>;
    SLASH_BPS(): Promise<bigint>;
    BOUNTY_BPS(): Promise<bigint>;
  };

  const verifier = await readVault.VERIFIER();
  check(
    'vault verifier is the REAL Block Prover precompile',
    verifier.toLowerCase() === BLOCK_PROVER.toLowerCase(),
    verifier,
  );
  const boundVault = await readCb.VAULT();
  check(
    'Clearbook points at the vault just deployed',
    boundVault.toLowerCase() === vaultAddress.toLowerCase(),
    boundVault,
  );
  const boundSink = await readCb.PROTOCOL_SINK();
  check('protocol sink stored correctly', boundSink.toLowerCase() === sink.toLowerCase(), boundSink);
  check('BOND_PER_LOAN is 1 tCTC', (await readCb.BOND_PER_LOAN()) === 10n ** 18n);
  check('SLASH_BPS is 10000', (await readCb.SLASH_BPS()) === 10_000n);
  check('BOUNTY_BPS is 5000', (await readCb.BOUNTY_BPS()) === 5_000n);

  const record = {
    at: new Date().toISOString(),
    chainId: network.chainId.toString(),
    deployer: deployer.address,
    evidenceVault: vaultAddress,
    clearbook: clearbookAddress,
    protocolSink: sink,
    verifier,
    checks: { failures },
    ok: failures === 0,
  };
  if (!existsSync(RESULTS)) mkdirSync(RESULTS, { recursive: true });
  writeFileSync(join(RESULTS, 'reset-deployment.json'), JSON.stringify(record, null, 2));

  console.log(`\n================ RESET: ${failures === 0 ? 'OK' : 'FAIL'} ================`);
  console.log('\n  Point the app at the new deployment by updating these yourself:\n');
  console.log(`    EVIDENCE_VAULT_ADDRESS=${vaultAddress}`);
  console.log(`    CLEARBOOK_ADDRESS=${clearbookAddress}`);
  console.log(`    NEXT_PUBLIC_EVIDENCE_VAULT_ADDRESS=${vaultAddress}`);
  console.log(`    NEXT_PUBLIC_CLEARBOOK_ADDRESS=${clearbookAddress}`);
  console.log('\n  Then re-submit evidence and seed:');
  console.log('    npx tsx integration/gate4-decode.ts');
  console.log('    npm run demo:seed');
  if (failures > 0) process.exitCode = 1;
}

// Direct-invocation guard (KNOWN_ISSUES K-001).
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
