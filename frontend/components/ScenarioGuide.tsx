'use client';

import Link from 'next/link';

import { FIXTURE_SCENARIOS } from '@/lib/fixtures';
import { Eyebrow } from './ui';

/**
 * The demo narrative, stated once and plainly.
 *
 * A judge should not have to infer which loan demonstrates what. Each scenario
 * names its expected outcome up front, including the two that are supposed to
 * fail — a mechanism that only ever succeeds demonstrates nothing.
 */
export function ScenarioGuide() {
  return (
    <section className="rule-t rule-b py-5">
      <div className="flex items-baseline justify-between gap-4">
        <Eyebrow>Staged scenarios</Eyebrow>
        <span className="text-[11px] text-faint">
          Expected outcomes, declared in advance
        </span>
      </div>

      <ol className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-3">
        {FIXTURE_SCENARIOS.map((s) => (
          <li key={s.key} className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="ident text-[11px] font-medium text-ink">{s.key}</span>
              <Link
                href={`/loan/${s.loanId}`}
                className="font-mono text-[12px] underline decoration-rule-strong underline-offset-4 hover:decoration-ink"
              >
                L-{s.loanId.toString().padStart(3, '0')}
              </Link>
              <span className="text-[13px] text-ink">{s.title}</span>
            </div>
            <div className="mt-1.5 text-[12px] font-medium text-muted">{s.outcome}</div>
            <p className="mt-1 text-[12px] leading-relaxed text-faint">{s.detail}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
