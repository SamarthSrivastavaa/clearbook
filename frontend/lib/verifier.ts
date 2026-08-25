import { createPublicClient, http, type Hex } from 'viem';

import { PRECOMPILES, SOURCE_CHAIN, SOURCE_CHAINS, creditcoin, sourceChain } from './config';

/**
 * Direct reads against the Block Prover precompile and the source chain.
 *
 * The `verify()` overload is a view, so a browser can call it with no wallet and
 * no gas. That is what makes judge mode possible: anyone can paste a transaction
 * hash and watch the precompile answer.
 */

/** Only the single-query view. The batch overload is not used from the browser. */
export const blockProverAbi = [
  {
    type: 'function',
    name: 'verify',
    stateMutability: 'view',
    inputs: [
      { name: 'chainKey', type: 'uint64' },
      { name: 'height', type: 'uint64' },
      { name: 'encodedTransaction', type: 'bytes' },
      {
        name: 'merkleProof',
        type: 'tuple',
        components: [
          { name: 'root', type: 'bytes32' },
          {
            name: 'siblings',
            type: 'tuple[]',
            components: [
              { name: 'hash', type: 'bytes32' },
              { name: 'isLeft', type: 'bool' },
            ],
          },
        ],
      },
      {
        name: 'continuityProof',
        type: 'tuple',
        components: [
          { name: 'lowerEndpointDigest', type: 'bytes32' },
          { name: 'roots', type: 'bytes32[]' },
        ],
      },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const;

/** ChainInfo precompile: only what judge mode needs. */
export const chainInfoAbi = [
  {
    type: 'function',
    name: 'get_supported_chains',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      {
        type: 'tuple[]',
        components: [
          { name: 'chainKey', type: 'uint64' },
          { name: 'chainId', type: 'uint64' },
          { name: 'chainName', type: 'bytes' },
          { name: 'chainEncoding', type: 'uint32' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'get_attestation_bounds',
    stateMutability: 'view',
    inputs: [
      { name: 'chainKey', type: 'uint64' },
      { name: 'height', type: 'uint64' },
    ],
    outputs: [
      { name: 'parentHeight', type: 'uint64' },
      { name: 'parentHash', type: 'bytes32' },
      { name: 'parentIsAttestation', type: 'bool' },
      { name: 'childHeight', type: 'uint64' },
      { name: 'childHash', type: 'bytes32' },
      { name: 'childIsAttestation', type: 'bool' },
      { name: 'isAttested', type: 'bool' },
    ],
  },
] as const;

export const ccClient = createPublicClient({
  chain: creditcoin,
  transport: http(creditcoin.rpcUrls.default.http[0]),
});

/** Read-only source-chain client, used to locate a pasted transaction. */
/**
 * An endpoint override, treating blank as absent.
 *
 * A build platform that defines a variable with no value hands us the empty
 * string, and `??` would accept it: the client would then be built against no
 * endpoint at all and every read would fail for reasons that look like the chain
 * being down. This is the same fault that silently disabled the proof proxy in
 * production, so the whole class is handled in one place.
 */
const endpoint = (value: string | undefined, fallback: string) =>
  (value ?? '').trim() || fallback;

export const sourceClient = createPublicClient({
  transport: http(
    endpoint(
      process.env.NEXT_PUBLIC_SOURCE_CHAIN_RPC_URL,
      'https://sepolia-proxy-rpc.creditcoin.network',
    ),
  ),
});

/**
 * A read-only client per source chain.
 *
 * Locating a pasted transaction means reading the chain it is actually on, so a
 * single Sepolia client is not enough once mainnet evidence is in scope. Only
 * chains the precompile attests are offered — this map names endpoints, it does
 * not decide support.
 */
const SOURCE_CLIENTS: Record<number, ReturnType<typeof createPublicClient>> = {
  1: sourceClient,
  3: createPublicClient({
    transport: http(endpoint(process.env.NEXT_PUBLIC_MAINNET_RPC_URL, 'https://eth.drpc.org')),
  }),
};

export function sourceClientFor(chainKey: number) {
  const c = SOURCE_CLIENTS[chainKey];
  if (!c) throw new Error(`No source-chain endpoint configured for chain key ${chainKey}.`);
  return c;
}

/** The chains a reader may verify against, in the order they should be offered. */
export const VERIFIABLE_CHAINS = Object.values(SOURCE_CHAINS).filter(
  (c) => SOURCE_CLIENTS[c.chainKey] !== undefined,
);

export interface ProofBundle {
  chainKey: number;
  headerNumber: number;
  txIndex: number;
  txHash: Hex;
  txBytes: Hex;
  merkleProof: { root: Hex; siblings: Array<{ hash: Hex; isLeft: boolean }> };
  continuityProof: { lowerEndpointDigest: Hex; roots: Hex[] };
  cached: boolean;
}

/**
 * Resolves a chain key from the precompile. Never hardcoded.
 *
 * The caller names the chain it wants by EVM chain id; the precompile decides
 * whether it is attested and under what key. A chain absent from its list is an
 * error, not a fallback.
 */
export async function resolveSourceChainKey(chainId: number = SOURCE_CHAIN.chainId): Promise<number> {
  const chains = (await ccClient.readContract({
    address: PRECOMPILES.chainInfo,
    abi: chainInfoAbi,
    functionName: 'get_supported_chains',
  })) as ReadonlyArray<{ chainKey: bigint; chainId: bigint }>;

  const match = chains.find((c) => Number(c.chainId) === chainId);
  if (!match) {
    throw new Error(
      `Chain ${chainId} is not supported by the ChainInfo precompile. ` +
        `Supported chain ids: ${chains.map((c) => Number(c.chainId)).join(', ')}`,
    );
  }
  return Number(match.chainKey);
}

export async function attestationBounds(chainKey: number, height: number) {
  const r = (await ccClient.readContract({
    address: PRECOMPILES.chainInfo,
    abi: chainInfoAbi,
    functionName: 'get_attestation_bounds',
    args: [BigInt(chainKey), BigInt(height)],
  })) as readonly [bigint, Hex, boolean, bigint, Hex, boolean, boolean];

  return {
    parentHeight: Number(r[0]),
    childHeight: Number(r[3]),
    isAttested: r[6],
  };
}

export async function verifyOnChain(bundle: ProofBundle): Promise<boolean> {
  return (await ccClient.readContract({
    address: PRECOMPILES.blockProver,
    abi: blockProverAbi,
    functionName: 'verify',
    args: [
      BigInt(bundle.chainKey),
      BigInt(bundle.headerNumber),
      bundle.txBytes,
      bundle.merkleProof,
      bundle.continuityProof,
    ],
  })) as boolean;
}

/**
 * The proxy's error shape. Typed rather than inferred because `Response.json()`
 * resolves to `unknown` outside a DOM lib, and these helpers are read by the
 * coverage gate under the repository-root config as well as by the browser.
 */
interface ProverError {
  detail?: string;
}

/**
 * The proxy's origin.
 *
 * In the browser this is the empty string, so every request below stays a
 * same-origin relative fetch and behaves exactly as it always has. Outside the
 * browser there is no origin to be relative to, and `fetch` rejects the path
 * before any network call happens — which made the proof step untestable from
 * Node and let a gate believe the prover was down when it was merely
 * unaddressable. `PROVER_ORIGIN` supplies a base for that case only.
 */
const PROVER_ORIGIN =
  'window' in globalThis ? '' : (process.env.PROVER_ORIGIN ?? '').replace(/\/$/, '');

export async function fetchAttestedHeight(chainKey: number): Promise<number | null> {
  const res = await fetch(`${PROVER_ORIGIN}/api/prover?kind=attested-height&chainKey=${chainKey}`);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as ProverError;
    throw new Error(err.detail ?? 'prover unavailable');
  }
  const body = (await res.json()) as { attestedHeight?: unknown };
  return typeof body.attestedHeight === 'number' ? body.attestedHeight : null;
}

export async function fetchProof(chainKey: number, txHash: Hex): Promise<ProofBundle> {
  const res = await fetch(`${PROVER_ORIGIN}/api/prover?kind=proof&chainKey=${chainKey}&txHash=${txHash}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ProverError;
    throw new Error(body.detail ?? `The proof builder returned ${res.status}.`);
  }
  return (await res.json()) as ProofBundle;
}
