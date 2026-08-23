import { defineChain, type Address } from 'viem';

/**
 * Network and deployment configuration.
 *
 * Contract addresses come from the environment and default to unset. When unset
 * the app renders an explicit "not deployed" state rather than inventing data —
 * nothing in this UI is allowed to imply a deployment that does not exist.
 */

/** Creditcoin CC3 testnet. chainId verified live via eth_chainId. */
export const creditcoin = defineChain({
  id: 102031,
  name: 'Creditcoin CC3 Testnet',
  nativeCurrency: { name: 'Testnet CTC', symbol: 'tCTC', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.cc3-testnet.creditcoin.network'] },
  },
  blockExplorers: {
    // Per docs.creditcoin.org/environments/testnet
    default: { name: 'Blockscout', url: 'https://creditcoin-testnet.blockscout.com' },
  },
  testnet: true,
});

/**
 * Source chains, keyed by the chainKey the ChainInfo precompile assigns.
 *
 * These keys are not ours to choose — they are read from the precompile at
 * runtime and verified in Gate 0. They are listed here only so the interface can
 * name and link a chain it has been handed; nothing here decides what is
 * supported, and a chainKey absent from this map still renders (as its number)
 * rather than being silently dropped.
 *
 * Only chains the attestor set actually attests appear here. Extending this map
 * does not add support; the precompile does.
 */
export interface SourceChainInfo {
  chainKey: number;
  chainId: number;
  name: string;
  short: string;
  explorer: string;
  /** True for chains carrying real economic value. */
  live: boolean;
}

export const SOURCE_CHAINS: Record<number, SourceChainInfo> = {
  1: {
    chainKey: 1,
    chainId: 11155111,
    name: 'Ethereum Sepolia',
    short: 'Sepolia',
    explorer: 'https://sepolia.etherscan.io',
    live: false,
  },
  3: {
    chainKey: 3,
    chainId: 1,
    name: 'Ethereum Mainnet',
    short: 'Mainnet',
    explorer: 'https://etherscan.io',
    live: true,
  },
};

/**
 * Every attested source chain, real-value first.
 *
 * Derived from the map rather than written out, so it cannot drift from what is
 * actually configured. Leading with the live chain is not emphasis: reading a
 * chain carrying real value is the harder claim, and the one worth stating
 * first.
 */
export const SOURCE_CHAIN_LABEL = Object.values(SOURCE_CHAINS)
  .sort((a, b) => Number(b.live) - Number(a.live))
  .map((c, i) => (i === 0 ? c.name : c.short))
  .join(' · ');

/** The chain the demo's staged claims live on. Evidence may come from any. */
export const SOURCE_CHAIN = SOURCE_CHAINS[1];

export function sourceChain(chainKey: number | bigint): SourceChainInfo {
  const k = Number(chainKey);
  return (
    SOURCE_CHAINS[k] ?? {
      chainKey: k,
      chainId: 0,
      name: `chainKey ${k}`,
      short: `chainKey ${k}`,
      explorer: '',
      live: false,
    }
  );
}

function optionalAddress(value: string | undefined): Address | null {
  if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value)) return null;
  return value as Address;
}

export const contracts = {
  evidenceVault: optionalAddress(process.env.NEXT_PUBLIC_EVIDENCE_VAULT_ADDRESS),
  clearbook: optionalAddress(process.env.NEXT_PUBLIC_CLEARBOOK_ADDRESS),
} as const;

export const isDeployed = contracts.evidenceVault !== null && contracts.clearbook !== null;

/** The precompiles Clearbook depends on. Constants, not configuration. */
export const PRECOMPILES = {
  blockProver: '0x0000000000000000000000000000000000000FD2' as Address,
  chainInfo: '0x0000000000000000000000000000000000000fd3' as Address,
} as const;

// --- Explorer links. Every figure in the UI resolves through one of these. ---

export const explorer = {
  // The optional chainKey keeps every existing call site working while letting
  // the registry link a mainnet fact to mainnet rather than to Sepolia.
  sourceTx: (hash: string, chainKey?: number | bigint) =>
    `${sourceChain(chainKey ?? SOURCE_CHAIN.chainKey).explorer}/tx/${hash}`,
  sourceAddress: (address: string, chainKey?: number | bigint) =>
    `${sourceChain(chainKey ?? SOURCE_CHAIN.chainKey).explorer}/address/${address}`,
  sourceBlock: (block: bigint | number, chainKey?: number | bigint) =>
    `${sourceChain(chainKey ?? SOURCE_CHAIN.chainKey).explorer}/block/${block.toString()}`,
  sourceToken: (address: string, chainKey?: number | bigint) =>
    `${sourceChain(chainKey ?? SOURCE_CHAIN.chainKey).explorer}/token/${address}`,
  ccTx: (hash: string) => `${creditcoin.blockExplorers.default.url}/tx/${hash}`,
  ccAddress: (address: string) => `${creditcoin.blockExplorers.default.url}/address/${address}`,
  ccBlock: (block: bigint | number) =>
    `${creditcoin.blockExplorers.default.url}/block/${block.toString()}`,
} as const;

/**
 * Demo mode. When enabled the UI labels the book's transactions as staged by us.
 * This is a disclosure flag, never a data source — staged transactions are real
 * on-chain transactions that we created, not fabricated records.
 */
export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

/**
 * Artifacts from demo runs that cannot be rediscovered from chain logs.
 *
 * A reverted transaction emits no events, so the duplicate-commitment refusal
 * has no on-chain trace to query — only a receipt. This records the hash of the
 * one we actually sent (integration/results/collision.json) so the interface can
 * link to it instead of asserting it happened.
 */
export const DEMO_ARTIFACTS = {
  /** Originator B attempting a fact already committed by A. Reverted. */
  duplicateCommitmentTx: '0xe68c7de8dba9367535a5741e6f618c1c564e7fe7e32cae7a69074334bc22d222',
  secondOriginatorId: 2n,
  secondOriginatorName: 'Northgate Structured Credit',
  /** B's owner. The simulation must run AS this account: registerLoan checks
   *  ownership first, so any other sender is refused for the wrong reason. */
  secondOriginatorOwner: '0xCC37dc94204D78608d79E24D9cCccd7328a94FD8' as Address,
} as const;
