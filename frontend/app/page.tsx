'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { ScenarioGuide } from '@/components/ScenarioGuide';
import { LoadingRows, NotDeployed, PreviewBanner, RpcError } from '@/components/States';
import { Eyebrow, Empty, Ident, Status } from '@/components/ui';
import { DEMO_MODE, SOURCE_CHAIN, explorer } from '@/lib/config';
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
 * is "what needs my attention?", so anything challengeable or breached is lifted
 * to the top and everything else keeps ledger order.
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
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <div>
            <Eyebrow>Portfolio</Eyebrow>
            <h1 className="mt-2 text-[28px] font-semibold leading-none tracking-tight">
              {primary ? primary.name : 'The Book'}
            </h1>
          </div>
          <p className="max-w-md text-[13px] leading-relaxed text-ink-muted">
            Every claim below cites a source-chain transfer whose inclusion was verified by the
            Creditcoin Block Prover precompile. Nothing here is self-reported.
          </p>
        </div>

        {DEMO_MODE && !isPreview ? (
          <div className="mt-6 border-l-2 border-pending bg-pending-bg px-4 py-2.5 text-[12px] text-ink">
            <span className="font-semibold uppercase tracking-wider text-pending">
              Staged test data ·{' '}
            </span>
            The {SOURCE_CHAIN.name} transactions backing this book were created by us for
            demonstration. They are real on-chain transfers, not fabricated records, and they
            describe no real borrower.
          </div>
        ) : null}
      </header>

      {primary && params ? <PositionStrip originator={primary} bondPerLoan={params.bondPerLoan} /> : null}

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

/** The originator's position, as a definition strip. Not cards. */
function PositionStrip({ originator, bondPerLoan }: { originator: Originator; bondPerLoan: bigint }) {
  const free = originator.bond - originator.exposure;
  const openLoans = bondPerLoan > 0n ? originator.exposure / bondPerLoan : 0n;

  const items: Array<{ label: string; value: React.ReactNode; hint?: string }> = [
    { label: 'Bond posted', value: `${formatCtc(originator.bond)} tCTC` },
    {
      label: 'Exposure',
      value: `${formatCtc(originator.exposure)} tCTC`,
      hint: `${openLoans} open loan${openLoans === 1n ? '' : 's'}`,
    },
    { label: 'Free bond', value: `${formatCtc(free)} tCTC` },
    {
      label: 'Covenant',
      value: 'CIRCULAR_REPAYMENT',
      hint: originator.covenants & 0x01 ? 'opted in, immutable' : 'not opted in',
    },
    {
      label: 'Circular window',
      value: `${formatBlock(originator.circularWindow)} blocks`,
      hint: 'source chain',
    },
    {
      label: 'Challenge window',
      value: `${formatBlock(originator.challengeWindow)} blocks`,
      hint: blocksToApproxDuration(BigInt(originator.challengeWindow)),
    },
  ];

  return (
    <div className="rule-t rule-b grid grid-cols-2 divide-x divide-rule sm:grid-cols-3 lg:grid-cols-6">
      {items.map((item) => (
        <div key={item.label} className="px-4 py-4 first:pl-0">
          <Eyebrow>{item.label}</Eyebrow>
          <div className="tnum mt-1.5 text-[15px] font-medium">{item.value}</div>
          {item.hint ? (
            <div className="mt-0.5 text-[11px] text-ink-faint">{item.hint}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function LoanTable({
  title,
  subtitle,
  loans,
  originatorById,
  currentBlock,
}: {
  title: string;
  subtitle?: string;
  loans: Loan[];
  originatorById: Map<string, Originator>;
  currentBlock: bigint;
}) {
  return (
    <section>
      <div className="rule-b flex items-baseline justify-between gap-4 pb-2">
        <Eyebrow>{title}</Eyebrow>
        {subtitle ? (
          <span className="text-[11px] text-ink-faint">{subtitle}</span>
        ) : null}
      </div>

      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="rule-b">
            {['Loan', 'Borrower', 'Principal', 'Token', 'Status', 'Window'].map((h, i) => (
              <th
                key={h}
                scope="col"
                className={`py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint ${
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

            return (
              <tr
                key={loan.id.toString()}
                className="rule-b group transition-colors hover:bg-surface-sunken"
              >
                <td className="py-3.5">
                  <Link
                    href={`/loan/${loan.id}`}
                    className="font-mono text-[13px] font-medium underline decoration-transparent underline-offset-4 transition-colors group-hover:decoration-ink"
                  >
                    L-{loan.id.toString().padStart(3, '0')}
                  </Link>
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
                <td className="tnum py-3.5 text-right text-[12px] text-ink-muted">
                  {loan.status === LoanStatus.REPAYMENT_CLAIMED ? (
                    challengeable ? (
                      <span title={`${left} Creditcoin blocks remain`}>
                        {blocksToApproxDuration(left)} left
                      </span>
                    ) : (
                      <span className="text-ink-faint">closed</span>
                    )
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
