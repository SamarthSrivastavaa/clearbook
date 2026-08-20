'use client';

import { Callout, Eyebrow } from './ui';

/** Shared non-happy states. Each explains what happened and what to do next. */

export function NotDeployed() {
  return (
    <div className="mx-auto max-w-2xl py-20">
      <Eyebrow>No deployment configured</Eyebrow>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">
        Clearbook is not pointed at a deployment.
      </h1>
      <p className="mt-4 text-[15px] leading-relaxed text-ink-muted">
        This interface reads protocol state directly from Creditcoin. It does not keep a copy, and
        it will not display a book that does not exist on-chain.
      </p>
      <div className="mt-8">
        <Callout tone="pending" title="To connect a deployment">
          Set <code className="font-mono text-[12px]">NEXT_PUBLIC_EVIDENCE_VAULT_ADDRESS</code> and{' '}
          <code className="font-mono text-[12px]">NEXT_PUBLIC_CLEARBOOK_ADDRESS</code> in{' '}
          <code className="font-mono text-[12px]">frontend/.env.local</code>, then restart the dev
          server.
        </Callout>
      </div>
      <p className="mt-6 text-[13px] leading-relaxed text-ink-faint">
        Contracts are written, tested and ready to deploy; deployment requires a funded Creditcoin
        testnet account. Until then every screen here reports the absence honestly rather than
        showing placeholder data.
      </p>
    </div>
  );
}

export function RpcError({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="py-16">
      <Callout tone="breach" title="Could not read chain state">
        <p>{message}</p>
        <p className="mt-2 text-ink-muted">
          The contracts are unaffected — this is a connectivity problem between this browser and the
          Creditcoin RPC.
        </p>
        {retry ? (
          <button
            type="button"
            onClick={retry}
            className="mt-3 text-[12px] uppercase tracking-wider underline underline-offset-4"
          >
            Retry
          </button>
        ) : null}
      </Callout>
    </div>
  );
}

export function LoadingRows({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading protocol state</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="rule-b flex items-center gap-6 py-4">
          <div className="animate-working h-3 w-10 bg-rule" />
          <div className="animate-working h-3 w-40 bg-rule" />
          <div className="animate-working ml-auto h-3 w-24 bg-rule" />
        </div>
      ))}
    </div>
  );
}

/**
 * Persistent disclosure for preview mode. Deliberately impossible to miss and
 * impossible to dismiss: if the UI is showing illustrative data, it says so on
 * every screen, for as long as it is doing it.
 */
export function PreviewBanner() {
  return (
    <div className="mb-8 border-l-2 border-pending bg-pending-bg px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-pending">
        Preview — illustrative data, not on-chain state
      </div>
      <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-ink">
        The contracts are written and tested but not yet deployed, so this screen renders
        deterministic fixtures to show layout and behaviour. No proof has been submitted, no bond is
        posted, and no loan exists on any chain. The token and wallet addresses shown are real; the
        transfers are not.
      </p>
    </div>
  );
}
