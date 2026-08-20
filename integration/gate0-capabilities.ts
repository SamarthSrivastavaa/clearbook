/**
 * GATE 0 — Protocol capability discovery (BUILD.md §11, PHASE 0).
 *
 * Pass criteria (BUILD.md):
 *   1. getSupportedChains() returns a non-empty list
 *   2. at least one chain reports exists: true
 *   3. the reported attested height ADVANCES on a second run 60 seconds later
 *      (proving attestors are live *now*, not merely configured)
 *
 * This script hardcodes NO chain key. Every chain key is resolved at runtime
 * from the ChainInfo precompile at 0x...0FD3.
 */
import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonRpcProvider } from 'ethers';
import { chainInfo } from '@gluwa/usc-sdk';

const RESULTS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'results');

/**
 * chainId -> human name, from the public EIP-155 chain registry.
 * Used ONLY for display, because the SDK's getSupportedChains() carries an
 * upstream TODO: "Name decoding seems to be failing (you get all zeros currently)".
 * The raw on-chain chainName is always reported alongside this.
 */
const EIP155_NAMES: Record<number, string> = {
  1: 'Ethereum Mainnet',
  11155111: 'Ethereum Sepolia',
  56: 'BNB Smart Chain',
  137: 'Polygon',
  102030: 'Creditcoin Mainnet',
  102031: 'Creditcoin Testnet (CC3)',
  102032: 'Creditcoin Devnet',
};

interface ChainSample {
  chainKey: number;
  chainId: number;
  chainNameRaw: string;
  chainEncoding: number;
  eip155Name: string;
  genesisHeight: number | null;
  attestedExists: boolean;
  attestedHeight: number | null;
  attestedHash: string | null;
  isAttestation: boolean | null;
  error?: string;
}

async function sampleChains(info: chainInfo.PrecompileChainInfoProvider): Promise<ChainSample[]> {
  const chains = await info.getSupportedChains();
  const out: ChainSample[] = [];

  for (const c of chains) {
    const sample: ChainSample = {
      chainKey: c.chainKey,
      chainId: c.chainId,
      chainNameRaw: String(c.chainName),
      chainEncoding: c.chainEncoding,
      eip155Name: EIP155_NAMES[c.chainId] ?? `UNKNOWN chainId ${c.chainId}`,
      genesisHeight: null,
      attestedExists: false,
      attestedHeight: null,
      attestedHash: null,
      isAttestation: null,
    };

    try {
      sample.genesisHeight = await info.getAttestationGenesisHeight(c.chainKey);
    } catch (e: any) {
      sample.error = `getAttestationGenesisHeight: ${e?.message ?? e}`;
    }

    try {
      const h = await info.getLatestAttestedHeightAndHash(c.chainKey);
      sample.attestedExists = h.exists;
      sample.attestedHeight = h.exists ? h.height : null;
      sample.attestedHash = h.exists ? h.hash : null;
      sample.isAttestation = h.exists ? h.isAttestation : null;
    } catch (e: any) {
      sample.error = `${sample.error ? sample.error + '; ' : ''}getLatestAttestedHeightAndHash: ${e?.message ?? e}`;
    }

    out.push(sample);
  }

  return out;
}

function printTable(label: string, samples: ChainSample[]): void {
  console.log(`\n--- ${label} ---`);
  for (const s of samples) {
    console.log(
      [
        `chainKey=${s.chainKey}`,
        `chainId=${s.chainId}`,
        `name=${s.eip155Name}`,
        `encoding=${s.chainEncoding}`,
        `genesis=${s.genesisHeight}`,
        `attested.exists=${s.attestedExists}`,
        `attested.height=${s.attestedHeight}`,
      ].join('  '),
    );
    if (s.error) console.log(`    ERROR: ${s.error}`);
  }
}

async function main(): Promise<void> {
  const rpcUrl = process.env.CREDITCOIN_RPC_URL;
  if (!rpcUrl) throw new Error('CREDITCOIN_RPC_URL is not set (copy .env.example to .env)');

  const startedAt = new Date().toISOString();
  console.log(`GATE 0 — capability discovery`);
  console.log(`Creditcoin RPC: ${rpcUrl}`);

  const cc = new JsonRpcProvider(rpcUrl);

  // --- Creditcoin network identity, discovered (never assumed) ---
  const network = await cc.getNetwork();
  const ccChainId = Number(network.chainId);
  const ccBlockNumber = await cc.getBlockNumber();
  console.log(`Creditcoin chainId: ${ccChainId} (${EIP155_NAMES[ccChainId] ?? 'UNKNOWN'})`);
  console.log(`Creditcoin block number: ${ccBlockNumber}`);

  const info = new chainInfo.PrecompileChainInfoProvider(cc);
  console.log(`ChainInfo precompile: ${chainInfo.CHAIN_INFO_PRECOMPILE_ADDRESS}`);

  // --- Run 1 ---
  const run1At = new Date().toISOString();
  const run1 = await sampleChains(info);
  printTable(`RUN 1  (${run1At})`, run1);

  // --- Criterion 1 & 2 ---
  const nonEmpty = run1.length > 0;
  const anyAttested = run1.some((s) => s.attestedExists);
  console.log(`\ncriterion 1 (non-empty chain list): ${nonEmpty ? 'PASS' : 'FAIL'} (${run1.length} chains)`);
  console.log(`criterion 2 (>=1 chain attesting):  ${anyAttested ? 'PASS' : 'FAIL'}`);

  // --- Run 2, 60s later: criterion 3 ---
  const WAIT_MS = 60_000;
  console.log(`\nWaiting ${WAIT_MS / 1000}s before run 2 to test whether attestation is ADVANCING...`);
  await new Promise((r) => setTimeout(r, WAIT_MS));

  const run2At = new Date().toISOString();
  const run2 = await sampleChains(info);
  printTable(`RUN 2  (${run2At})`, run2);

  console.log(`\n--- ADVANCE CHECK (60s apart) ---`);
  const advanced: number[] = [];
  for (const a of run1) {
    const b = run2.find((x) => x.chainKey === a.chainKey);
    if (!b) continue;
    if (a.attestedHeight == null || b.attestedHeight == null) {
      console.log(`chainKey=${a.chainKey}  no attested height in one/both runs -> NOT ADVANCING`);
      continue;
    }
    const delta = b.attestedHeight - a.attestedHeight;
    const ok = delta > 0;
    if (ok) advanced.push(a.chainKey);
    // A zero delta over 60s does NOT prove a stall: attestation is granted in
    // batches (~10 blocks every ~2 min), so a healthy chain can read flat here.
    // Escalate to integration/gate0-lag.ts before condemning any chain.
    console.log(
      `chainKey=${a.chainKey} (chainId=${a.chainId}, ${a.eip155Name})  ` +
        `${a.attestedHeight} -> ${b.attestedHeight}  delta=+${delta}  ` +
        `${ok ? 'ADVANCING' : 'INCONCLUSIVE (flat over 60s - run gate0-lag.ts before concluding)'}`,
    );
  }
  const advancing = advanced.length > 0;
  console.log(`\ncriterion 3 (attestation advancing): ${advancing ? 'PASS' : 'FAIL'}`);
  if (advanced.length < run1.length) {
    console.log(
      `NOTE: ${run1.length - advanced.length} chain(s) read flat over this 60s window. ` +
        `That is expected under batched attestation. Run: npx tsx integration/gate0-lag.ts`,
    );
  }

  const pass = nonEmpty && anyAttested && advancing;
  console.log(`\n================ GATE 0: ${pass ? 'PASS' : 'FAIL'} ================`);
  if (pass) {
    console.log(`Advancing chain keys: ${advanced.join(', ')}`);
    console.log(`Set SOURCE_CHAIN_KEY in .env to one of the advancing keys above.`);
  }

  const result = {
    gate: 'GATE 0 — capability discovery',
    pass,
    startedAt,
    finishedAt: new Date().toISOString(),
    creditcoin: { rpcUrl, chainId: ccChainId, blockNumber: ccBlockNumber },
    chainInfoPrecompile: chainInfo.CHAIN_INFO_PRECOMPILE_ADDRESS,
    criteria: {
      nonEmptyChainList: nonEmpty,
      atLeastOneAttesting: anyAttested,
      attestationAdvancing: advancing,
    },
    advancingChainKeys: advanced,
    run1: { at: run1At, chains: run1 },
    run2: { at: run2At, chains: run2 },
  };

  mkdirSync(RESULTS_DIR, { recursive: true });
  const file = join(RESULTS_DIR, `gate0-${startedAt.replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(result, null, 2));
  console.log(`\nResult written to ${file}`);

  if (!pass) process.exitCode = 1;
}

main().catch((e) => {
  console.error('GATE 0 FAILED WITH EXCEPTION:');
  console.error(e);
  process.exitCode = 1;
});
