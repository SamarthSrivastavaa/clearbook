'use client';

import { useEffect, useRef, useState } from 'react';

import { explorer } from '@/lib/config';

/**
 * The escalation: send the refused commitment as a real transaction.
 *
 * The panel above this one settles the question with an `eth_call`, which is
 * free, instant, and entirely sufficient as proof. This exists for the reader
 * who wants the refusal to have a receipt rather than a simulation — one they
 * can open on a block explorer and inspect without trusting this page.
 *
 * Kept deliberately separate from `CommitGuard`: that component also renders on
 * the registry, once per consumed fact, and the relayer behind this button is
 * pinned to exactly one of them. Keeping them apart means the proof cannot be
 * broken by anything that happens here.
 *
 * Every outcome below is reported as what it actually was. A relayer that is
 * unfunded, rate limited, or unreachable is a failure of this page's plumbing,
 * never of the guarantee — and the copy says so, because conflating the two
 * would be the one genuinely dishonest thing this component could do.
 */

type Result =
  | {
      state: 'reverted';
      error: string | null;
      hash: string;
      blockNumber: string;
      ms: number;
    }
  | { state: 'precondition_changed'; simulated: string | null; detail: string }
  | { state: 'mined_unexpectedly'; hash: string; detail: string }
  | { state: 'pending'; hash: string; detail: string }
  | { state: 'relayer_error'; detail: string }
  | { state: 'rate_limited'; retryAfterMs: number }
  | { state: 'disabled'; detail: string };

export function CollideButton() {
  const [sending, setSending] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => void (timer.current && clearInterval(timer.current)), []);

  async function send() {
    setSending(true);
    setResult(null);
    setElapsed(0);
    // A real elapsed counter rather than a progress bar. The wait is a block
    // being mined, so there is no honest way to show a fraction of it.
    const started = Date.now();
    timer.current = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 250);

    try {
      const res = await fetch('/api/collide', { method: 'POST' });
      setResult((await res.json()) as Result);
    } catch {
      setResult({
        state: 'relayer_error',
        detail: 'The request did not reach our relayer. The live check above is unaffected.',
      });
    } finally {
      if (timer.current) clearInterval(timer.current);
      setSending(false);
    }
  }

  return (
    <div className="mt-4 border-t border-rule pt-4">
      {!result ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="button"
            onClick={send}
            disabled={sending}
            className="hard border-2 border-ink px-4 py-2 text-[13px] font-semibold text-ink transition-colors hover:bg-ink hover:text-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-transparent disabled:hover:text-ink"
          >
            {sending ? 'Sending to Creditcoin…' : 'Send this attempt on-chain'}
          </button>
          <span className="text-[12px] text-faint">
            {sending
              ? `waiting for a block · ${elapsed}s`
              : 'Broadcasts the same call as a real transaction. Takes about 10–20 seconds.'}
          </span>
        </div>
      ) : null}

      {result?.state === 'reverted' ? (
        <div>
          <p className="text-[13px] leading-relaxed">
            <span className="font-semibold text-ink">Rejected on-chain.</span> The transaction was
            broadcast, mined in block{' '}
            <span className="tnum">{Number(result.blockNumber).toLocaleString()}</span>, and
            reverted with{' '}
            <code className="font-mono text-[12px] text-breach">{result.error ?? 'a revert'}</code>.
            It consumed gas and changed nothing.
          </p>
          <p className="mt-2.5 text-[12px] text-faint">
            <a
              href={explorer.ccTx(result.hash)}
              target="_blank"
              rel="noreferrer noopener"
              className="ident ident-link"
            >
              {result.hash.slice(0, 18)}…
            </a>{' '}
            · receipt status 0 · {(result.ms / 1000).toFixed(1)}s
          </p>
        </div>
      ) : null}

      {result?.state === 'precondition_changed' ? (
        // Not a failure. The contract said something other than what this
        // demonstration exists to show, so nothing was broadcast.
        <p className="text-[13px] leading-relaxed text-pending">
          <span className="font-semibold">Nothing was sent.</span> {result.detail}
        </p>
      ) : null}

      {result?.state === 'mined_unexpectedly' ? (
        <p className="text-[13px] leading-relaxed text-pending">
          <span className="font-semibold">The transaction succeeded.</span> {result.detail}{' '}
          <a
            href={explorer.ccTx(result.hash)}
            target="_blank"
            rel="noreferrer noopener"
            className="ident ident-link"
          >
            Inspect it
          </a>
          .
        </p>
      ) : null}

      {result?.state === 'pending' ? (
        <p className="text-[13px] leading-relaxed text-muted">
          {result.detail}{' '}
          <a
            href={explorer.ccTx(result.hash)}
            target="_blank"
            rel="noreferrer noopener"
            className="ident ident-link"
          >
            {result.hash.slice(0, 18)}…
          </a>
        </p>
      ) : null}

      {result?.state === 'rate_limited' ? (
        <p className="text-[13px] leading-relaxed text-muted">
          Already sent recently. Try again in {Math.ceil(result.retryAfterMs / 1000)}s — the relayer
          is a throwaway wallet with a small balance, so sends are spaced out.
        </p>
      ) : null}

      {result?.state === 'relayer_error' || result?.state === 'disabled' ? (
        <p className="text-[13px] leading-relaxed text-muted">
          <span className="font-semibold text-ink">Our relayer, not the protocol.</span>{' '}
          {result.detail} The refusal above is a direct read of the deployed contract and does not
          depend on this button.
        </p>
      ) : null}
    </div>
  );
}
