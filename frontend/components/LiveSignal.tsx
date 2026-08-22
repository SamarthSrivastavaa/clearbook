'use client';

import Link from 'next/link';

import { Eyebrow } from './ui';
import { formatCtc } from '@/lib/format';
import { useBookLoans, useBookOriginators } from '@/lib/data';
import { LoanStatus } from '@/lib/protocol';

/**
 * Live protocol state, read from Creditcoin on every load.
 *
 * Written as a sentence rather than a row of large figures. Four big numbers
 * under a hero is the dashboard reflex, and it says nothing: the point is not
 * that there are four claims, it is that this page is reading a live chain and
 * will say so honestly when the book is empty.
 *
 * If the book is empty it says that, rather than showing an impressive zero. A
 * landing page that invented numbers would contradict the entire product.
 */
export function LiveSignal() {
  const { loans, isLoading } = useBookLoans();
  const { originators } = useBookOriginators();

  const breached = loans.filter((l) => l.status === LoanStatus.BREACHED).length;
  const claimed = loans.filter((l) => l.status === LoanStatus.REPAYMENT_CLAIMED).length;
  const bonded = originators.reduce((sum, o) => sum + o.bond, 0n);

  return (
    <section className="rule-b flex flex-wrap items-baseline gap-x-8 gap-y-3 py-4">
      <span className="flex items-center gap-2.5">
        <span className="relative flex h-1.5 w-1.5" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-live bg-verified" />
        </span>
        <Eyebrow>Live on Creditcoin CC3</Eyebrow>
      </span>

      {isLoading ? (
        <span className="text-[13px] text-faint">Reading the book…</span>
      ) : loans.length === 0 ? (
        <span className="text-[13px] text-muted">
          No claims are registered yet. This page reads the contracts directly, so it will stay
          empty until one is.
        </span>
      ) : (
        <p className="text-[13px] leading-relaxed text-muted">
          <Figure>{loans.length}</Figure> claims on the book, each citing verified evidence
          {claimed > 0 ? (
            <>
              {' · '}
              <Figure>{claimed}</Figure> open to challenge by anyone
            </>
          ) : null}
          {breached > 0 ? (
            <>
              {' · '}
              <Figure tone="breach">{breached}</Figure> proven breached and slashed
            </>
          ) : null}
          {' · '}
          <Figure>{formatCtc(bonded, 2)} tCTC</Figure> of bond at stake
        </p>
      )}

      <Link href="/book" className="link ml-auto shrink-0 text-[13px]">
        Open the book →
      </Link>
    </section>
  );
}

/** A live figure, given just enough weight to be read as data rather than prose. */
function Figure({ children, tone }: { children: React.ReactNode; tone?: 'breach' }) {
  return (
    <span
      className={`tnum font-mono text-[13px] font-medium ${tone === 'breach' ? 'text-breach' : 'text-ink'}`}
    >
      {children}
    </span>
  );
}
