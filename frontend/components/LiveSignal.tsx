'use client';

import Link from 'next/link';

import { Eyebrow } from './ui';
import { formatCtc } from '@/lib/format';
import { useBookLoans, useBookOriginators } from '@/lib/data';
import { LoanStatus } from '@/lib/protocol';

/**
 * Live protocol state on the landing page.
 *
 * These are chain reads, not marketing figures. If the book is empty it says so
 * rather than showing an impressive zero — a landing page that invents numbers
 * would contradict the entire product.
 */
export function LiveSignal() {
  const { loans, isLoading } = useBookLoans();
  const { originators } = useBookOriginators();

  const breached = loans.filter((l) => l.status === LoanStatus.BREACHED).length;
  const claimed = loans.filter((l) => l.status === LoanStatus.REPAYMENT_CLAIMED).length;
  const bonded = originators.reduce((sum, o) => sum + o.bond, 0n);

  const cells: Array<{ label: string; value: string; hint: string }> = [
    {
      label: 'Claims on the book',
      value: isLoading ? '—' : String(loans.length),
      hint: 'each backed by verified evidence',
    },
    {
      label: 'Open to challenge',
      value: isLoading ? '—' : String(claimed),
      hint: 'anyone may challenge these',
    },
    {
      label: 'Covenants breached',
      value: isLoading ? '—' : String(breached),
      hint: breached > 0 ? 'proven on-chain, bond slashed' : 'none proven',
    },
    {
      label: 'Bond at stake',
      value: isLoading ? '—' : `${formatCtc(bonded, 2)} tCTC`,
      hint: 'what the originator has to lose',
    },
  ];

  return (
    <section className="rule-t rule-b">
      <div className="flex items-baseline justify-between gap-4 py-3">
        <Eyebrow>Live protocol state</Eyebrow>
        <span className="flex items-center gap-2 text-[11px] text-faint">
          <span className="inline-block h-1.5 w-1.5 bg-verified" aria-hidden />
          read from Creditcoin CC3, not cached
        </span>
      </div>

      <dl className="grid grid-cols-2 divide-x divide-rule border-t border-rule lg:grid-cols-4">
        {cells.map((c) => (
          <div key={c.label} className="px-5 py-5 first:pl-0">
            <dt className="eyebrow">{c.label}</dt>
            <dd className="tnum mt-2 text-[26px] font-semibold leading-none tracking-tight">
              {c.value}
            </dd>
            <p className="mt-1.5 text-[11px] text-faint">{c.hint}</p>
          </div>
        ))}
      </dl>

      <div className="py-3">
        <Link href="/book" className="link text-[13px]">
          Open the book →
        </Link>
      </div>
    </section>
  );
}
