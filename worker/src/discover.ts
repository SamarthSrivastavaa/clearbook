/**
 * Chain discovery (BUILD.md §8.1).
 *
 * Resolves supported source chains at runtime from the ChainInfo precompile.
 * FATAL AT STARTUP if discovery fails — it never falls back to a hardcoded chain
 * key. A hardcoded key is how you end up proving a Sepolia transfer and presenting
 * it as mainnet (threat T5).
 */
import { JsonRpcProvider } from 'ethers';
import { chainInfo } from '@gluwa/usc-sdk';

import { log } from './log.js';
import { asSdkProvider } from './provider.js';

export interface DiscoveredChain {
  chainKey: number;
  chainId: number;
  chainEncoding: number;
  /** Raw on-chain value. Upstream currently returns zeros — never branch on it. */
  chainNameRaw: string;
}

export class ChainDiscoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChainDiscoveryError';
  }
}

export async function discoverChains(cc: JsonRpcProvider): Promise<DiscoveredChain[]> {
  const info = new chainInfo.PrecompileChainInfoProvider(asSdkProvider(cc));
  let chains;
  try {
    chains = await info.getSupportedChains();
  } catch (e: unknown) {
    throw new ChainDiscoveryError(`getSupportedChains failed: ${(e as Error).message ?? e}`);
  }

  if (!chains || chains.length === 0) {
    throw new ChainDiscoveryError('ChainInfo precompile returned no supported chains');
  }

  const out = chains.map((c) => ({
    chainKey: c.chainKey,
    chainId: c.chainId,
    chainEncoding: c.chainEncoding,
    chainNameRaw: String(c.chainName),
  }));

  log.info('chains discovered', { count: out.length, chains: out.map((c) => `key=${c.chainKey}/id=${c.chainId}`) });
  return out;
}

/**
 * Resolves the chain key for a chainId. Keys off the numeric chainId because the
 * SDK's chainName decoding is broken upstream (returns zeros).
 */
export async function resolveChainKey(cc: JsonRpcProvider, chainId: number): Promise<DiscoveredChain> {
  const chains = await discoverChains(cc);
  const match = chains.find((c) => c.chainId === chainId);
  if (!match) {
    throw new ChainDiscoveryError(
      `chainId ${chainId} is not supported. Supported: ${chains.map((c) => `key=${c.chainKey}/id=${c.chainId}`).join(', ')}`,
    );
  }
  return match;
}

/** Latest attested height for a chain, plus whether any attestation exists. */
export async function latestAttestedHeight(
  cc: JsonRpcProvider,
  chainKey: number,
): Promise<{ height: number; exists: boolean }> {
  const info = new chainInfo.PrecompileChainInfoProvider(asSdkProvider(cc));
  const h = await info.getLatestAttestedHeightAndHash(chainKey);
  return { height: h.exists ? h.height : 0, exists: h.exists };
}
