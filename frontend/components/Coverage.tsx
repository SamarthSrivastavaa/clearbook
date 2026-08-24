'use client';

import { formatBlock, shortAddress } from '@/lib/format';
import { explorer } from '@/lib/config';
import { tokenMeta } from '@/lib/token';
import { coveragePercent, coverageState, type Coverage } from '@/lib/coverage';
import { sourceChain } from '@/lib/config';
import { Eyebrow } from '@/components/ui';

/**
 * Activity coverage, rendered.
 *
 * Three rules govern this component, and they are the reason it looks plainer
 * than it could:
 *
 *   1. The ratio never appears without its denominator. A lone "50%" is a claim;
 *      "4 / 8" is a measurement.
 *   2. The scope is as prominent as the number. A figure whose block range and
 *      token are hidden invites the reader to assume it covers everything.
 *   3. There is no grade. No colour ranks one originator above another, no label
 *      calls a number good or bad. Coverage is an input to a judgement, not the
 *      judgement, and the moment it renders as a score it stops being a fact.
 */
export function CoveragePanel({
  coverage,
  name,
}: {
  coverage: Coverage;
  name: string;
}) {
  const state = coverageState(coverage);
  const percent = coveragePercent(coverage);
  const chain = sourceChain(coverage.scope.chainKey);

  return (
    <div className="hard-signal border-2 border-ink bg-surface p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h3 className="text-[15px] font-semibold tracking-tight">{name}</h3>
        <Eyebrow>Activity coverage</Eyebrow>
      </div>

      {state === 'no-treasury' ? (
        <p className="mt-4 max-w-md text-[13px] leading-relaxed text-muted">
          This originator has declared no treasury, so none of its activity is measurable and none
          of its claims can be registered. There is no denominator here, and that absence is the
          finding rather than a zero.
        </p>
      ) : state === 'no-activity' ? (
        <p className="mt-4 max-w-md text-[13px] leading-relaxed text-muted">
          No qualifying transfers from the declared treasury inside the measured window. Nothing to
          divide, so no ratio is shown.
        </p>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap items-baseline gap-x-5">
            <span className="tnum text-[34px] font-semibold leading-none tracking-tight">
              {coverage.committed} / {coverage.qualifying}
            </span>
            <span className="tnum text-[20px] font-medium text-muted">{percent}</span>
          </div>

          <dl className="mt-6 grid gap-x-8 gap-y-2 sm:grid-cols-3">
            <Line k="Committed to a claim" v={coverage.committed} />
            <Line k="Verified, never claimed" v={coverage.verifiedNotCommitted} />
            <Line k="Never verified" v={coverage.unverified} />
          </dl>
        </>
      )}

      {/* Scope sits with the number, always. */}
      <div className="mt-6 border-t border-rule pt-4">
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          <div>
            <dt className="text-[11px] uppercase tracking-[0.12em] text-faint">Scope</dt>
            <dd className="mt-1 text-[12px] leading-relaxed text-muted">
              {chain.name}
              {coverage.scope.tokens.length > 0 ? (
                <>
                  {' · '}
                  {coverage.scope.tokens
                    .map((t) => tokenMeta(t).symbol ?? shortAddress(t))
                    .join(', ')}
                </>
              ) : null}
              <br />
              source blocks {formatBlock(coverage.scope.fromBlock)}–{formatBlock(coverage.scope.toBlock)}
            </dd>
          </div>

          <div>
            <dt className="text-[11px] uppercase tracking-[0.12em] text-faint">
              {coverage.treasuries.length === 1 ? 'Declared treasury' : 'Declared treasuries'}
            </dt>
            <dd className="mt-1 space-y-1">
              {coverage.treasuries.length === 0 ? (
                <span className="text-[12px] text-muted">none</span>
              ) : (
                coverage.treasuries.map((t) => (
                  <div key={t.address} className="text-[12px]">
                    <a
                      href={explorer.sourceAddress(t.address, coverage.scope.chainKey)}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="ident ident-link"
                      title={t.address}
                    >
                      {shortAddress(t.address)}
                    </a>
                    <span className="ml-2 text-faint">
                      bound at Creditcoin block {formatBlock(t.boundAt)}
                    </span>
                  </div>
                ))
              )}
            </dd>
          </div>
        </dl>

        {coverage.revertedSkipped > 0 ? (
          <p className="mt-2 text-[12px] text-faint">
            {coverage.revertedSkipped} transfer
            {coverage.revertedSkipped === 1 ? '' : 's'} excluded: the transaction reverted.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Line({ k, v }: { k: string; v: number }) {
  return (
    <div>
      <dt className="text-[12px] text-muted">{k}</dt>
      <dd className="tnum mt-0.5 text-[16px] font-medium">{v}</dd>
    </div>
  );
}
