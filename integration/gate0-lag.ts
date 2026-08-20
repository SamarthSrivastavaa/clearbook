/**
 * GATE 0 follow-up — attestation LAG and long-window ADVANCE measurement.
 *
 * Gate 0 showed chainKey 1 (Sepolia) flat over a single 60s sample while
 * chainKey 3 (Ethereum Mainnet) advanced. A single sample cannot distinguish
 * "stalled" from "attested in batches". This script measures, per supported chain:
 *
 *   - the source chain's current head (from a source-chain RPC, where configured)
 *   - the latest attested height on Creditcoin
 *   - the lag between them
 *   - whether the attested height advances over a longer observation window
 *
 * No chain key is hardcoded.
 */
import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonRpcProvider } from 'ethers';
import { asSdkProvider } from './lib/provider.js';
import { chainInfo } from '@gluwa/usc-sdk';

const RESULTS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'results');

const SAMPLES = Number(process.env.LAG_SAMPLES ?? 7);
const INTERVAL_MS = Number(process.env.LAG_INTERVAL_MS ?? 60_000);

/** Source-chain RPCs by chainId, used only to read the current head for lag measurement. */
function sourceRpcForChainId(chainId: number): string | null {
  if (chainId === 11155111) return process.env.SOURCE_CHAIN_RPC_URL || null;
  return null;
}

interface Sample {
  at: string;
  attestedHeight: number | null;
  exists: boolean;
  sourceHead: number | null;
  lag: number | null;
}

async function main(): Promise<void> {
  const rpcUrl = process.env.CREDITCOIN_RPC_URL;
  if (!rpcUrl) throw new Error('CREDITCOIN_RPC_URL is not set');

  const cc = new JsonRpcProvider(rpcUrl);
  const info = new chainInfo.PrecompileChainInfoProvider(asSdkProvider(cc));
  const chains = await info.getSupportedChains();

  console.log(`Observing ${chains.length} chains, ${SAMPLES} samples, ${INTERVAL_MS / 1000}s apart`);
  console.log(`(total observation window ~${((SAMPLES - 1) * INTERVAL_MS) / 60000} minutes)\n`);

  const sourceProviders = new Map<number, JsonRpcProvider>();
  for (const c of chains) {
    const url = sourceRpcForChainId(c.chainId);
    if (url) sourceProviders.set(c.chainKey, new JsonRpcProvider(url));
  }

  const series = new Map<number, Sample[]>();
  for (const c of chains) series.set(c.chainKey, []);

  for (let i = 0; i < SAMPLES; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, INTERVAL_MS));
    const at = new Date().toISOString();

    for (const c of chains) {
      let attestedHeight: number | null = null;
      let exists = false;
      try {
        const h = await info.getLatestAttestedHeightAndHash(c.chainKey);
        exists = h.exists;
        attestedHeight = h.exists ? h.height : null;
      } catch (e: any) {
        console.log(`  chainKey=${c.chainKey} attested query failed: ${e?.message ?? e}`);
      }

      let sourceHead: number | null = null;
      const sp = sourceProviders.get(c.chainKey);
      if (sp) {
        try {
          sourceHead = await sp.getBlockNumber();
        } catch (e: any) {
          console.log(`  chainKey=${c.chainKey} source head query failed: ${e?.message ?? e}`);
        }
      }

      const lag = attestedHeight != null && sourceHead != null ? sourceHead - attestedHeight : null;
      series.get(c.chainKey)!.push({ at, attestedHeight, exists, sourceHead, lag });

      console.log(
        `[${i + 1}/${SAMPLES}] chainKey=${c.chainKey} chainId=${c.chainId}  ` +
          `attested=${attestedHeight}  sourceHead=${sourceHead ?? 'n/a'}  lag=${lag ?? 'n/a'}`,
      );
    }
    console.log('');
  }

  console.log('--- SUMMARY ---');
  const summary = chains.map((c) => {
    const s = series.get(c.chainKey)!;
    const heights = s.map((x) => x.attestedHeight).filter((x): x is number => x != null);
    const first = heights[0] ?? null;
    const last = heights[heights.length - 1] ?? null;
    const totalAdvance = first != null && last != null ? last - first : null;
    const lags = s.map((x) => x.lag).filter((x): x is number => x != null);
    const row = {
      chainKey: c.chainKey,
      chainId: c.chainId,
      firstAttested: first,
      lastAttested: last,
      totalAdvance,
      advancing: totalAdvance != null && totalAdvance > 0,
      lagFirst: lags[0] ?? null,
      lagLast: lags[lags.length - 1] ?? null,
      samples: s,
    };
    console.log(
      `chainKey=${c.chainKey} chainId=${c.chainId}  ${first} -> ${last}  ` +
        `advance=${totalAdvance}  ${row.advancing ? 'ADVANCING' : 'NOT ADVANCING'}  ` +
        `lag ${row.lagFirst ?? 'n/a'} -> ${row.lagLast ?? 'n/a'}`,
    );
    return row;
  });

  mkdirSync(RESULTS_DIR, { recursive: true });
  const file = join(RESULTS_DIR, `gate0-lag-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      { observedAt: new Date().toISOString(), samples: SAMPLES, intervalMs: INTERVAL_MS, chains: summary },
      null,
      2,
    ),
  );
  console.log(`\nResult written to ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
