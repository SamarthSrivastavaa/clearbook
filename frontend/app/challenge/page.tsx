'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import type { Hex } from 'viem';
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';

import { LoadingRows, NotDeployed, PreviewBanner } from '@/components/States';
import { Button, Callout, Empty, Eyebrow, Ident, Input, Section, Status, Working } from '@/components/ui';
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
} from '@/lib/data';
import { FIXTURE_FACTS, factIdOf } from '@/lib/fixtures';
import { decodeRevert } from '@/lib/errors';
import { formatCtc, formatTokenAmount, shortAddress } from '@/lib/format';
import { applyTreasuryBinding, dryRun, type ConditionResult } from '@/lib/predicate';
import { LoanStatus, isChallengeable, type Loan } from '@/lib/protocol';
import { tokenMeta } from '@/lib/token';

/**
 * The challenge console.
 *
 * The design intent: nobody should ever open a wallet not knowing what will
 * happen. Every one of the eleven conditions the contract will evaluate is
 * evaluated here first, from the same chain state, and shown pass or fail. The
 * wallet is the last step, not the first.
 */
export default function ChallengePage() {
  return (
    <Suspense fallback={<LoadingRows rows={4} />}>
      <ChallengeConsole />
    </Suspense>
  );
}

type Phase = 'idle' | 'submitting' | 'pending' | 'confirmed' | 'failed';

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

  // --- submission lifecycle ---
  const { writeContract, data: txHash, error: writeError, reset } = useWriteContract();
  const { isLoading: waiting, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const phase: Phase = writeError
    ? 'failed'
    : isSuccess
      ? 'confirmed'
      : txHash
        ? 'pending'
        : 'idle';

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

  return (
    <div className="space-y-10">
      {isPreview ? <PreviewBanner /> : null}

      <header className="max-w-3xl">
        <Eyebrow>Challenge console</Eyebrow>
        <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight">
          Prove a covenant breach.
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed text-ink-muted">
          Anyone may challenge. There is no allowlist, no challenger bond, and no dispute period. The
          contract evaluates eleven conditions over verified evidence and either slashes the
          originator&rsquo;s bond or reverts. An invalid challenge costs you gas and nothing else.
        </p>
      </header>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        {/* ---------------- selection ---------------- */}
        <div className="space-y-8">
          <Section title="1 · Claim">
            {challengeable.length === 0 ? (
              <p className="text-[13px] leading-relaxed text-ink-muted">
                No loan currently has an open challenge window. A loan becomes challengeable when its
                originator claims a repayment, and stays so until the window closes.
              </p>
            ) : (
              <div className="space-y-2">
                {challengeable.map((l) => (
                  <LoanChoice
                    key={l.id.toString()}
                    loan={l}
                    selected={l.id.toString() === selectedId}
                    onSelect={() => {
                      setSelectedId(l.id.toString());
                      reset();
                    }}
                  />
                ))}
              </div>
            )}
          </Section>

          <Section title="2 · Funding evidence">
            <p className="mb-4 text-[13px] leading-relaxed text-ink-muted">
              Cite the verified transfer you believe funded the payer. It must already exist in the
              vault — evidence is ingested before it can be cited.
            </p>
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

            {isPreview ? <PreviewFactPicker onPick={setFundingInput} /> : null}
          </Section>
        </div>

        {/* ---------------- evaluation ---------------- */}
        <div className="space-y-8">
          <Section
            title="3 · Covenant evaluation"
            aside={result ? `${result.conditions.filter((c) => c.status === 'pass').length} of 11 satisfied` : undefined}
          >
            {!loan ? (
              <Empty title="Select a claim">
                Choose a loan with an open challenge window to evaluate it.
              </Empty>
            ) : !fundingFactId ? (
              <Empty title="Cite funding evidence">
                Paste the identifier of the verified transfer you believe funded the payer.
              </Empty>
            ) : !result ? (
              <Working label="Reading chain state…" />
            ) : (
              <ConditionList conditions={result.conditions} />
            )}
          </Section>

          {result && loan ? (
            <Section title="4 · Outcome">
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
                loanId={loan.id}
              />
            </Section>
          ) : null}
        </div>
      </div>
    </div>
  );
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
      className={`flex w-full items-baseline justify-between border px-4 py-3 text-left transition-colors ${
        selected ? 'border-ink bg-surface' : 'border-rule bg-surface hover:border-rule-strong'
      }`}
    >
      <span className="font-mono text-[13px] font-medium">
        L-{loan.id.toString().padStart(3, '0')}
      </span>
      <span className="tnum text-[12px] text-ink-muted">
        {formatTokenAmount(loan.principal, decimals)} {symbol ?? ''}
      </span>
    </button>
  );
}

/** Preview only: the fixture facts, so the console can be exercised offline. */
function PreviewFactPicker({ onPick }: { onPick: (v: string) => void }) {
  const options = [
    { label: 'Treasury → payer (loan B funding leg)', fact: FIXTURE_FACTS.bFunding },
    { label: 'Faucet → borrower (loan A, unbound source)', fact: FIXTURE_FACTS.aFaucet },
    { label: 'Treasury → borrower (loan A disbursement)', fact: FIXTURE_FACTS.aDisburse },
  ];
  return (
    <div className="mt-5">
      <Eyebrow className="mb-2">Preview fixtures</Eyebrow>
      <div className="space-y-1.5">
        {options.map((o) => (
          <button
            key={o.label}
            type="button"
            onClick={() => onPick(factIdOf(o.fact))}
            className="block w-full text-left text-[12px] text-ink-muted underline decoration-rule-strong underline-offset-4 transition-colors hover:text-ink"
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ConditionList({ conditions }: { conditions: ConditionResult[] }) {
  return (
    <ol className="rule-t">
      {conditions.map((c) => (
        <li key={c.n} className="rule-b flex gap-4 py-3">
          <span
            className={`mt-0.5 w-4 shrink-0 text-center text-[12px] font-semibold ${
              c.status === 'pass'
                ? 'text-verified'
                : c.status === 'fail'
                  ? 'text-breach'
                  : 'text-ink-faint'
            }`}
            aria-hidden
          >
            {c.status === 'pass' ? '✓' : c.status === 'fail' ? '✕' : '·'}
          </span>
          <span className="ident w-5 shrink-0 pt-px text-[11px]">{c.n}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] leading-snug text-ink">{c.title}</span>
            <code className="mt-1 block font-mono text-[11px] leading-relaxed text-ink-faint">
              {c.formal}
            </code>
            {c.status === 'fail' ? (
              <span className="mt-1.5 block text-[12px] text-breach">
                {c.observed ? `Observed: ${c.observed}. ` : ''}Reverts{' '}
                <code className="font-mono">{c.errorName}</code>.
              </span>
            ) : null}
            <span className="sr-only">
              {c.status === 'pass' ? 'satisfied' : c.status === 'fail' ? 'not satisfied' : 'unknown'}
            </span>
          </span>
        </li>
      ))}
    </ol>
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
  // --- terminal: confirmed on-chain ---
  if (phase === 'confirmed' && txHash) {
    return (
      <div className="space-y-6">
        <div>
          <Status tone="breach">Covenant breach verified</Status>
          <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-ink">
            The evidence satisfied all eleven conditions. The originator&rsquo;s bond for this loan
            was slashed and your bounty was paid in the same transaction.
          </p>
        </div>
        <Ledger
          bondPerLoan={bondPerLoan}
          bountyBps={bountyBps}
          projected={false}
          loanId={loanId}
        />
        <div>
          <Eyebrow className="mb-1.5">Creditcoin transaction</Eyebrow>
          <Ident value={txHash} href={explorer.ccTx(txHash)} label="Challenge transaction" />
        </div>
      </div>
    );
  }

  // --- terminal: the chain refused ---
  if (phase === 'failed' && writeError) {
    const decoded = decodeRevert(writeError);
    return (
      <div className="space-y-4">
        <Status tone={decoded.userRejected ? 'inert' : 'breach'}>
          {decoded.userRejected ? 'Not submitted' : 'Challenge rejected'}
        </Status>
        <div className="record px-5 py-4">
          <Eyebrow>{decoded.userRejected ? 'Reason' : 'On-chain error'}</Eyebrow>
          <div className="mt-2 font-mono text-[13px] text-ink">{decoded.name}</div>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-ink-muted">
            {decoded.explanation}
          </p>
          {decoded.condition ? (
            <p className="mt-2 text-[12px] text-ink-faint">
              This is condition {decoded.condition} of the covenant predicate.
            </p>
          ) : null}
        </div>
        <p className="text-[12px] text-ink-muted">
          No state changed. A rejected challenge costs only gas.
        </p>
      </div>
    );
  }

  // --- in flight ---
  if (phase === 'pending' || waiting) {
    return (
      <div className="space-y-3">
        <Working label="Challenge submitted — waiting for Creditcoin confirmation" />
        {txHash ? (
          <Ident value={txHash} href={explorer.ccTx(txHash)} label="Challenge transaction" />
        ) : null}
        <p className="text-[12px] text-ink-muted">
          One Creditcoin transaction. The contract re-evaluates every condition on-chain; this
          preview does not decide the outcome.
        </p>
      </div>
    );
  }

  // --- pre-flight ---
  const failure = result.firstFailure;

  return (
    <div className="space-y-6">
      {result.wouldSucceed ? (
        <>
          <div>
            <Status tone="verified">All eleven conditions satisfied</Status>
            <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-ink">
              Submitting this challenge would prove a breach of <code>CIRCULAR_REPAYMENT</code>. The
              contract will re-evaluate every condition on-chain before paying anything.
            </p>
          </div>
          <Ledger bondPerLoan={bondPerLoan} bountyBps={bountyBps} projected loanId={loanId} />
        </>
      ) : failure ? (
        <div>
          <Status tone="breach">Would revert at condition {failure.n}</Status>
          <div className="record mt-4 px-5 py-4">
            <p className="text-[13px] leading-relaxed text-ink">{failure.title}</p>
            {failure.observed ? (
              <p className="mt-2 text-[12px] text-breach">Observed: {failure.observed}.</p>
            ) : null}
            <p className="mt-2 text-[12px] text-ink-muted">
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
          <span className="text-[12px] text-ink-muted">
            Submission requires a deployment. Nothing here is simulated.
          </span>
        ) : !isConnected ? (
          <span className="text-[12px] text-ink-muted">Connect a wallet to submit.</span>
        ) : null}
      </div>
    </div>
  );
}

/** The economic consequence, as a ledger. Institutional, not celebratory. */
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
    <div>
      <Eyebrow className="mb-2">
        {projected ? 'Projected economic consequence' : 'Economic consequence'}
      </Eyebrow>
      <dl className="rule-t">
        {rows.map((r) => (
          <div key={r.label} className="rule-b flex items-baseline justify-between py-2.5">
            <dt className="text-[13px] text-ink-muted">{r.label}</dt>
            <dd
              className={`tnum font-mono text-[13px] ${
                r.tone === 'breach' ? 'text-breach' : r.tone === 'verified' ? 'text-verified' : 'text-ink-muted'
              }`}
            >
              {r.value}
            </dd>
          </div>
        ))}
        <div className="rule-b flex items-baseline justify-between py-2.5">
          <dt className="text-[13px] text-ink-muted">Loan status</dt>
          <dd className="text-[13px]">
            <Link href={`/loan/${loanId}`} className="underline underline-offset-4">
              {LoanStatus[LoanStatus.BREACHED]}
            </Link>
          </dd>
        </div>
      </dl>
      {projected ? (
        <p className="mt-2 text-[11px] text-ink-faint">
          Computed from the contract&rsquo;s own parameters. Not a result — the chain decides.
        </p>
      ) : null}
    </div>
  );
}
