import { createPublicClient, http, type Hex } from 'viem';

import { PRECOMPILES, SOURCE_CHAIN, creditcoin } from './config';

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
export const sourceClient = createPublicClient({
  transport: http(
    process.env.NEXT_PUBLIC_SOURCE_CHAIN_RPC_URL ?? 'https://sepolia-proxy-rpc.creditcoin.network',
  ),
});

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

/** Resolves the chain key for the configured source chain. Never hardcoded. */
export async function resolveSourceChainKey(): Promise<number> {
  const chains = (await ccClient.readContract({
    address: PRECOMPILES.chainInfo,
    abi: chainInfoAbi,
    functionName: 'get_supported_chains',
  })) as ReadonlyArray<{ chainKey: bigint; chainId: bigint }>;

  const match = chains.find((c) => Number(c.chainId) === SOURCE_CHAIN.chainId);
  if (!match) {
    throw new Error(
      `Chain ${SOURCE_CHAIN.chainId} is not supported by the ChainInfo precompile. ` +
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

export async function fetchAttestedHeight(chainKey: number): Promise<number | null> {
  const res = await fetch(`/api/prover?kind=attested-height&chainKey=${chainKey}`);
  if (!res.ok) throw new Error((await res.json()).detail ?? 'prover unavailable');
  const body = await res.json();
  return typeof body.attestedHeight === 'number' ? body.attestedHeight : null;
}

export async function fetchProof(chainKey: number, txHash: Hex): Promise<ProofBundle> {
  const res = await fetch(`/api/prover?kind=proof&chainKey=${chainKey}&txHash=${txHash}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `The proof builder returned ${res.status}.`);
  }
  return (await res.json()) as ProofBundle;
}
