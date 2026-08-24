'use client';

import Link from 'next/link';
import { Fragment, useMemo } from 'react';
import { ScenarioGuide } from '@/components/ScenarioGuide';
import { LoadingRows, NotDeployed, PreviewBanner, RpcError } from '@/components/States';
import { Eyebrow, Empty, Status } from '@/components/ui';
import { explorer } from '@/lib/config';
import { blocksToApproxDuration, formatBlock, formatCtc, formatTokenAmount, shortAddress } from '@/lib/format';
import { tokenMeta } from '@/lib/token';
import { dataSource, isPreview, useBookLoans, useBookOriginators, useCurrentBlock, useParams } from '@/lib/data';
import { MetricBand } from '@/components/Metrics';
import {
  LoanStatus,
  STATUS_META,
  blocksLeftInWindow,
  isChallengeable,
  type Loan,
  type Originator,
} from '@/lib/protocol';

/**
 * The Book.
 *
 * A ledger, not a dashboard. The question this screen answers in under a second
 * is "what needs my attention?", so the state of the book is stated in a sentence
 * before any table appears, and anything challengeable or breached is lifted to
 * the top and marked with a status rule.
 */
export default function BookPage() {
  const { loans, isLoading, error } = useBookLoans();
  const { originators } = useBookOriginators();
  const { params } = useParams();
  const currentBlock = useCurrentBlock();

  const originatorById = useMemo(
    () => new Map(originators.map((o) => [o.id.toString(), o])),
    [originators],
  );

  const { attention, rest } = useMemo(() => {
    if (!currentBlock) return { attention: [] as Loan[], rest: loans };
    const needs: Loan[] = [];
    const others: Loan[] = [];
    for (const loan of loans) {
      const o = originatorById.get(loan.originatorId.toString());
      const urgent =
        loan.status === LoanStatus.BREACHED ||
        loan.status === LoanStatus.DELINQUENT ||
        (o ? isChallengeable(loan, o, currentBlock) : false);
      (urgent ? needs : others).push(loan);
    }
    return { attention: needs, rest: others };
  }, [loans, originatorById, currentBlock]);

  if (dataSource === 'none') return <NotDeployed />;
  if (error) return <RpcError message={error.message} />;

  const primary = originators[0] ?? null;

  return (
    <div className="space-y-12">
      {isPreview ? <PreviewBanner /> : null}

      {/*
        The ledger is what this page is. State sits beside the title rather than
        beneath it, and the originators sit after the book rather than in front
        of it — both are context for the claims, and a reader who came to see
        the book should not have to scroll past two blocks of reference data to
        reach it.
      */}
      <header className="flex flex-wrap items-end justify-between gap-x-12 gap-y-6">
        <div>
          <Eyebrow>Credit book</Eyebrow>
          <h1 className="display-lg mt-2">
            {originators.length > 1 ? 'The shared book' : primary ? primary.name : 'The Book'}
          </h1>
        </div>

        <BookState
          loans={loans}
          originatorById={originatorById}
          currentBlock={currentBlock}
          isLoading={isLoading}
          originatorCount={originators.length}
          bonded={originators.reduce((sum, o) => sum + o.bond, 0n)}
        />
      </header>

      {isPreview ? <ScenarioGuide /> : null}

      {isLoading ? (
        <LoadingRows />
      ) : loans.length === 0 ? (
        <Empty title="No loans registered">
          The contracts are deployed but no originator has registered a loan yet. A loan appears
          here once its disbursement evidence has been verified on-chain.
        </Empty>
      ) : (
        <LoanLedger
          groups={[
            { label: 'Requires attention', loans: attention, marked: true },
            { label: attention.length > 0 ? 'Settled and quiet' : 'Claims', loans: rest },
          ].filter((g) => g.loans.length > 0)}
          originatorById={originatorById}
          currentBlock={currentBlock ?? 0n}
        />
      )}

      {params && originators.length > 0 ? (
        <section>
          <div className="rule-b pb-2">
            <Eyebrow>Originators</Eyebrow>
          </div>
          <div className="grid gap-6 pt-6 lg:grid-cols-2">
            {originators.map((o) => (
              <PositionStrip key={o.id.toString()} originator={o} bondPerLoan={params.bondPerLoan} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

const COUNT_WORD = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];
const word = (n: number) => COUNT_WORD[n] ?? String(n);

/**
 * The state of the book, in a sentence, from chain reads.
 *
 * This is the first thing a reader should be able to act on, so it says what is
 * true right now rather than describing what the page contains. Every clause is
 * derived — none of it is written copy about a hypothetical book.
 */
function BookState({
  loans,
  originatorById,
  currentBlock,
  isLoading,
  originatorCount,
  bonded,
}: {
  loans: Loan[];
  originatorById: Map<string, Originator>;
  currentBlock: bigint | undefined;
  isLoading: boolean;
  originatorCount: number;
  bonded: bigint;
}) {
  if (isLoading || !currentBlock) {
    return <p className="mt-6 text-[13px] text-faint">Reading the book from Creditcoin…</p>;
  }

  const breached = loans.filter((l) => l.status === LoanStatus.BREACHED);
  const open = loans.filter((l) => {
    const o = originatorById.get(l.originatorId.toString());
    return o ? isChallengeable(l, o, currentBlock) : false;
  });

  // Soonest window to close, so the reader knows how much time they actually have.
  let soonest: bigint | null = null;
  for (const l of open) {
    const o = originatorById.get(l.originatorId.toString());
    if (!o) continue;
    const left = blocksLeftInWindow(l, o, currentBlock);
    if (soonest === null || left < soonest) soonest = left;
  }

  // Live state as figures, not as a sentence. A paragraph describing the book
  // reads like documentation about a product; the figures themselves read like
  // the product. Every value here is a chain read.
  //
  // Qualifiers ("one namespace", "bond slashed") used to sit under some cells
  // and not others, which left the band with a ragged bottom edge. They are in
  // the labels now, so every figure lands on the same baseline.
  return (
    <MetricBand
      compact
      metrics={[
        { label: 'Claims', value: String(loans.length) },
        { label: 'Originators', value: String(originatorCount) },
        { label: 'Bonded', value: `${formatCtc(bonded)} tCTC` },
        {
          label: soonest !== null ? `Open · ${blocksToApproxDuration(soonest)} left` : 'Open to challenge',
          value: String(open.length),
          tone: open.length > 0 ? 'pending' : undefined,
        },
        {
          label: breached.length > 0 ? 'Breached · slashed' : 'Breached',
          value: String(breached.length),
          tone: breached.length > 0 ? 'breach' : undefined,
        },
      ]}
    />
  );
}

/**
 * One originator's position.
 *
 * The figure that matters is not the bond, it is how much of the bond is
 * currently at risk — an originator with 8 tCTC posted and 7 committed is in a
 * different position from one with 8 and 1, and three numbers in a row do not
 * say so. The bar says it at a glance, and it is a true proportion rather than
 * a decorative one: exposure over bond, drawn to scale.
 *
 * Rendered per originator rather than for the first only: the book holds more
 * than one institution, and showing a single fund's bond beside everyone's
 * claims would misstate who is exposed to what.
 */
function PositionStrip({ originator, bondPerLoan }: { originator: Originator; bondPerLoan: bigint }) {
  const free = originator.bond - originator.exposure;
  const openLoans = bondPerLoan > 0n ? originator.exposure / bondPerLoan : 0n;

  // Integer maths throughout: bigint has no fractional division, and the bar
  // only needs whole percentage points.
  const atRiskPct =
    originator.bond > 0n ? Number((originator.exposure * 100n) / originator.bond) : 0;

  return (
    <div className="hard-signal border-2 border-ink bg-surface p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-[17px] font-semibold tracking-tight">{originator.name}</h3>
        <span className="ident text-[11px] text-faint">
          {originator.covenants & 0x01 ? 'CIRCULAR_REPAYMENT · immutable' : 'no covenant'}
        </span>
      </div>

      <p className="tnum mt-5 text-[30px] font-semibold leading-none tracking-tight">
        {formatCtc(originator.bond)}
        <span className="ml-1.5 text-[15px] font-medium text-muted">tCTC bonded</span>
      </p>

      {/* Exposure drawn to scale. The filled part is what a challenger could
          take today; the remainder is what this originator could still commit. */}
      <div className="mt-5">
        <div className="flex h-1.5 w-full overflow-hidden bg-rule" aria-hidden>
          <div className="bg-ink" style={{ width: `${atRiskPct}%` }} />
        </div>
        <dl className="mt-2.5 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-[12px]">
          <div className="flex items-baseline gap-1.5">
            <dt className="text-muted">At risk</dt>
            <dd className="tnum font-medium">{formatCtc(originator.exposure)} tCTC</dd>
            <dd className="text-faint">
              · {openLoans.toString()} open claim{openLoans === 1n ? '' : 's'}
            </dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt className="text-muted">Free</dt>
            <dd className="tnum font-medium">{formatCtc(free)} tCTC</dd>
          </div>
        </dl>
      </div>

      <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-1 border-t border-rule pt-4">
        <div className="flex items-baseline gap-2">
          <dt className="text-[11px] text-faint">Circular window</dt>
          <dd className="tnum font-mono text-[12px]">
            {formatBlock(originator.circularWindow)} blocks
          </dd>
        </div>
        <div className="flex items-baseline gap-2">
          <dt className="text-[11px] text-faint">Challenge window</dt>
          <dd className="tnum font-mono text-[12px]">
            {blocksToApproxDuration(BigInt(originator.challengeWindow))}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * The ledger.
 *
 * One table, not one per group. Repeating a seven-column header for every
 * grouping produced the look of generated output rather than a designed record,
 * and it made two halves of the same book scan as two unrelated objects. Groups
 * are marked by a label inside the body instead.
 *
 * A row states its own condition. Breached rows carry a red rail and sit on a
 * sunken ground; rows whose challenge window is still open carry a pending
 * rail. A reader should be able to find what matters without reading the status
 * column — and colour is never the only signal, since the rail, the ground and
 * the status word all agree.
 */
function LoanLedger({
  groups,
  originatorById,
  currentBlock,
}: {
  groups: Array<{ label: string; loans: Loan[]; marked?: boolean }>;
  originatorById: Map<string, Originator>;
  currentBlock: bigint;
}) {
  return (
    <section>
      <div className="-mx-6 overflow-x-auto px-6 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[820px] table-fixed border-collapse text-left">
          <colgroup>
            <col className="w-[10%]" />
            <col className="w-[22%]" />
            <col className="w-[15%]" />
            <col className="w-[12%]" />
            <col className="w-[9%]" />
            <col className="w-[17%]" />
            <col className="w-[15%]" />
          </colgroup>

          <thead>
            <tr className="border-b-2 border-ink">
              {['Claim', 'Originator', 'Borrower', 'Principal', 'Token', 'Status', ''].map((h, i) => (
                <th
                  key={h || 'action'}
                  scope="col"
                  className={`pb-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint ${
                    i >= 3 ? 'text-right' : ''
                  }`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {groups.map((group, gi) => (
              <Fragment key={group.label}>
                <tr>
                  <th
                    colSpan={7}
                    scope="colgroup"
                    className={`text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-faint ${
                      gi === 0 ? 'pb-2 pt-4' : 'pb-2 pt-9'
                    }`}
                  >
                    {group.label}
                  </th>
                </tr>

                {group.loans.map((loan) => {
                  const originator = originatorById.get(loan.originatorId.toString());
                  const meta = STATUS_META[loan.status];
                  const challengeable = originator
                    ? isChallengeable(loan, originator, currentBlock)
                    : false;
                  const left = originator ? blocksLeftInWindow(loan, originator, currentBlock) : 0n;

                  const breached = loan.status === LoanStatus.BREACHED;
                  const rail = breached
                    ? 'border-l-2 border-l-breach'
                    : challengeable
                      ? 'border-l-2 border-l-pending'
                      : 'border-l-2 border-l-transparent';

                  return (
                    <tr
                      key={loan.id.toString()}
                      className={`group border-b border-rule transition-colors ${
                        breached ? 'bg-sunken hover:bg-rule/40' : 'hover:bg-sunken'
                      }`}
                    >
                      <td className={`py-3.5 pl-3 ${rail}`}>
                        <Link
                          href={`/loan/${loan.id}`}
                          className="font-mono text-[13px] font-medium underline decoration-transparent underline-offset-4 transition-colors group-hover:decoration-ink"
                        >
                          L-{loan.id.toString().padStart(3, '0')}
                        </Link>
                      </td>

                      <td className="py-3.5">
                        <span className="text-[12px]">
                          {originator ? originator.name : <span className="text-faint">unknown</span>}
                        </span>
                      </td>

                      <td className="py-3.5">
                        <a
                          href={explorer.sourceAddress(loan.borrower)}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="ident ident-link"
                          title={loan.borrower}
                        >
                          {shortAddress(loan.borrower)}
                        </a>
                      </td>

                      <td className="tnum py-3.5 text-right font-mono text-[13px]">
                        {formatTokenAmount(loan.principal, tokenMeta(loan.token).decimals)}
                      </td>

                      <td className="py-3.5 text-right">
                        <a
                          href={explorer.sourceToken(loan.token)}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="ident ident-link"
                          title={loan.token}
                        >
                          {tokenMeta(loan.token).symbol ?? shortAddress(loan.token)}
                        </a>
                      </td>

                      <td className="py-3.5 text-right">
                        <div className="flex justify-end">
                          <Status tone={meta.tone}>{meta.label}</Status>
                        </div>
                      </td>

                      {/*
                        The last column carries the action, not just the time.
                        A book that reports state and offers nothing to do with
                        it is a report; the claim here is that anyone may act,
                        so the row where acting is possible says so.
                      */}
                      <td className="tnum py-3.5 pr-1 text-right text-[12px] text-muted">
                        {loan.status === LoanStatus.REPAYMENT_CLAIMED ? (
                          challengeable ? (
                            <Link
                              href={`/challenge?loan=${loan.id}`}
                              title={`${left} Creditcoin blocks remain`}
                              className="inline-flex items-baseline gap-1.5 text-pending transition-colors hover:text-ink"
                            >
                              <span className="font-medium">Challenge</span>
                              <span className="text-[11px] text-muted">
                                {blocksToApproxDuration(left)} left
                              </span>
                            </Link>
                          ) : (
                            <span className="text-faint">window closed</span>
                          )
                        ) : breached ? (
                          <Link
                            href={`/loan/${loan.id}`}
                            className="text-breach transition-colors hover:text-ink"
                          >
                            See the evidence
                          </Link>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
