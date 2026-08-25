'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Button, Eyebrow, Ident, Input, Section, Status } from '@/components/ui';
import { explorer, sourceChain } from '@/lib/config';
import { VERIFIABLE_CHAINS } from '@/lib/verifier';
import { formatBlock, formatTokenAmount, shortAddress } from '@/lib/format';
import { tokenMeta } from '@/lib/token';
import {
  SCOPE,
  checkClearance,
  type ClearanceResult,
  type ClearanceStep,
} from '@/lib/clearance';

/**
 * Clearance.
 *
 * The one screen in Clearbook that produces a decision rather than a display.
 * A lender pastes the transaction they are about to advance against and gets one
 * of three answers, each carrying its own scope.
 *
 * Three rules govern this page:
 *
 *   1. The verdict never appears without its scope. "CLEAR" alone would be read
 *      as "this collateral is safe", which Clearbook cannot know and does not
 *      claim. The qualifier is rendered from `SCOPE`, which travels with the
 *      result rather than being retyped here.
 *   2. Unverifiable is a real answer, given as prominently as the other two.
 *      A check that quietly degrades to "clear" when the prover is down is worse
 *      than no check, because it is confidently wrong exactly when it matters.
 *   3. Every leg is shown. A transaction that moves value twice gets two rows,
 *      and one encumbered leg encumbers the whole transaction.
 */

/**
 * Real transactions a reader can check immediately.
 *
 * Without these the page opens on an empty field and assumes the visitor has a
 * transaction hash to hand, which almost nobody does. Each is labelled by what
 * the transaction IS, never by what the answer will be: the answer comes from
 * the live book every time this page runs, and a label that predicted it would
 * eventually be a label that lied.
 */
const EXAMPLES: Array<{ label: string; note: string; chainKey: number; hash: string }> = [
  {
    label: 'A disbursement on this book',
    note: 'Committed to a claim when the demo was seeded',
    chainKey: 1,
    hash: '0xd922115fbefd89c7fe43a7ab33768c22d075a829b0fd3de6b53d10d818d6f84d',
  },
  {
    label: 'A funding leg, never claimed',
    note: 'Verified and in the registry, but no claim cites it',
    chainKey: 1,
    hash: '0xca43a58891c97dac8d11e5838a6a6616586f1550a08f3316b33fd0bfdbd1b397',
  },
  {
    label: 'A stranger on Ethereum mainnet',
    note: 'Third-party activity we did not create and cannot control',
    chainKey: 3,
    hash: '0x29582881f3f5e726c609257792053bdcf130849478df2f333037fa6d54189c02',
  },
];

const STEP_LABEL: Record<ClearanceStep, string> = {
  locate: 'Locate transaction on the source chain',
  chainkey: 'Resolve chain key from the ChainInfo precompile',
  identity: 'Derive fact identity for each transfer leg',
  attest: 'Check whether the block is attested',
  proof: 'Request proof from the Attestcoin proof builder',
  verify: 'Verify proof at the Block Prover precompile',
  registry: 'Look up the fact in the shared registry',
  consumed: 'Read the global consumption mapping',
};

const ORDER: ClearanceStep[] = [
  'locate',
  'chainkey',
  'identity',
  'attest',
  'proof',
  'verify',
  'registry',
  'consumed',
];

interface Line {
  step: ClearanceStep;
  detail?: string;
  done: boolean;
}

export default function ClearancePage() {
  const [input, setInput] = useState('');
  const [chainKey, setChainKey] = useState(VERIFIABLE_CHAINS[0]?.chainKey ?? 1);
  const [lines, setLines] = useState<Line[]>([]);
  const [result, setResult] = useState<ClearanceResult | null>(null);
  const [running, setRunning] = useState(false);

  const chain = VERIFIABLE_CHAINS.find((c) => c.chainKey === chainKey) ?? VERIFIABLE_CHAINS[0]!;
  const malformed = input.trim().length > 0 && !/^0x[0-9a-fA-F]{64}$/.test(input.trim());

  async function run() {
    setRunning(true);
    setResult(null);
    setLines([]);

    const seen = new Map<ClearanceStep, Line>();
    const report = (step: ClearanceStep, detail?: string) => {
      const prev = seen.get(step);
      seen.set(step, { step, detail: detail ?? prev?.detail, done: detail !== undefined });
      setLines(ORDER.filter((s) => seen.has(s)).map((s) => seen.get(s)!));
    };

    try {
      const r = await checkClearance(chain, input, report);
      setResult(r);
    } catch (e) {
      setResult({
        outcome: 'unverifiable',
        txHash: input.trim() as `0x${string}`,
        chainKey: 0,
        chainId: chain.chainId,
        blockHeight: 0n,
        txIndex: 0n,
        legs: [],
        proof: null,
        reason: 'source-unreachable',
        detail: (e as Error).message ?? String(e),
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-8">
      {/*
        Two columns rather than a stack. Stacked, the title and its lead ran to
        roughly 260px and pushed the input and the examples below the fold, so
        the first thing a reader saw on the one screen that produces a decision
        was a headline and nothing to act on. Side by side they occupy the
        height of the taller column alone, and the check clears the fold.
      */}
      <header className="grid gap-x-12 gap-y-4 lg:grid-cols-[1.15fr_0.85fr] lg:items-end">
        <div>
          <Eyebrow>Clearance</Eyebrow>
          <h1 className="display-lg mt-2">Check evidence before you lend against it.</h1>
        </div>
        <p className="text-[14px] leading-relaxed text-muted lg:pb-1">
          Paste the transaction you are about to advance against. Clearbook proves it happened,
          derives the fact identity the protocol would assign it, and reports whether that fact is
          already committed to a claim on this book.{' '}
          <span className="text-ink">No wallet, no signature, no write.</span>
        </p>
      </header>

      {/* ---------------------------------------------------------------- input */}
      <section className="hard-xs border-2 border-ink bg-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[280px] flex-1">
            <Input
              value={input}
              onChange={setInput}
              label="Transaction hash"
              placeholder="0x…"
              invalid={malformed}
            />
          </div>

          <div>
            <Eyebrow className="mb-1.5">Source chain</Eyebrow>
            <div className="flex gap-2">
              {VERIFIABLE_CHAINS.map((c) => (
                <button
                  key={c.chainKey}
                  type="button"
                  onClick={() => setChainKey(c.chainKey)}
                  className={`press h-10 border-2 px-3 text-[12px] font-semibold tracking-[0.03em] transition-colors ${
                    c.chainKey === chainKey
                      ? 'border-ink bg-ink text-paper'
                      : 'border-rule-strong bg-surface text-muted hover:text-ink'
                  }`}
                >
                  {c.short}
                </button>
              ))}
            </div>
          </div>

          <Button variant="primary" onClick={run} disabled={running || malformed || !input.trim()}>
            {running ? 'Checking…' : 'Check clearance'}
          </Button>
        </div>

        {malformed ? (
          <p className="mt-3 text-[12px] text-breach">
            A transaction hash is 32 bytes of hex: 0x followed by 64 hex characters.
          </p>
        ) : null}

        {/* One click to a real answer. The verdict is never named here. */}
        <div className="mt-5 border-t border-rule pt-4">
          <Eyebrow>Or check one of these</Eyebrow>
          <div className="mt-2.5 grid gap-3 sm:grid-cols-3">
            {EXAMPLES.map((ex) => (
              <button
                key={ex.hash}
                type="button"
                disabled={running}
                onClick={() => {
                  setInput(ex.hash);
                  setChainKey(ex.chainKey);
                }}
                className="press border border-rule-strong bg-paper p-3 text-left transition-colors hover:border-ink disabled:opacity-40"
              >
                <div className="text-[13px] font-semibold leading-snug">{ex.label}</div>
                <div className="mt-1 text-[12px] leading-relaxed text-muted">{ex.note}</div>
                <div className="mt-2 font-mono text-[11px] text-faint">
                  {ex.hash.slice(0, 16)}…
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- pipeline */}
      {lines.length > 0 ? (
        <Section title="What ran" aside="Every step read-only">
          <ol className="space-y-0">
            {lines.map((l) => (
              <li
                key={l.step}
                className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-rule py-2.5 last:border-b-0"
              >
                <span
                  className={`tnum shrink-0 text-[11px] ${l.done ? 'text-verified' : 'text-faint'}`}
                  aria-hidden
                >
                  {l.done ? '✓' : '·'}
                </span>
                <span className="min-w-[260px] flex-1 text-[13px] text-ink">
                  {STEP_LABEL[l.step]}
                </span>
                {l.detail ? (
                  <span className="text-[12px] leading-relaxed text-muted">{l.detail}</span>
                ) : (
                  <span className="text-[12px] text-faint">working…</span>
                )}
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      {/* --------------------------------------------------------------- result */}
      {result ? <Verdict result={result} /> : null}

      {/* ------------------------------------------------------------ the limit */}
      <section className="border-t border-rule pt-6">
        <Eyebrow>What this check does not do</Eyebrow>
        <div className="mt-3 grid max-w-5xl gap-x-10 gap-y-4 text-[13px] leading-relaxed text-muted sm:grid-cols-2">
          <p>
            Clearbook prevents the same <span className="text-ink">proven fact</span> from being
            committed twice. It does not prevent two originators from pledging the same real-world
            obligation through two different transactions. Fact identity is not collateral identity,
            and a check that implied otherwise would be worse than no check at all.
          </p>
          <p>
            Clearance sees this book only. An obligation pledged in a facility that does not record
            here is invisible to it, and always will be, because Clearbook can only measure what it
            can observe.{' '}
            <Link href="/docs/clearance" className="underline decoration-rule-strong hover:text-ink">
              The trust model is written out in full
            </Link>
            .
          </p>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ verdict */

function Verdict({ result }: { result: ClearanceResult }) {
  const chain = sourceChain(result.chainKey);

  const head =
    result.outcome === 'clear'
      ? { tone: 'verified' as const, word: 'Clear in Clearbook', lead: 'Verified' }
      : result.outcome === 'encumbered'
        ? { tone: 'breach' as const, word: 'Encumbered in Clearbook', lead: 'Verified' }
        : { tone: 'pending' as const, word: 'Unverifiable', lead: 'No answer' };

  return (
    <section className="space-y-6">
      <div
        className={`hard-xs border-2 border-ink p-6 ${
          result.outcome === 'clear'
            ? 'bg-verified-soft'
            : result.outcome === 'encumbered'
              ? 'bg-breach-soft'
              : 'bg-pending-soft'
        }`}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
          <div>
            <Eyebrow>{head.lead}</Eyebrow>
            <p className="display-md mt-2">{head.word}</p>
          </div>
          <Status tone={head.tone}>{result.outcome}</Status>
        </div>

        {/* The scope is not optional and is not retyped: it comes from the result. */}
        <p className="mt-4 max-w-2xl text-[13px] leading-relaxed text-ink">
          {SCOPE[result.outcome]}
        </p>

        {result.detail ? (
          <p className="mt-3 max-w-2xl border-t border-rule pt-3 text-[13px] leading-relaxed text-muted">
            {result.detail}
          </p>
        ) : null}
      </div>

      {result.legs.length > 0 ? (
        <Section
          title={result.legs.length === 1 ? 'The transfer' : `The ${result.legs.length} transfers`}
          aside={`${chain.name} · block ${formatBlock(result.blockHeight)} · tx index ${result.txIndex}`}
        >
          <div className="space-y-4">
            {result.legs.map((leg) => {
              const meta = tokenMeta(leg.token);
              return (
                <div key={leg.factId} className="border border-rule-strong bg-surface p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                    <div className="flex flex-wrap items-baseline gap-x-3 text-[13px]">
                      <span className="tnum font-semibold">
                        {formatTokenAmount(leg.amount, meta.decimals)}
                      </span>
                      <span className="text-muted">{meta.symbol ?? shortAddress(leg.token)}</span>
                      <span className="text-faint">
                        {shortAddress(leg.from)} → {shortAddress(leg.to)}
                      </span>
                    </div>
                    {leg.consumedBy !== null ? (
                      <Link
                        href={`/loan/${leg.consumedBy}`}
                        className="text-[12px] font-semibold text-breach underline decoration-breach/40"
                      >
                        Committed to loan #{String(leg.consumedBy)}
                      </Link>
                    ) : (
                      <span className="text-[12px] text-verified">Not committed</span>
                    )}
                  </div>

                  <dl className="mt-3 grid gap-x-8 gap-y-2 border-t border-rule pt-3 sm:grid-cols-3">
                    <div>
                      <dt className="text-[11px] uppercase tracking-[0.12em] text-faint">
                        Fact identity
                      </dt>
                      <dd className="mt-1 text-[12px]">
                        <Ident value={leg.factId} label="Fact id" lead={10} tail={6} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] uppercase tracking-[0.12em] text-faint">
                        Transaction-local log
                      </dt>
                      <dd className="tnum mt-1 text-[12px] text-muted">{leg.logIndex}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] uppercase tracking-[0.12em] text-faint">
                        In shared registry
                      </dt>
                      <dd className="mt-1 text-[12px] text-muted">
                        {leg.inRegistry ? 'yes, already stored' : 'not yet submitted'}
                      </dd>
                    </div>
                  </dl>
                </div>
              );
            })}
          </div>

          <p className="mt-4 text-[12px] leading-relaxed text-faint">
            Fact identity is{' '}
            <span className="text-muted">keccak256(chainKey, blockHeight, txIndex, logIndex)</span>,
            derived here and checked against the deployed vault. The log index is the position
            inside this transaction&rsquo;s own logs, not the block-global index a log query
            returns.
          </p>
        </Section>
      ) : null}

      {result.proof ? (
        <p className="text-[12px] text-faint">
          Ruled on by the Block Prover precompile using{' '}
          {result.proof.merkleProof.siblings.length} Merkle siblings and{' '}
          {result.proof.continuityProof.roots.length} continuity roots.{' '}
          <a
            href={explorer.sourceTx(result.txHash, result.chainKey)}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-rule-strong hover:text-ink"
          >
            View the transaction on {chain.short}
          </a>
          .
        </p>
      ) : null}
    </section>
  );
}
