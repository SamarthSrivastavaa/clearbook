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

/** Source chain used for evidence. Resolved to a chainKey at runtime on-chain. */
export const SOURCE_CHAIN = {
  chainId: 11155111,
  name: 'Ethereum Sepolia',
  explorer: 'https://sepolia.etherscan.io',
} as const;

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
  sourceTx: (hash: string) => `${SOURCE_CHAIN.explorer}/tx/${hash}`,
  sourceAddress: (address: string) => `${SOURCE_CHAIN.explorer}/address/${address}`,
  sourceBlock: (block: bigint | number) => `${SOURCE_CHAIN.explorer}/block/${block.toString()}`,
  sourceToken: (address: string) => `${SOURCE_CHAIN.explorer}/token/${address}`,
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
