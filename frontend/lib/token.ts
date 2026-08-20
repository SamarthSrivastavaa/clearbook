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

/** Verified live: name "Wrapped Ether", symbol WETH, decimals 18. */
const KNOWN: Record<string, TokenMeta> = {
  '0x7b79995e5f793a07bc00c21412e50ecae098e7f9': { symbol: 'WETH', decimals: 18 },
};

export function tokenMeta(address: Address | string): {
  symbol: string | null;
  decimals: number | null;
} {
  const meta = KNOWN[address.toLowerCase()];
  return meta ? { symbol: meta.symbol, decimals: meta.decimals } : { symbol: null, decimals: null };
}
