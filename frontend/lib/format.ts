import { formatUnits } from 'viem';

/** Formatting helpers. Every figure shown to a user passes through one of these. */

/** Truncates a hash for display. The full value always remains in `title`/href. */
export function shortHash(hash: string, lead = 10, tail = 8): string {
  if (hash.length <= lead + tail + 1) return hash;
  return `${hash.slice(0, lead)}…${hash.slice(-tail)}`;
}

export function shortAddress(address: string): string {
  return shortHash(address, 6, 4);
}

/**
 * Token amounts. Decimals are not knowable from a Transfer log, so the caller
 * must supply them; when unknown we show the raw integer and say so rather than
 * guessing at 18 and printing a wrong number.
 */
export function formatTokenAmount(amount: bigint, decimals: number | null): string {
  if (decimals === null) return amount.toString();
  const raw = formatUnits(amount, decimals);
  const [whole, frac] = raw.split('.');
  const grouped = BigInt(whole).toLocaleString('en-US');
  if (!frac) return grouped;
  const trimmed = frac.replace(/0+$/, '').slice(0, 6);
  return trimmed ? `${grouped}.${trimmed}` : grouped;
}

/** Native CTC, always 18 decimals. */
export function formatCtc(wei: bigint, maxFrac = 4): string {
  const raw = formatUnits(wei, 18);
  const [whole, frac] = raw.split('.');
  const grouped = BigInt(whole).toLocaleString('en-US');
  if (!frac) return grouped;
  const trimmed = frac.replace(/0+$/, '').slice(0, maxFrac);
  return trimmed ? `${grouped}.${trimmed}` : grouped;
}

export function formatBlock(block: bigint | number): string {
  return BigInt(block).toLocaleString('en-US');
}

/**
 * Blocks expressed as approximate wall-clock time.
 *
 * Explicitly approximate: Creditcoin block times vary, and the protocol itself
 * never depends on timestamps (BUILD.md §3.3). This is a reading aid, and it is
 * always labelled with a leading "~" so nobody mistakes it for a measurement.
 */
export function blocksToApproxDuration(blocks: bigint, secondsPerBlock = 15): string {
  const seconds = Number(blocks < 0n ? -blocks : blocks) * secondsPerBlock;
  if (seconds < 90) return `~${Math.round(seconds)}s`;
  const minutes = seconds / 60;
  if (minutes < 90) return `~${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 48) return `~${hours.toFixed(1)}h`;
  return `~${(hours / 24).toFixed(1)}d`;
}

export function basisPoints(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}
