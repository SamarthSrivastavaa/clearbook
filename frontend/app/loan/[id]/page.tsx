'use client';

import Link from 'next/link';
import { useParams as useRouteParams } from 'next/navigation';
import { useMemo } from 'react';

import { EvidenceFlow, NotClaimed, type EvidenceItem } from '@/components/Evidence';
import { LoadingRows, NotDeployed, PreviewBanner } from '@/components/States';
import { Callout, Disclosure, Empty, Eyebrow, Ident, Section, Status } from '@/components/ui';
import { SOURCE_CHAIN, explorer, isReferenceChallenger, CC_BLOCK_SECONDS } from '@/lib/config';
import {
  dataSource,
  isPreview,
  useCurrentBlock,
  useFactById,
  useBreachEvidence,
  useLoanById,
  useOriginatorById,
  useParams,
} from '@/lib/data';
import { tokenMeta } from '@/lib/token';
import { blocksToApproxDuration, formatBlock, formatCtc, formatTokenAmount, shortAddress } from '@/lib/format';
import {
  CIRCULAR_REPAYMENT_MEANING,
  LoanStatus,
  STATUS_META,
  blocksLeftInWindow,
  hasFact,
  isChallengeable,
} from '@/lib/protocol';

/**
 * The loan record.
 *
 * Reading order is deliberate: what is this → what is its status → why → show me
 * the evidence → show me the internals. Cryptographic detail is available but
 * never in the way.
 */
export default function LoanPage() {
  const route = useRouteParams<{ id: string }>();
  const loanId = useMemo(() => {
    try {
      return BigInt(route.id);
    } catch {
      return null;
    }
  }, [route.id]);

  const { loan, isLoading } = useLoanById(loanId);
  const { originator } = useOriginatorById(loan?.originatorId ?? null);
  const { params } = useParams();
  const currentBlock = useCurrentBlock();

  const { fact: disbursement } = useFactById(loan?.disbursementFactId ?? null);
  const { fact: repayment } = useFactById(hasFact(loan?.repaymentFactId) ? loan!.repaymentFactId : null);

  // A breached loan must show the evidence that convicted it. The funding fact
  // lives only in the CovenantBreached log, so it is read separately.
  const { breach } = useBreachEvidence(
    loan?.status === LoanStatus.BREACHED ? loanId : null,
    loan?.claimBlock ?? null,
  );
  const { fact: funding } = useFactById(breach?.fundingFactId ?? null);

  if (dataSource === 'none') return <NotDeployed />;
  if (isLoading) return <LoadingRows rows={6} />;
  if (!loan) {
    return (
      <Empty title={`No loan L-${route.id}`}>
        Nothing is registered at that identifier. Loans appear once their disbursement evidence has
        been verified on-chain.
      </Empty>
    );
  }

  const meta = STATUS_META[loan.status];
  const challengeable = originator && currentBlock ? isChallengeable(loan, originator, currentBlock) : false;
  const windowLeft =
    originator && currentBlock ? blocksLeftInWindow(loan, originator, currentBlock) : null;

  // Token metadata is only known for tokens we can identify. Rather than assume
  // 18 decimals and print a wrong figure, unknown tokens show the raw integer.
  const { decimals: tokenDecimals, symbol: tokenSymbol } = tokenMeta(loan.token);

  const items: EvidenceItem[] = [];
  if (disbursement && loan.disbursementFactId) {
    items.push({
      factId: loan.disbursementFactId,
      fact: disbursement,
      role: 'disbursement',
      tokenDecimals,
      tokenSymbol,
      interpretation:
        `Clearbook treats this transfer as the disbursement of loan L-${loan.id}. It qualified because it left an ` +
        `address bound to this originator by signature, its recipient equals the declared borrower, its token equals ` +
        `the declared token, and its amount equals the principal exactly.`,
    });
  }
  if (repayment && hasFact(loan.repaymentFactId)) {
    items.push({
      factId: loan.repaymentFactId,
      fact: repayment,
      role: 'repayment',
      tokenDecimals,
      tokenSymbol,
      interpretation:
        `Clearbook treats this transfer as the repayment claim for loan L-${loan.id}. It qualified because it arrived ` +
        `at a bound treasury, in the declared token, for at least the principal. Whether it satisfies the covenant is a ` +
        `separate question, decided by challenge.`,
    });
  }
  if (breach && funding) {
    items.push({
      factId: breach.fundingFactId,
      fact: funding,
      role: 'funding',
      emphasis: true,
      tokenDecimals,
      tokenSymbol,
      interpretation:
        `This is the transfer the challenger cited. Clearbook treats it as a funding leg because it left a treasury ` +
        `bound to this originator, arrived at the address that later paid, in the same token, for at least the ` +
        `repayment amount, and fell inside the window the originator published. Its existence is what breached the ` +
        `covenant.`,
    });
  }

  return (
    <div className="space-y-12">
      {isPreview ? <PreviewBanner /> : null}

      {/* --- WHAT IS THIS, AND WHAT IS ITS STATUS --- */}
      <header>
        <Link href="/book" className="text-[12px] text-muted underline-offset-4 hover:underline">
          ← Credit book
        </Link>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-6">
          <div>
            <Eyebrow>Loan record</Eyebrow>
            <h1 className="mt-2 font-mono text-[34px] font-semibold leading-none tracking-tight">
              L-{loan.id.toString().padStart(3, '0')}
            </h1>
            {originator ? (
              <p className="mt-2 text-[13px] text-muted">
                Originated by <span className="text-ink">{originator.name}</span>
              </p>
            ) : null}
          </div>

          <div className="text-right">
            <Status tone={meta.tone}>{meta.label}</Status>
            <p className="mt-2 max-w-xs text-[12px] leading-relaxed text-muted">
              {meta.description}
            </p>
          </div>
        </div>

        <dl className="rule-t rule-b mt-8 grid grid-cols-2 divide-x divide-rule sm:grid-cols-4">
          <Cell label="Principal">
            <span className="tnum text-[15px] font-medium">
              {formatTokenAmount(loan.principal, tokenDecimals)} {tokenSymbol ?? ''}
            </span>
          </Cell>
          <Cell label="Token">
            <a
              href={explorer.sourceToken(loan.token)}
              target="_blank"
              rel="noreferrer noopener"
              className="ident ident-link"
              title={loan.token}
            >
              {tokenSymbol ? `${tokenSymbol} · ${shortAddress(loan.token)}` : shortAddress(loan.token)}
            </a>
          </Cell>
          <Cell label="Borrower">
            <a
              href={explorer.sourceAddress(loan.borrower)}
              target="_blank"
              rel="noreferrer noopener"
              className="ident ident-link"
              title={loan.borrower}
            >
              {shortAddress(loan.borrower)}
            </a>
          </Cell>
          <Cell label="Source chain">
            <span className="text-[13px]">{SOURCE_CHAIN.name}</span>
          </Cell>
        </dl>
      </header>

      {/* --- WHY: the covenant, as expected vs observed --- */}
      {originator ? (
        <CovenantPanel
          loan={loan}
          circularWindow={originator.circularWindow}
          challengeable={challengeable}
          windowLeft={windowLeft}
          bondPerLoan={params?.bondPerLoan ?? null}
          breach={breach}
          challengeLagBlocks={
            breach && funding?.ccBlock ? breach.block - funding.ccBlock : null
          }
        />
      ) : null}

      {/* --- SHOW ME THE EVIDENCE --- */}
      <Section
        title="Evidence"
        aside={`${items.length} verified ${items.length === 1 ? 'fact' : 'facts'}`}
      >
        {items.length === 0 ? (
          <Empty title="No evidence loaded">
            This loan cites verified facts, but they could not be read from the vault.
          </Empty>
        ) : (
          <EvidenceFlow items={items} />
        )}
      </Section>

      {/* --- WHAT THIS DOES NOT ESTABLISH --- */}
      <Section title="Not claimed">
        <p className="mb-4 max-w-2xl text-[13px] leading-relaxed text-muted">
          The evidence above establishes what it establishes and nothing further. Specifically, it
          does not establish:
        </p>
        <NotClaimed
          items={[
            'That any address above belongs to any person, company or fund. A bound treasury is an address that produced a signature.',
            'That an off-chain loan agreement exists. A verified transfer is not a loan.',
            'That anyone intended anything. On-chain evidence cannot establish intent.',
            'That any law was broken.',
            'That this book is complete. Merkle inclusion proofs cannot show that a transaction did not occur, so Clearbook never certifies a book as clean.',
          ]}
        />
      </Section>

      {/* --- SHOW ME THE INTERNALS --- */}
      <Section title="Technical detail">
        <Disclosure summary="Protocol identifiers and state" count={`L-${loan.id}`}>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Cell label="Loan id" flush>
              <span className="ident">{loan.id.toString()}</span>
            </Cell>
            <Cell label="Originator id" flush>
              <span className="ident">{loan.originatorId.toString()}</span>
            </Cell>
            <Cell label="Status enum" flush>
              <span className="ident">
                {loan.status} · {LoanStatus[loan.status]}
              </span>
            </Cell>
            <Cell label="Maturity block (Creditcoin)" flush>
              <span className="ident">{formatBlock(loan.maturityBlock)}</span>
            </Cell>
            <Cell label="Claim block (Creditcoin)" flush>
              <span className="ident">
                {loan.claimBlock === 0n ? 'not claimed' : formatBlock(loan.claimBlock)}
              </span>
            </Cell>
            <Cell label="Bond at risk" flush>
              <span className="ident">
                {params ? `${formatCtc(params.bondPerLoan)} tCTC` : '—'}
              </span>
            </Cell>
            <div className="sm:col-span-2">
              <Cell label="Disbursement factId" flush>
                <Ident value={loan.disbursementFactId} label="disbursementFactId" lead={14} tail={10} />
              </Cell>
            </div>
            {hasFact(loan.repaymentFactId) ? (
              <div className="sm:col-span-2">
                <Cell label="Repayment factId" flush>
                  <Ident value={loan.repaymentFactId} label="repaymentFactId" lead={14} tail={10} />
                </Cell>
              </div>
            ) : null}
          </dl>
        </Disclosure>

        <Disclosure summary="How a fact is identified">
          <p className="max-w-2xl text-[13px] leading-relaxed text-muted">
            A fact&rsquo;s identity is{' '}
            <code className="font-mono text-[12px] text-ink">
              keccak256(abi.encode(chainKey, blockHeight, txIndex, logIndex))
            </code>
            . The log index is transaction-local — an index into the receipt&rsquo;s own log array,
            not the block-global index that <code className="font-mono text-[12px]">eth_getLogs</code>{' '}
            returns. This is deliberately stricter than the reference implementation, which keys at
            transaction level: one transaction routinely carries several relevant transfers, and a
            transaction-level key would let the first one ingested lock out the rest.
          </p>
        </Disclosure>
      </Section>
    </div>
  );
}

function Cell({
  label,
  children,
  flush = false,
}: {
  label: string;
  children: React.ReactNode;
  flush?: boolean;
}) {
  return (
    <div className={flush ? 'min-w-0' : 'min-w-0 px-4 py-4 first:pl-0'}>
      <dt className="eyebrow">{label}</dt>
      <dd className="tnum mt-1.5">{children}</dd>
    </div>
  );
}

/** Expected versus observed, so the covenant is legible without reading Solidity. */
function CovenantPanel({
  loan,
  circularWindow,
  challengeable,
  windowLeft,
  bondPerLoan,
  breach,
  challengeLagBlocks,
}: {
  loan: import('@/lib/protocol').Loan;
  circularWindow: number;
  challengeable: boolean;
  windowLeft: bigint | null;
  bondPerLoan: bigint | null;
  breach: import('@/lib/hooks').BreachEvidence | null;
  /** Blocks between the funding evidence being stored and the challenge landing. */
  challengeLagBlocks: bigint | null;
}) {
  const breached = loan.status === LoanStatus.BREACHED;

  return (
    <Section title="Covenant · CIRCULAR_REPAYMENT" aside="Published at registration · immutable">
      <div className="grid gap-px bg-rule lg:grid-cols-2">
        <div className="bg-paper py-6 pr-6 lg:pl-0">
          <Eyebrow>Declared</Eyebrow>
          <p className="mt-3 max-w-md text-[14px] leading-relaxed">
            No repayment may come from an address this originator&rsquo;s own treasury funded for at
            least the repayment amount, in the same token, within{' '}
            <span className="tnum font-medium">{formatBlock(circularWindow)}</span> source-chain
            blocks.
          </p>
          <p className="mt-3 max-w-md text-[13px] leading-relaxed text-muted">
            Published at registration and immutable thereafter. A rule you can change after
            publishing is not a covenant.
          </p>
        </div>

        <div className="bg-paper p-6">
          <Eyebrow>Observed</Eyebrow>
          {breached ? (
            <p className="mt-3 max-w-md text-[14px] leading-relaxed">
              A funding leg was proven: the bound treasury sent the payer at least the repayment
              amount, in the same token, inside the window.
            </p>
          ) : hasFact(loan.repaymentFactId) ? (
            <p className="mt-3 max-w-md text-[14px] leading-relaxed">
              A repayment has been claimed and its evidence verified. No funding leg has been cited.
            </p>
          ) : (
            <p className="mt-3 max-w-md text-[14px] leading-relaxed">
              No repayment has been claimed, so there is nothing to evaluate yet.
            </p>
          )}
          <p className="mt-3 max-w-md text-[13px] leading-relaxed text-muted">
            {breached
              ? 'The covenant was not met.'
              : hasFact(loan.repaymentFactId)
                ? 'The covenant holds unless someone proves otherwise before the window closes.'
                : 'The covenant activates when a repayment is claimed.'}
          </p>
        </div>

        <div className="bg-paper py-6 pr-6 lg:col-span-2 lg:pl-0">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <Eyebrow>Result</Eyebrow>
              <div className="mt-3">
                {/* A slashed bond is the loudest outcome in the product; it gets
                    the same weight here as it does on the landing page. */}
                {breached ? (
                  <p className="verdict verdict-breach">
                    <span className="inline-block h-[0.9em] w-[3px] shrink-0 bg-breach" aria-hidden />
                    Covenant breached
                  </p>
                ) : hasFact(loan.repaymentFactId) ? (
                  <Status tone="pending">Not disproven</Status>
                ) : (
                  <Status tone="inert">Not evaluated</Status>
                )}
              </div>
              {breached && bondPerLoan ? (
                <p className="tnum mt-3 text-[13px] text-muted">
                  Bond slashed: {formatCtc(bondPerLoan)} tCTC
                </p>
              ) : null}
              {breached && breach ? (
                <p className="mt-1.5 text-[12px] text-faint">
                  Proven by{' '}
                  <a
                    href={explorer.ccAddress(breach.challenger)}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="ident ident-link"
                    title={breach.challenger}
                  >
                    {shortAddress(breach.challenger)}
                  </a>{' '}
                  in{' '}
                  <a
                    href={explorer.ccTx(breach.txHash)}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="ident ident-link"
                  >
                    one transaction
                  </a>
                  .
                </p>
              ) : null}
              {/*
                The gap between evidence becoming citable and enforcement
                landing. It is the honest measure of how long a breach stayed
                un-acted-on, and the only number that distinguishes a book
                somebody watches from one nobody does.
              */}
              {breached && challengeLagBlocks !== null ? (
                <p className="tnum mt-1.5 text-[12px] text-faint">
                  Challenged {challengeLagBlocks.toString()} Creditcoin blocks after the evidence
                  became citable
                  <span className="text-subtle">
                    {' '}
                    (~{Math.max(1, Math.round((Number(challengeLagBlocks) * CC_BLOCK_SECONDS) / 60))} min)
                  </span>
                  .
                </p>
              ) : null}
              {/*
                Naming the reference challenger matters only because a reader
                would otherwise see an unfamiliar address. It is deliberately
                phrased as something anyone runs, not as a service Clearbook
                operates — the protocol does not know this account.
              */}
              {breached && breach && isReferenceChallenger(breach.challenger) ? (
                <p className="mt-1.5 max-w-md text-[12px] leading-relaxed text-faint">
                  That address is the reference challenger — an open process anyone can run. It holds
                  no privilege here; it called the same function the console does.
                </p>
              ) : null}
            </div>

            {challengeable && windowLeft !== null ? (
              <div className="text-right">
                <p className="mb-3 text-[12px] leading-relaxed text-muted">
                  Challenge window closes in{' '}
                  <span className="tnum text-ink">{blocksToApproxDuration(windowLeft)}</span>
                </p>
                <Link
                  href={`/challenge?loan=${loan.id}`}
                  className="inline-flex h-10 items-center border border-ink bg-ink px-5 text-[13px] font-medium text-paper transition-colors hover:bg-black"
                >
                  Open challenge console
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-8">
        <Callout tone="inert" title="What a breach of this covenant means">
          {CIRCULAR_REPAYMENT_MEANING}
        </Callout>
      </div>
    </Section>
  );
}
