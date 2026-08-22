import type { Address } from 'viem';

/**
 * Token metadata.
 *
 * Decimals cannot be read from a Transfer log, and guessing at 18 would print a
 * wrong number for any token that is not 18. So the rule is: identify the token
 * or show the raw integer. A raw integer is honest; a wrongly-scaled decimal is
 * not, and in a product about verified figures that distinction matters.
 *
 * This registry is small on purpose. It grows only with tokens we have actually
 * verified on-chain.
 */

interface TokenMeta {
  symbol: string;
  decimals: number;
}

/**
 * Keyed by address. Entries are chain-specific in practice — a token deployment
 * is unique to its chain — and every one here was read from that chain before
 * being added, never copied from a token list.
 */
const KNOWN: Record<string, TokenMeta> = {
  /** Sepolia. Verified live: name "Wrapped Ether", symbol WETH, decimals 18. */
  '0x7b79995e5f793a07bc00c21412e50ecae098e7f9': { symbol: 'WETH', decimals: 18 },
  /** Ethereum mainnet. Verified live: name "USD Coin", symbol USDC, decimals 6. */
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { symbol: 'USDC', decimals: 6 },
};

export function tokenMeta(address: Address | string): {
  symbol: string | null;
  decimals: number | null;
} {
  const meta = KNOWN[address.toLowerCase()];
  return meta ? { symbol: meta.symbol, decimals: meta.decimals } : { symbol: null, decimals: null };
}
