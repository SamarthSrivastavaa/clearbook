'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import type { Hex } from 'viem';
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';

import { LoadingRows, NotDeployed, PreviewBanner } from '@/components/States';
import { Button, Eyebrow, Ident, Input, Status, Working } from '@/components/ui';
import { clearbookAbi } from '@/lib/abi';
import { contracts, explorer, isDeployed } from '@/lib/config';
import {
  dataSource,
  isPreview,
  useBookLoans,
  useBookOriginators,
  useBoundTreasuryOwner,
  useCurrentBlock,
  useFactById,
  useParams,
  useVaultFacts,
} from '@/lib/data';
import { decodeRevert } from '@/lib/errors';
import { formatCtc, formatTokenAmount, shortAddress } from '@/lib/format';
import { applyTreasuryBinding, dryRun, type ConditionResult } from '@/lib/predicate';
import { LoanStatus, isChallengeable, type Loan } from '@/lib/protocol';
import { tokenMeta } from '@/lib/token';

/**
 * The challenge console.
 *
 * Structured as an investigation, not a form: select the claim, cite the
 * evidence, watch the covenant evaluate, then submit. The rail carries the
 * sequence because each stage genuinely depends on the one before it.
 *
 * The design commitment: nobody opens a wallet not knowing what will happen.
 * All eleven conditions the contract will evaluate are evaluated here first,
 * from the same chain state, and shown pass or fail. The wallet is the last
 * step, never the first.
 */
export default function ChallengePage() {
  return (
    <Suspense fallback={<LoadingRows rows={4} />}>
      <ChallengeConsole />
    </Suspense>
  );
}

type Phase = 'idle' | 'pending' | 'confirmed' | 'failed';

function ChallengeConsole() {
  const search = useSearchParams();
  const { loans, isLoading } = useBookLoans();
  const { originators } = useBookOriginators();
  const { params } = useParams();
  const currentBlock = useCurrentBlock();
  const { isConnected } = useAccount();

  const [selectedId, setSelectedId] = useState<string>(search.get('loan') ?? '');
  const [fundingInput, setFundingInput] = useState('');

  const loan = useMemo(
    () => loans.find((l) => l.id.toString() === selectedId) ?? null,
    [loans, selectedId],
  );
  const originator = useMemo(
    () => originators.find((o) => o.id === loan?.originatorId) ?? null,
    [originators, loan],
  );

  const fundingFactId = /^0x[0-9a-fA-F]{64}$/.test(fundingInput.trim())
    ? (fundingInput.trim() as Hex)
    : null;

  const { fact: repayment } = useFactById(loan?.repaymentFactId ?? null);
  const { fact: funding, exists: fundingExists } = useFactById(fundingFactId);
  const { originatorId: fundingOwner } = useBoundTreasuryOwner(funding?.from ?? null);

  const result = useMemo(() => {
    if (!loan || !originator || !params || currentBlock === undefined || !fundingFactId) return null;
    const base = dryRun(
      { loan, originator, repayment, funding, fundingFactId, currentBlock },
      params.bondPerLoan,
      params.bountyBps,
    );
    return applyTreasuryBinding(base, fundingOwner, loan.originatorId, funding?.from ?? null);
  }, [loan, originator, params, currentBlock, fundingFactId, repayment, funding, fundingOwner]);

  const { writeContract, data: txHash, error: writeError, reset } = useWriteContract();
  const { isLoading: waiting, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const phase: Phase = writeError ? 'failed' : isSuccess ? 'confirmed' : txHash ? 'pending' : 'idle';

  const submit = () => {
    if (!loan || !fundingFactId || !contracts.clearbook) return;
    writeContract({
      address: contracts.clearbook,
      abi: clearbookAbi,
      functionName: 'challenge',
      args: [loan.id, fundingFactId],
    } as never);
  };

  if (dataSource === 'none') return <NotDeployed />;
  if (isLoading) return <LoadingRows rows={5} />;

  const challengeable = loans.filter(
    (l) =>
      currentBlock !== undefined &&
      originators.some((o) => o.id === l.originatorId && isChallengeable(l, o, currentBlock)),
  );

  // Shown only when nothing is challengeable, as standing proof the console works.
  const breached = loans.filter((l) => l.status === LoanStatus.BREACHED);

  // Rail state per stage, so progress is visible at a glance.
  const stageState = (n: number): 'done' | 'active' | undefined => {
    if (n === 1) return loan ? 'done' : 'active';
    if (n === 2) return !loan ? undefined : fundingFactId ? 'done' : 'active';
    if (n === 3) return !result ? undefined : result.wouldSucceed ? 'done' : 'active';
    if (n === 4) return phase === 'confirmed' ? 'done' : result?.wouldSucceed ? 'active' : undefined;
    return undefined;
  };

  return (
    <div className="space-y-12">
      {isPreview ? <PreviewBanner /> : null}

      <header className="max-w-3xl">
        <Eyebrow>Challenge console</Eyebrow>
        <h1 className="display-lg mt-3">Prove a covenant breach.</h1>
        {/* The argument in one line. The eleven conditions are evaluated in
            front of the reader a few hundred pixels below, which makes the case
            better than a paragraph promising it will. */}
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted">
          No allowlist, no challenger bond, no dispute period.{' '}
          <span className="text-ink">An invalid challenge costs you gas and nothing else.</span>
        </p>
      </header>

      <div className="grid gap-x-14 gap-y-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)] lg:items-start">
      <ol className="rail min-w-0">
        {/* ---------------- 1 · the claim ---------------- */}
        <li className="rail-node pb-12" data-state={stageState(1)}>
          <Stage n="01" title="Select the claim" />
          {challengeable.length === 0 ? (
            <div className="mt-4 max-w-xl space-y-4">
              <p className="text-[13px] leading-relaxed text-muted">
                No claim currently has an open challenge window. A claim becomes challengeable when
                its originator claims a repayment, and stays so until the window closes.
              </p>

              {/*
                An inert console invites the wrong conclusion — that the mechanism is
                theoretical. It is not: a bond has already been slashed here. When there is
                nothing live to challenge, we point at the breach that did execute, because
                that is the honest answer to "does this actually work".
              */}
              {breached.length > 0 ? (
                <div className="border-l-2 border-breach pl-4">
                  <p className="text-[13px] leading-relaxed text-ink">
                    The mechanism has fired on this book. {breached.length === 1 ? 'One claim was' : `${breached.length} claims were`}{' '}
                    challenged successfully and the bond slashed — not a simulation, a settled
                    transaction on Creditcoin.
                  </p>
                  <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
                    {breached.map((l) => (
                      <li key={l.id.toString()}>
                        <Link
                          href={`/loan/${l.id}`}
                          className="text-[13px] text-breach underline decoration-breach/40 underline-offset-4 transition-colors hover:decoration-breach"
                        >
                          Claim #{l.id.toString()} — bond slashed
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <p className="text-[12px] leading-relaxed text-subtle">
                You can still walk the full evaluation without an open window: the{' '}
                <Link href="/registry" className="underline underline-offset-4 hover:text-ink">
                  evidence registry
                </Link>{' '}
                lists every verified fact, and{' '}
                <Link href="/verify" className="underline underline-offset-4 hover:text-ink">
                  verification
                </Link>{' '}
                needs no permission and no open claim.
              </p>
            </div>
          ) : (
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {challengeable.map((l) => (
                <LoanChoice
                  key={l.id.toString()}
                  loan={l}
                  selected={l.id.toString() === selectedId}
                  onSelect={() => {
                    setSelectedId(l.id.toString());
                    setFundingInput('');
                    reset();
                  }}
                />
              ))}
            </div>
          )}
        </li>

        {/* ---------------- 2 · the alleged funding ---------------- */}
        <li className="rail-node pb-12" data-state={stageState(2)}>
          <Stage n="02" title="Cite the funding evidence" />
          <p className="mt-3 max-w-xl text-[13px] leading-relaxed text-muted">
            The transfer you believe funded the payer. It must already be in the vault — anyone may
            put it there. Older facts stay citable by identifier.
          </p>

          <div className="mt-4">
            <div className="max-w-xl">
              <Input
                label="Funding fact identifier"
                value={fundingInput}
                onChange={(v) => {
                  setFundingInput(v);
                  reset();
                }}
                placeholder="0x…"
                invalid={fundingInput.length > 0 && !fundingFactId}
              />
            </div>
            {fundingInput.length > 0 && !fundingFactId ? (
              <p className="mt-2 text-[12px] text-breach">
                A fact identifier is 32 bytes of hex, starting 0x.
              </p>
            ) : null}
            {fundingFactId && !fundingExists ? (
              <p className="mt-2 text-[12px] text-pending">
                No fact with that identifier exists in the vault.
              </p>
            ) : null}

            {funding ? (
              <div className="record mt-4 px-4 py-3">
                <Eyebrow>Cited transfer</Eyebrow>
                <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px]">
                  <span className="ident">{shortAddress(funding.from)}</span>
                  <span className="text-faint" aria-hidden>
                    →
                  </span>
                  <span className="ident">{shortAddress(funding.to)}</span>
                  <span className="tnum font-mono font-medium">
                    {formatTokenAmount(funding.amount, tokenMeta(funding.token).decimals)}{' '}
                    {tokenMeta(funding.token).symbol ?? ''}
                  </span>
                  <span className="text-[12px] text-faint">block {funding.blockHeight.toString()}</span>
                </div>
              </div>
            ) : null}

            <FactPicker
              loan={loan}
              selected={fundingFactId}
              onPick={(v) => {
                setFundingInput(v);
                reset();
              }}
            />
          </div>
        </li>

        {/* ---------------- 3 · the covenant ---------------- */}
        <li className="rail-node pb-12" data-state={stageState(3)}>
          <Stage
            n="03"
            title="Evaluate the covenant"
            aside={
              result
                ? `${result.conditions.filter((c) => c.status === 'pass').length} of 11 satisfied`
                : undefined
            }
          />
          <div className="mt-4 max-w-3xl">
            {!loan ? (
              <Hint>Select a claim above to evaluate it.</Hint>
            ) : !fundingFactId ? (
              <Hint>Cite a funding fact to evaluate the eleven conditions.</Hint>
            ) : !result ? (
              <Working label="Reading chain state…" />
            ) : (
              <ConditionList conditions={result.conditions} />
            )}
          </div>
        </li>

        {/* ---------------- 4 · submission and outcome ---------------- */}
        <li className="rail-node" data-state={stageState(4)}>
          <Stage n="04" title="Submit and settle" />
          <div className="mt-4">
            {!result ? (
              <Hint>The outcome appears once the covenant has been evaluated.</Hint>
            ) : (
              <Outcome
                result={result}
                phase={phase}
                txHash={txHash}
                waiting={waiting}
                writeError={writeError}
                canSubmit={isDeployed && isConnected}
                isConnected={isConnected}
                onSubmit={submit}
                bondPerLoan={params?.bondPerLoan ?? null}
                bountyBps={params?.bountyBps ?? 0}
                loanId={loan!.id}
              />
            )}
          </div>
        </li>
      </ol>

      <ConsoleAside
        originator={originator}
        bondPerLoan={params?.bondPerLoan ?? null}
        bountyBps={params?.bountyBps ?? 0}
      />
      </div>
    </div>
  );
}

/**
 * Context the challenger needs while working, not after.
 *
 * The economics used to appear only at stage four, which meant the one number
 * that decides whether a challenge is worth making was invisible for the three
 * stages where the decision is actually taken. Pinning it also puts the
 * covenant's own text beside the evidence being judged against it.
 */
function ConsoleAside({
  originator,
  bondPerLoan,
  bountyBps,
}: {
  originator: { circularWindow: number; challengeWindow: number } | null;
  bondPerLoan: bigint | null;
  bountyBps: number;
}) {
  const slash = bondPerLoan;
  const bounty = slash !== null ? (slash * BigInt(bountyBps)) / 10_000n : null;
  const sink = slash !== null && bounty !== null ? slash - bounty : null;

  return (
    <aside className="lg:sticky lg:top-24 lg:pt-2" aria-label="Challenge context">
      {slash !== null && bounty !== null && sink !== null ? (
        <div className="hard-xs border-2 border-ink bg-surface p-5">
          <Eyebrow>If the challenge succeeds</Eyebrow>
          <dl className="mt-4 space-y-2.5">
            <StakeRow k="Originator bond" v={`−${formatCtc(slash)} tCTC`} tone="breach" />
            <StakeRow k="Paid to you" v={`+${formatCtc(bounty)} tCTC`} tone="verified" />
            <StakeRow k="Burned" v={`${formatCtc(sink)} tCTC`} />
          </dl>
          <p className="mt-4 border-t border-rule pt-3 text-[11px] leading-relaxed text-faint">
            Computed from the contract&rsquo;s own parameters. An invalid challenge reverts and costs
            you gas only.
          </p>
        </div>
      ) : null}

      <div className="mt-8">
        <Eyebrow>The covenant under test</Eyebrow>
        <p className="mt-3 text-[13px] leading-relaxed text-muted">
          No repayment may come from an address the originator&rsquo;s own treasury funded for at
          least the repayment amount, in the same token, within{' '}
          {originator ? (
            <span className="tnum font-medium text-ink">
              {originator.circularWindow.toLocaleString('en-US')}
            </span>
          ) : (
            'the published number of'
          )}{' '}
          source-chain blocks.
        </p>
        <Link href="/docs/covenant-predicate" className="link mt-3 inline-flex text-[12px]">
          The predicate, formally →
        </Link>
      </div>

      <div className="mt-8 border-t border-rule pt-5">
        <Eyebrow>What a breach establishes</Eyebrow>
        <p className="mt-3 text-[12px] leading-relaxed text-faint">
          That two verified transfers occurred in a specific relationship, and therefore that the
          originator&rsquo;s own published rule was not met. Not intent, not control of either
          address, not the existence of an off-chain loan, and not any violation of law.
        </p>
      </div>
    </aside>
  );
}

function StakeRow({ k, v, tone }: { k: string; v: string; tone?: 'verified' | 'breach' }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[12px] text-muted">{k}</dt>
      <dd
        className={`tnum font-mono text-[13px] font-medium ${
          tone === 'breach' ? 'text-breach' : tone === 'verified' ? 'text-verified' : 'text-ink'
        }`}
      >
        {v}
      </dd>
    </div>
  );
}

function Stage({ n, title, aside }: { n: string; title: string; aside?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-4">
      <div className="flex items-baseline gap-4">
        <span className="ident text-[11px] text-faint">{n}</span>
        <h2 className="display-md">{title}</h2>
      </div>
      {aside ? <span className="text-[12px] text-muted">{aside}</span> : null}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] leading-relaxed text-faint">{children}</p>;
}

function LoanChoice({
  loan,
  selected,
  onSelect,
}: {
  loan: Loan;
  selected: boolean;
  onSelect: () => void;
}) {
  const { symbol, decimals } = tokenMeta(loan.token);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex w-full items-baseline justify-between border px-4 py-3.5 text-left transition-colors ${
        selected ? 'border-ink bg-surface' : 'border-rule bg-surface hover:border-rule-strong'
      }`}
    >
      <span className="font-mono text-[14px] font-medium">
        L-{loan.id.toString().padStart(3, '0')}
      </span>
      <span className="tnum text-[12px] text-muted">
        {formatTokenAmount(loan.principal, decimals)} {symbol ?? ''}
      </span>
    </button>
  );
}

/** Preview only: the fixture facts, so the console can be exercised offline. */
/**
 * The evidence available to cite.
 *
 * Without this a challenger faces an empty field and a 32-byte hex format, with
 * no way to discover what the vault holds. The list is read from the vault's own
 * log, so it shows exactly what is citable — including this loan's own legs,
 * which are citable but will fail the covenant, because learning why is the
 * point of the console.
 */
function FactPicker({
  loan,
  selected,
  onPick,
}: {
  loan: Loan | null;
  selected: Hex | null;
  onPick: (v: string) => void;
}) {
  const { facts, isLoading } = useVaultFacts();

  if (isLoading) {
    return (
      <p className="mt-5 text-[12px] text-faint">Reading citable evidence from the vault…</p>
    );
  }
  if (facts.length === 0) return null;

  const ordered = [...facts].sort((a, b) => Number(a.blockHeight - b.blockHeight));

  return (
    <div className="mt-6">
      <div className="rule-b flex items-baseline justify-between gap-4 pb-2">
        <Eyebrow>Evidence in the vault</Eyebrow>
        <span className="text-[11px] text-faint">
          {ordered.length} verified facts · recent scan
        </span>
      </div>

      <ul>
        {ordered.map((f) => {
          const isSelected = !!selected && selected.toLowerCase() === f.factId.toLowerCase();
          const own =
            loan && loan.disbursementFactId.toLowerCase() === f.factId.toLowerCase()
              ? "this loan's disbursement"
              : loan && loan.repaymentFactId.toLowerCase() === f.factId.toLowerCase()
                ? "this loan's repayment"
                : null;
          const { decimals, symbol } = tokenMeta(f.token);

          return (
            <li key={f.factId}>
              <button
                type="button"
                onClick={() => onPick(f.factId)}
                aria-pressed={isSelected}
                className={`flex w-full flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-rule py-2.5 text-left transition-colors hover:bg-sunken ${
                  isSelected ? 'border-l-2 border-l-accent pl-3' : ''
                }`}
              >
                <span className="ident text-[12px]">{shortAddress(f.from)}</span>
                <span className="text-faint" aria-hidden>
                  →
                </span>
                <span className="ident text-[12px]">{shortAddress(f.to)}</span>
                <span className="tnum font-mono text-[12px] font-medium">
                  {formatTokenAmount(f.amount, decimals)} {symbol ?? ''}
                </span>
                {own ? <span className="text-[11px] text-faint">· {own}</span> : null}
                <span className="tnum ml-auto text-[11px] text-faint">
                  source block {f.blockHeight.toString()}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The eleven conditions, grouped by what they actually test.
 *
 * A flat list of eleven is technically complete and cognitively useless: a
 * reader cannot tell which failure is a formatting mistake and which is the
 * covenant genuinely not being met. The grouping is presentation only — the
 * predicate is untouched, the numbering is the contract's, and every condition
 * keeps its expression and its named error.
 */
const GROUPS: Array<{ name: string; blurb: string; ns: number[] }> = [
  { name: 'Eligibility', blurb: 'Whether this claim can be challenged at all.', ns: [1, 2] },
  { name: 'Identity', blurb: 'The parties must be the parties the covenant names.', ns: [3, 5, 6] },
  { name: 'Value', blurb: 'The same token, and enough of it.', ns: [4, 7] },
  { name: 'Timing', blurb: 'Funding before repayment, inside the published window.', ns: [8, 9] },
  { name: 'Distinct evidence', blurb: 'The cited fact must be a genuinely separate leg.', ns: [10, 11] },
];

function ConditionList({ conditions }: { conditions: ConditionResult[] }) {
  const byN = new Map(conditions.map((c) => [c.n, c]));

  return (
    <div className="rule-t">
      {GROUPS.map((g) => {
        const items = g.ns.map((n) => byN.get(n)).filter((c): c is ConditionResult => !!c);
        if (items.length === 0) return null;

        const failed = items.filter((c) => c.status === 'fail').length;
        const passed = items.filter((c) => c.status === 'pass').length;
        const tone =
          failed > 0 ? 'text-breach' : passed === items.length ? 'text-verified' : 'text-faint';

        return (
          <section key={g.name} className="rule-b py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <div className="flex items-baseline gap-3">
                <span
                  className={`inline-block h-2.5 w-[2px] shrink-0 ${
                    failed > 0 ? 'bg-breach' : passed === items.length ? 'bg-verified' : 'bg-rule-strong'
                  }`}
                  aria-hidden
                />
                <h4 className="text-[13px] font-medium">{g.name}</h4>
                <span className="text-[12px] text-faint">{g.blurb}</span>
              </div>
              <span className={`tnum text-[11px] font-medium ${tone}`}>
                {failed > 0
                  ? `${failed} not satisfied`
                  : passed === items.length
                    ? `${passed} of ${items.length} satisfied`
                    : `${passed} of ${items.length}`}
              </span>
            </div>

            <ol className="mt-2.5 pl-[11px]">
              {items.map((c) => (
                <li key={c.n} className="flex gap-3.5 border-l border-rule py-2 pl-4">
                  <span
                    className={`mt-0.5 w-3.5 shrink-0 text-center text-[12px] font-semibold ${
                      c.status === 'pass'
                        ? 'text-verified'
                        : c.status === 'fail'
                          ? 'text-breach'
                          : 'text-faint'
                    }`}
                    aria-hidden
                  >
                    {c.status === 'pass' ? '✓' : c.status === 'fail' ? '✕' : ''}
                  </span>
                  <span className="ident w-4 shrink-0 pt-px text-[11px] text-faint">{c.n}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] leading-snug">{c.title}</span>
                    <code className="mt-1 block font-mono text-[11px] leading-relaxed text-faint">
                      {c.formal}
                    </code>
                    {c.status === 'fail' ? (
                      <span className="mt-1.5 block text-[12px] leading-relaxed text-breach">
                        {c.observed ? (
                          <>
                            Observed <span className="tnum font-mono">{c.observed}</span>.{' '}
                          </>
                        ) : null}
                        Reverts <code className="font-mono">{c.errorName}</code>.
                      </span>
                    ) : null}
                    <span className="sr-only">
                      {c.status === 'pass'
                        ? 'satisfied'
                        : c.status === 'fail'
                          ? 'not satisfied'
                          : 'not yet evaluated'}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

function Outcome({
  result,
  phase,
  txHash,
  waiting,
  writeError,
  canSubmit,
  isConnected,
  onSubmit,
  bondPerLoan,
  bountyBps,
  loanId,
}: {
  result: ReturnType<typeof dryRun>;
  phase: Phase;
  txHash?: Hex;
  waiting: boolean;
  writeError: Error | null;
  canSubmit: boolean;
  isConnected: boolean;
  onSubmit: () => void;
  bondPerLoan: bigint | null;
  bountyBps: number;
  loanId: bigint;
}) {
  if (phase === 'confirmed' && txHash) {
    return (
      <div className="space-y-6 animate-rail-in">
        <div>
          <Status tone="breach">Covenant breach verified</Status>
          <p className="mt-3 max-w-2xl text-[14px] leading-relaxed">
            The evidence satisfied all eleven conditions. The originator&rsquo;s bond for this claim
            was slashed and your bounty paid, in the same transaction.
          </p>
        </div>
        <Ledger bondPerLoan={bondPerLoan} bountyBps={bountyBps} projected={false} loanId={loanId} />
        <div>
          <Eyebrow className="mb-1.5">Creditcoin transaction</Eyebrow>
          <Ident value={txHash} href={explorer.ccTx(txHash)} label="Challenge transaction" />
        </div>
      </div>
    );
  }

  if (phase === 'failed' && writeError) {
    const decoded = decodeRevert(writeError);
    return (
      <div className="space-y-4 animate-rail-in">
        <Status tone={decoded.userRejected ? 'inert' : 'breach'}>
          {decoded.userRejected ? 'Not submitted' : 'Challenge rejected'}
        </Status>
        <div className="record px-5 py-4">
          <Eyebrow>{decoded.userRejected ? 'Reason' : 'On-chain error'}</Eyebrow>
          <div className="mt-2 font-mono text-[14px]">{decoded.name}</div>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted">
            {decoded.explanation}
          </p>
          {decoded.condition ? (
            <p className="mt-2 text-[12px] text-faint">
              This is condition {decoded.condition} of the covenant predicate.
            </p>
          ) : null}
        </div>
        <p className="text-[12px] text-muted">
          No state changed. A rejected challenge costs only gas.
        </p>
      </div>
    );
  }

  if (phase === 'pending' || waiting) {
    return (
      <div className="space-y-3">
        <Working label="Submitted — waiting for Creditcoin confirmation" />
        {txHash ? <Ident value={txHash} href={explorer.ccTx(txHash)} label="Challenge transaction" /> : null}
        <p className="max-w-xl text-[12px] leading-relaxed text-muted">
          One Creditcoin transaction. The contract re-evaluates every condition on-chain; the
          evaluation above does not decide the outcome.
        </p>
      </div>
    );
  }

  const failure = result.firstFailure;

  return (
    <div className="space-y-6">
      {result.wouldSucceed ? (
        <>
          <div>
            <Status tone="verified">All eleven conditions satisfied</Status>
            <p className="mt-3 max-w-2xl text-[14px] leading-relaxed">
              Submitting would prove a breach of <code className="font-mono">CIRCULAR_REPAYMENT</code>.
              The contract re-evaluates every condition on-chain before paying anything.
            </p>
          </div>
          <Ledger bondPerLoan={bondPerLoan} bountyBps={bountyBps} projected loanId={loanId} />
        </>
      ) : failure ? (
        <div>
          <Status tone="breach">Would revert at condition {failure.n}</Status>
          <div className="record mt-4 px-5 py-4">
            <p className="text-[14px] leading-relaxed">{failure.title}</p>
            {failure.observed ? (
              <p className="mt-2 text-[12px] text-breach">Observed: {failure.observed}.</p>
            ) : null}
            <p className="mt-2 text-[12px] text-muted">
              The contract would revert <code className="font-mono">{failure.errorName}</code>. The
              wallet is not opened, so this costs nothing.
            </p>
          </div>
        </div>
      ) : (
        <Working label="Evaluating conditions…" />
      )}

      <div className="flex flex-wrap items-center gap-4">
        <Button variant="primary" onClick={onSubmit} disabled={!result.wouldSucceed || !canSubmit}>
          Submit challenge
        </Button>
        {!isDeployed ? (
          <span className="text-[12px] text-muted">
            Submission requires a deployment. Nothing here is simulated.
          </span>
        ) : !isConnected ? (
          <span className="text-[12px] text-muted">Connect a wallet to submit.</span>
        ) : null}
      </div>
    </div>
  );
}

/** The economic consequence, as a ledger. Institutional, never celebratory. */
function Ledger({
  bondPerLoan,
  bountyBps,
  projected,
  loanId,
}: {
  bondPerLoan: bigint | null;
  bountyBps: number;
  projected: boolean;
  loanId: bigint;
}) {
  if (!bondPerLoan) return null;
  const slash = bondPerLoan;
  const bounty = (slash * BigInt(bountyBps)) / 10000n;
  const sink = slash - bounty;

  const rows = [
    { label: 'Originator bond', value: `−${formatCtc(slash)} tCTC`, tone: 'breach' as const },
    { label: 'Your bounty', value: `+${formatCtc(bounty)} tCTC`, tone: 'verified' as const },
    { label: 'Protocol sink', value: `${formatCtc(sink)} tCTC`, tone: 'inert' as const },
  ];

  return (
    <div className="max-w-md">
      <Eyebrow className="mb-2">
        {projected ? 'Projected economic consequence' : 'Economic consequence'}
      </Eyebrow>
      <dl className="rule-t">
        {rows.map((r) => (
          <div key={r.label} className="rule-b flex items-baseline justify-between py-2.5">
            <dt className="text-[13px] text-muted">{r.label}</dt>
            <dd
              className={`tnum font-mono text-[14px] ${
                r.tone === 'breach' ? 'text-breach' : r.tone === 'verified' ? 'text-verified' : 'text-muted'
              }`}
            >
              {r.value}
            </dd>
          </div>
        ))}
        <div className="rule-b flex items-baseline justify-between py-2.5">
          <dt className="text-[13px] text-muted">Claim status</dt>
          <dd className="text-[13px]">
            <Link href={`/loan/${loanId}`} className="link">
              {LoanStatus[LoanStatus.BREACHED]}
            </Link>
          </dd>
        </div>
      </dl>
      {projected ? (
        <p className="mt-2 text-[11px] text-faint">
          Computed from the contract&rsquo;s own parameters. Not a result — the chain decides.
        </p>
      ) : null}
    </div>
  );
}
