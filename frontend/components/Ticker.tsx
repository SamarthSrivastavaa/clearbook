'use client';

import { useBlockNumber } from 'wagmi';

import { formatBlock, formatCtc } from '@/lib/format';
import { isPreview, useBookLoans, useBookOriginators, useVaultFacts } from '@/lib/data';
import { LoanStatus } from '@/lib/protocol';

/**
 * A running band of live protocol state.
 *
 * The device is borrowed from editorial and transit signage — a marquee that
 * repeats — but the content is not decoration. Every figure is a chain read, so
 * the band is doing the same job as the rest of the interface: showing what is
 * true right now rather than what we would like a visitor to believe.
 *
 * It pauses on hover so a figure can actually be read, and stops entirely under
 * prefers-reduced-motion.
 */
export function Ticker() {
  const { data: block } = useBlockNumber({
    watch: !isPreview,
    query: { enabled: !isPreview, refetchInterval: 12_000 },
  });
  const { loans } = useBookLoans();
  const { originators } = useBookOriginators();
  const { facts } = useVaultFacts();

  const breached = loans.filter((l) => l.status === LoanStatus.BREACHED).length;
  const bonded = originators.reduce((sum, o) => sum + o.bond, 0n);
  const mainnetFacts = facts.filter((f) => f.chainKey === 3).length;

  // Only figures we can actually read. A quiet chain shows a short band rather
  // than padding itself out with invented ones.
  const items: string[] = [];
  if (block) items.push(`Creditcoin block ${formatBlock(block)}`);
  if (facts.length) items.push(`${facts.length} verified facts`);
  if (mainnetFacts) items.push(`${mainnetFacts} from Ethereum mainnet`);
  if (loans.length) items.push(`${loans.length} claims on the book`);
  if (originators.length) items.push(`${originators.length} originators, one namespace`);
  if (bonded > 0n) items.push(`${formatCtc(bonded, 2)} tCTC bonded`);
  if (breached) items.push(`${breached} covenant breached and slashed`);
  items.push('No transfer backs two claims');
  items.push('Verification needs no permission');

  // Duplicated once: the animation translates by exactly -50%, so the second
  // copy is what makes the loop seamless rather than snapping back.
  const run = [...items, ...items];

  return (
    <div
      className="border-y-2 border-ink bg-signal text-paper"
      role="status"
      aria-label="Live protocol state"
    >
      <div className="overflow-hidden py-2.5">
        <div className="ticker-track">
          {run.map((item, i) => (
            <span key={i} className="flex items-center">
              <span className="whitespace-nowrap px-5 text-[12px] font-medium tracking-[0.08em]">
                {item}
              </span>
              <span aria-hidden className="text-[10px] opacity-60">
                ◆
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
