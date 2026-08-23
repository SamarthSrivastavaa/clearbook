'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { ScenarioGuide } from '@/components/ScenarioGuide';
import { LoadingRows, NotDeployed, PreviewBanner, RpcError } from '@/components/States';
import { Eyebrow, Empty, Status } from '@/components/ui';
import { explorer } from '@/lib/config';
import { blocksToApproxDuration, formatBlock, formatCtc, formatTokenAmount, shortAddress } from '@/lib/format';
import { tokenMeta } from '@/lib/token';
import { dataSource, isPreview, useBookLoans, useBookOriginators, useCurrentBlock, useParams } from '@/lib/data';
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

      <header>
        <Eyebrow>Credit book</Eyebrow>
        <h1 className="display-lg mt-2">
          {originators.length > 1 ? 'The shared book' : primary ? primary.name : 'The Book'}
        </h1>

        <BookState
          loans={loans}
          originatorById={originatorById}
          currentBlock={currentBlock}
          isLoading={isLoading}
        />

        <p className="mt-5 max-w-2xl text-[12px] leading-relaxed text-faint">
          {originators.length > 1
            ? `${originators.length} originators, one evidence namespace. Every claim below cites a source-chain transfer verified by the Creditcoin Block Prover precompile, and no transfer may back more than one claim.`
            : 'Every claim below cites a source-chain transfer whose inclusion was verified by the Creditcoin Block Prover precompile. Nothing on this page is self-reported.'}
        </p>
      </header>

      {params && originators.length > 0 ? (
        <section>
          <div className="rule-b flex items-baseline justify-between gap-4 pb-2">
            <Eyebrow>Originators</Eyebrow>
            <span className="text-[11px] text-faint">
              Each posts its own bond and publishes its own covenant
            </span>
          </div>
          <div className="grid gap-6 pt-6 lg:grid-cols-2">
            {originators.map((o) => (
              <PositionStrip key={o.id.toString()} originator={o} bondPerLoan={params.bondPerLoan} />
            ))}
          </div>
        </section>
      ) : null}

      {isPreview ? <ScenarioGuide /> : null}

      {isLoading ? (
        <LoadingRows />
      ) : loans.length === 0 ? (
        <Empty title="No loans registered">
          The contracts are deployed but no originator has registered a loan yet. A loan appears
          here once its disbursement evidence has been verified on-chain.
        </Empty>
      ) : (
        <div className="space-y-10">
          {attention.length > 0 && currentBlock ? (
            <LoanTable
              title="Requires attention"
              subtitle="Open challenge windows, delinquencies, and proven breaches"
              loans={attention}
              originatorById={originatorById}
              currentBlock={currentBlock}
              marked
            />
          ) : null}

          {rest.length > 0 ? (
            <LoanTable
              title={attention.length > 0 ? 'Remainder of the book' : 'Loans'}
              loans={rest}
              originatorById={originatorById}
              currentBlock={currentBlock ?? 0n}
            />
          ) : null}
        </div>
      )}
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
}: {
  loans: Loan[];
  originatorById: Map<string, Originator>;
  currentBlock: bigint | undefined;
  isLoading: boolean;
}) {
  if (isLoading || !currentBlock) {
    return <p className="prose-lead mt-4 max-w-2xl text-faint">Reading the book from Creditcoin…</p>;
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

  const clauses: React.ReactNode[] = [];

  if (breached.length > 0) {
    clauses.push(
      <span key="breached">
        {word(breached.length)} covenant{breached.length === 1 ? ' has' : 's have'} been proven{' '}
        <span className="text-breach">breached</span> and the bond slashed.
      </span>,
    );
  }

  if (open.length > 0) {
    clauses.push(
      <span key="open">
        {word(open.length)} claim{open.length === 1 ? ' is' : 's are'} open to challenge
        {soonest !== null ? <> for another {blocksToApproxDuration(soonest)}</> : null}.
      </span>,
    );
  }

  if (clauses.length === 0) {
    clauses.push(
      <span key="quiet">
        Nothing on the book is currently open to challenge. Claims become challengeable when an
        originator asserts repayment.
      </span>,
    );
  }

  return (
    <p className="prose-lead mt-4 max-w-2xl">
      {clauses.map((c, i) => (
        <span key={i}>
          {i > 0 ? ' ' : ''}
          {c}
        </span>
      ))}{' '}
      <span className="text-muted">Anyone may challenge, without permission.</span>
    </p>
  );
}

/**
 * One originator's position.
 *
 * Rendered per originator rather than for the first one only: the book now holds
 * more than one institution, and a page that silently showed a single fund's
 * bond while listing everyone's claims would misstate who is exposed to what.
 */
function PositionStrip({ originator, bondPerLoan }: { originator: Originator; bondPerLoan: bigint }) {
  const free = originator.bond - originator.exposure;
  const openLoans = bondPerLoan > 0n ? originator.exposure / bondPerLoan : 0n;

  const figures: Array<[string, string, string?]> = [
    ['Bond posted', `${formatCtc(originator.bond)} tCTC`],
    ['Exposure', `${formatCtc(originator.exposure)} tCTC`, `${openLoans} open`],
    ['Free bond', `${formatCtc(free)} tCTC`],
  ];

  return (
    <div className="hard-rule border-2 border-ink bg-surface p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="display-md">{originator.name}</h3>
        <span className="text-[11px] text-faint">
          {originator.covenants & 0x01 ? 'CIRCULAR_REPAYMENT · immutable' : 'no covenant'}
        </span>
      </div>

      <dl className="mt-5 grid grid-cols-3 gap-x-6 border-t border-rule pt-4">
        {figures.map(([k, v, hint]) => (
          <div key={k}>
            <dt className="eyebrow">{k}</dt>
            <dd className="tnum mt-1.5 text-[15px] font-medium">{v}</dd>
            {hint ? <dd className="mt-0.5 text-[11px] text-faint">{hint}</dd> : null}
          </div>
        ))}
      </dl>

      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-1 border-t border-rule pt-3">
        <div className="flex items-baseline gap-2">
          <dt className="text-[11px] text-faint">Circular window</dt>
          <dd className="tnum font-mono text-[12px]">{formatBlock(originator.circularWindow)} blocks</dd>
        </div>
        <div className="flex items-baseline gap-2">
          <dt className="text-[11px] text-faint">Challenge window</dt>
          <dd className="tnum font-mono text-[12px]">
            {formatBlock(originator.challengeWindow)} blocks · {blocksToApproxDuration(BigInt(originator.challengeWindow))}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function LoanTable({
  title,
  subtitle,
  loans,
  originatorById,
  currentBlock,
  marked = false,
}: {
  title: string;
  subtitle?: string;
  loans: Loan[];
  originatorById: Map<string, Originator>;
  currentBlock: bigint;
  /** Draw a status rule in the first cell, so attention rows are marked, not just grouped. */
  marked?: boolean;
}) {
  return (
    <section>
      <div className="rule-b flex items-baseline justify-between gap-4 pb-2">
        <Eyebrow>{title}</Eyebrow>
        {subtitle ? (
          <span className="text-[11px] text-faint">{subtitle}</span>
        ) : null}
      </div>

      <div className="-mx-6 overflow-x-auto px-6 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[780px] table-fixed border-collapse text-left">
          <colgroup>
            <col className="w-[9%]" />
            <col className="w-[21%]" />
            <col className="w-[15%]" />
            <col className="w-[12%]" />
            <col className="w-[10%]" />
            <col className="w-[19%]" />
            <col className="w-[14%]" />
          </colgroup>
        <thead>
          <tr className="rule-b">
            {['Loan', 'Originator', 'Borrower', 'Principal', 'Token', 'Status', 'Window'].map((h, i) => (
              <th
                key={h}
                scope="col"
                className={`py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint ${
                  i >= 2 ? 'text-right' : ''
                }`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loans.map((loan) => {
            const originator = originatorById.get(loan.originatorId.toString());
            const meta = STATUS_META[loan.status];
            const challengeable = originator ? isChallengeable(loan, originator, currentBlock) : false;
            const left = originator ? blocksLeftInWindow(loan, originator, currentBlock) : 0n;
            const rule = !marked
              ? ''
              : loan.status === LoanStatus.BREACHED
                ? 'border-l-2 border-l-breach pl-3'
                : 'border-l-2 border-l-accent pl-3';

            return (
              <tr
                key={loan.id.toString()}
                className="rule-b group transition-colors hover:bg-sunken"
              >
                <td className={`py-3.5 ${rule}`}>
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
                <td className="tnum py-3.5 text-right text-[12px] text-muted">
                  {loan.status === LoanStatus.REPAYMENT_CLAIMED ? (
                    challengeable ? (
                      <span title={`${left} Creditcoin blocks remain`}>
                        {blocksToApproxDuration(left)} left
                      </span>
                    ) : (
                      <span className="text-faint">closed</span>
                    )
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </td>
              </tr>
            );
          })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
