'use client';

import { useState } from 'react';
import type { Hex } from 'viem';

import { Button, Callout, Eyebrow, Ident, Input, Section, Status, Working } from '@/components/ui';
import { SOURCE_CHAIN, explorer } from '@/lib/config';
import { formatBlock, shortAddress } from '@/lib/format';
import {
  attestationBounds,
  fetchAttestedHeight,
  fetchProof,
  resolveSourceChainKey,
  sourceClient,
  verifyOnChain,
  type ProofBundle,
} from '@/lib/verifier';

/**
 * Judge mode.
 *
 * Paste any Sepolia transaction hash — ours or a stranger's — and watch the whole
 * path run: locate it, ask whether its block is attested, fetch a proof, and have
 * the Creditcoin precompile rule on it. Every step is read-only and needs no
 * wallet, so a judge can drive it themselves.
 *
 * This is the strongest available demonstration that nothing is staged: the
 * subject transaction can be one we have never seen.
 */

type StepState = 'idle' | 'running' | 'done' | 'failed' | 'blocked';

interface Step {
  key: string;
  label: string;
  state: StepState;
  detail?: string;
}

const INITIAL: Step[] = [
  { key: 'locate', label: 'Locate transaction on the source chain', state: 'idle' },
  { key: 'chainkey', label: 'Resolve chain key from the ChainInfo precompile', state: 'idle' },
  { key: 'attest', label: 'Check whether the block is attested', state: 'idle' },
  { key: 'proof', label: 'Request proof from the Attestcoin proof builder', state: 'idle' },
  { key: 'verify', label: 'Verify proof at the Block Prover precompile', state: 'idle' },
];

export default function VerifyPage() {
  const [input, setInput] = useState('');
  const [steps, setSteps] = useState<Step[]>(INITIAL);
  const [bundle, setBundle] = useState<ProofBundle | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [running, setRunning] = useState(false);
  const [meta, setMeta] = useState<{ block?: number; chainKey?: number; from?: string }>({});

  const txHash = /^0x[0-9a-fA-F]{64}$/.test(input.trim()) ? (input.trim() as Hex) : null;

  const set = (key: string, state: StepState, detail?: string) =>
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, state, detail } : s)));

  async function run() {
    if (!txHash) return;
    setRunning(true);
    setSteps(INITIAL.map((s) => ({ ...s, state: 'idle', detail: undefined })));
    setBundle(null);
    setVerified(null);
    setMeta({});

    try {
      // 1 — locate the transaction
      set('locate', 'running');
      const receipt = await sourceClient.getTransactionReceipt({ hash: txHash });
      const block = Number(receipt.blockNumber);
      setMeta((m) => ({ ...m, block, from: receipt.from }));

      if (receipt.status !== 'success') {
        set(
          'locate',
          'failed',
          'The transaction reverted. Clearbook rejects reverted transactions as evidence — the precompile does not check this, so the vault does.',
        );
        setRunning(false);
        return;
      }
      set(
        'locate',
        'done',
        `Block ${formatBlock(block)}, index ${receipt.transactionIndex}, receipt status 1`,
      );

      // 2 — resolve the chain key at runtime, never hardcoded
      set('chainkey', 'running');
      const chainKey = await resolveSourceChainKey();
      setMeta((m) => ({ ...m, chainKey }));
      set('chainkey', 'done', `${SOURCE_CHAIN.name} is chain key ${chainKey}`);

      // 3 — is the block attested?
      set('attest', 'running');
      const bounds = await attestationBounds(chainKey, block);
      let attestedHeight: number | null = null;
      try {
        attestedHeight = await fetchAttestedHeight(chainKey);
      } catch {
        // The prover being unreachable does not change the on-chain answer.
      }

      if (!bounds.isAttested) {
        set(
          'attest',
          'blocked',
          `Not yet attested. The precompile reports bounds ${formatBlock(bounds.parentHeight)}–${formatBlock(
            bounds.childHeight,
          )}${attestedHeight ? `, prover cache at ${formatBlock(attestedHeight)}` : ''}. Attestors attest finalized blocks, so a recent transaction typically needs about eight minutes.`,
        );
        setRunning(false);
        return;
      }
      set(
        'attest',
        'done',
        `Attested. Covered by bounds ${formatBlock(bounds.parentHeight)}–${formatBlock(bounds.childHeight)}.`,
      );

      // 4 — proof material from the (untrusted) proof builder
      set('proof', 'running');
      let proof: ProofBundle;
      try {
        proof = await fetchProof(chainKey, txHash);
      } catch (e) {
        set('proof', 'failed', (e as Error).message);
        setRunning(false);
        return;
      }
      setBundle(proof);
      set(
        'proof',
        'done',
        `${proof.merkleProof.siblings.length} Merkle siblings, ${proof.continuityProof.roots.length} continuity roots, ${
          (proof.txBytes.length - 2) / 2
        } bytes of transaction${proof.cached ? ' (cached)' : ''}`,
      );

      // 5 — the precompile decides
      set('verify', 'running');
      const ok = await verifyOnChain(proof);
      setVerified(ok);
      set(
        'verify',
        ok ? 'done' : 'failed',
        ok
          ? 'The Block Prover precompile returned true.'
          : 'The precompile returned false. This proof does not establish inclusion.',
      );
    } catch (e) {
      const message = (e as Error).message ?? String(e);
      setSteps((prev) => {
        const idx = prev.findIndex((s) => s.state === 'running');
        if (idx === -1) return prev;
        const next = [...prev];
        next[idx] = { ...next[idx], state: 'failed', detail: message };
        return next;
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-10">
      <header className="max-w-3xl">
        <Eyebrow>Judge mode</Eyebrow>
        <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight">
          Verify any {SOURCE_CHAIN.name} transaction.
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed text-ink-muted">
          Paste a transaction hash — ours, or one you found yourself a minute ago. Clearbook will
          locate it, resolve the chain key from the ChainInfo precompile, ask whether its block is
          attested, fetch a proof, and have the Block Prover precompile rule on it. Every step is
          read-only. No wallet, no gas, nothing staged.
        </p>
      </header>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Input
            label="Source-chain transaction hash"
            value={input}
            onChange={setInput}
            placeholder="0x…"
            invalid={input.length > 0 && !txHash}
          />
          {input.length > 0 && !txHash ? (
            <p className="text-[12px] text-breach">A transaction hash is 32 bytes of hex.</p>
          ) : null}

          <div className="flex items-center gap-4">
            <Button variant="primary" onClick={run} disabled={!txHash || running}>
              {running ? 'Verifying…' : 'Verify'}
            </Button>
            {txHash && meta.block ? (
              <a
                href={explorer.sourceTx(txHash)}
                target="_blank"
                rel="noreferrer noopener"
                className="text-[12px] text-ink-muted underline underline-offset-4 hover:text-ink"
              >
                View on explorer
              </a>
            ) : null}
          </div>

          <Callout tone="inert" title="What this proves">
            That the transaction was included in a block the attestor set has attested, and that its
            receipt succeeded. It proves nothing about who controls the addresses involved, or why
            the transfer happened.
          </Callout>
        </div>

        <Section title="Verification path" aside={verified === true ? 'Complete' : undefined}>
          <ol className="rule-t">
            {steps.map((s, i) => (
              <StepRow key={s.key} step={s} index={i + 1} />
            ))}
          </ol>

          {verified === true && bundle ? (
            <div className="mt-8 space-y-5">
              <Status tone="verified">Inclusion verified by the precompile</Status>
              <dl className="grid gap-4 sm:grid-cols-3">
                <Detail label="Chain key">{bundle.chainKey}</Detail>
                <Detail label="Block">{formatBlock(bundle.headerNumber)}</Detail>
                <Detail label="Transaction index">{bundle.txIndex}</Detail>
              </dl>
              <div>
                <Eyebrow className="mb-1.5">Merkle root</Eyebrow>
                <Ident value={bundle.merkleProof.root} label="Merkle root" lead={14} tail={10} />
              </div>
              <div>
                <Eyebrow className="mb-1.5">Continuity lower endpoint</Eyebrow>
                <Ident
                  value={bundle.continuityProof.lowerEndpointDigest}
                  label="Lower endpoint digest"
                  lead={14}
                  tail={10}
                />
              </div>
              {meta.from ? (
                <div>
                  <Eyebrow className="mb-1.5">Sender</Eyebrow>
                  <a
                    href={explorer.sourceAddress(meta.from)}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="ident ident-link"
                  >
                    {shortAddress(meta.from)}
                  </a>
                </div>
              ) : null}
            </div>
          ) : null}
        </Section>
      </div>
    </div>
  );
}

function StepRow({ step, index }: { step: Step; index: number }) {
  const mark =
    step.state === 'done' ? '✓' : step.state === 'failed' ? '✕' : step.state === 'blocked' ? '॥' : '·';

  const tone =
    step.state === 'done'
      ? 'text-verified'
      : step.state === 'failed'
        ? 'text-breach'
        : step.state === 'blocked'
          ? 'text-pending'
          : 'text-ink-faint';

  return (
    <li className="rule-b flex gap-4 py-3.5">
      <span
        className={`mt-0.5 w-4 shrink-0 text-center text-[12px] font-semibold ${tone}`}
        aria-hidden
      >
        {mark}
      </span>
      <span className="ident w-5 shrink-0 pt-px text-[11px]">{index}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] leading-snug text-ink">{step.label}</span>
        {step.state === 'running' ? (
          <Working label="Working…" />
        ) : step.detail ? (
          <span
            className={`mt-1 block text-[12px] leading-relaxed ${
              step.state === 'failed'
                ? 'text-breach'
                : step.state === 'blocked'
                  ? 'text-pending'
                  : 'text-ink-muted'
            }`}
          >
            {step.detail}
          </span>
        ) : null}
      </span>
    </li>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="ident tnum mt-1">{children}</dd>
    </div>
  );
}
