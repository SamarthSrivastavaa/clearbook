'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { Hex } from 'viem';

import { Button, Callout, Eyebrow, Ident, Input, Section, Status, Working } from '@/components/ui';
import { SOURCE_CHAIN, explorer, sourceChain } from '@/lib/config';
import { formatBlock, shortAddress } from '@/lib/format';
import {
  VERIFIABLE_CHAINS,
  attestationBounds,
  fetchAttestedHeight,
  fetchProof,
  resolveSourceChainKey,
  sourceClientFor,
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

/** What each step is for, shown before it has anything to report. */
const ABOUT: Record<string, string> = {
  locate: 'Read directly from the source chain, independently of any proof.',
  chainkey: 'Resolved at run time. Never hardcoded.',
  attest: 'Attestors attest finalized blocks; until quorum, the evidence does not exist here.',
  proof: 'Merkle inclusion plus continuity roots. The proof builder is untrusted.',
  verify: 'The step that turns proof material into a fact a contract will act on.',
};

const INITIAL: Step[] = [
  { key: 'locate', label: 'Locate transaction on the source chain', state: 'idle' },
  { key: 'chainkey', label: 'Resolve chain key from the ChainInfo precompile', state: 'idle' },
  { key: 'attest', label: 'Check whether the block is attested', state: 'idle' },
  { key: 'proof', label: 'Request proof from the Attestcoin proof builder', state: 'idle' },
  { key: 'verify', label: 'Verify proof at the Block Prover precompile', state: 'idle' },
];

/**
 * Real transactions a reader can verify immediately.
 *
 * Without these the page opens on an empty field and assumes the visitor has a
 * transaction hash to hand, which almost nobody does. Both were verified
 * end-to-end through this exact path; the mainnet one is third-party activity
 * we did not create and cannot control.
 */
const EXAMPLES: Array<{ label: string; note: string; chainId: number; hash: string }> = [
  {
    label: 'Real Ethereum mainnet transfer',
    note: '10,506.42 USDC between two strangers',
    chainId: 1,
    hash: '0x29582881f3f5e726c609257792053bdcf130849478df2f333037fa6d54189c02',
  },
  {
    label: 'A staged Sepolia transfer',
    note: 'One leg of the demo book',
    chainId: 11155111,
    hash: '0xbbc8293c74e8d362a8797bde78b400fbe4beead8b805ff995587c1d549e8fe0b',
  },
];

export default function VerifyPage() {
  const [input, setInput] = useState('');
  const [steps, setSteps] = useState<Step[]>(INITIAL);

  /** Nothing has run yet, so the path is an outline rather than a report. */
  const idle = steps.every((s) => s.state === 'idle');
  const [bundle, setBundle] = useState<ProofBundle | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [running, setRunning] = useState(false);
  // Which chain the pasted hash is expected to be on. Sepolia by default; the
  // demo's claims live there, but evidence may come from anywhere attested.
  const [chainId, setChainId] = useState<number>(SOURCE_CHAIN.chainId);
  const [meta, setMeta] = useState<{ block?: number; chainKey?: number; from?: string }>({});

  const selected =
    VERIFIABLE_CHAINS.find((c) => c.chainId === chainId) ?? VERIFIABLE_CHAINS[0];

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
      const receipt = await sourceClientFor(selected.chainKey).getTransactionReceipt({ hash: txHash });
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
      const chainKey = await resolveSourceChainKey(chainId);
      setMeta((m) => ({ ...m, chainKey }));
      set('chainkey', 'done', `${selected.name} is chain key ${chainKey}`);

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
        <h1 className="display-lg mt-3">Verify any Ethereum transaction.</h1>
        <p className="prose-lead mt-4">
          Paste any transaction hash — ours, or one you found on Etherscan a minute ago. Every step
          is read-only: no wallet, no gas, nothing staged.
        </p>
      </header>

      {/* The instrument, not an article about it: controls across the top, the
          verification path beneath as the result area. */}
      <div className="hard-signal border-2 border-ink bg-surface">
        <div className="grid gap-x-8 gap-y-5 p-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)_auto] lg:items-end">
          {/* Which chain to look on. Offered only for chains the precompile
              attests and we hold an endpoint for — the list is not aspirational. */}
          <div>
            <span className="eyebrow">Source chain</span>
            <div className="mt-2 flex flex-wrap gap-px bg-rule">
              {VERIFIABLE_CHAINS.map((c) => {
                const active = c.chainId === chainId;
                return (
                  <button
                    key={c.chainKey}
                    type="button"
                    onClick={() => setChainId(c.chainId)}
                    aria-pressed={active}
                    disabled={running}
                    className={`flex-1 px-4 py-2.5 text-left transition-colors disabled:opacity-50 ${
                      active ? 'bg-ink text-paper' : 'bg-paper hover:bg-sunken'
                    }`}
                  >
                    <span className="block text-[13px] font-medium">{c.name}</span>
                    <span
                      className={`block text-[11px] ${active ? 'text-onDeepMuted' : 'text-faint'}`}
                    >
                      {c.live ? 'real value · chain key ' + c.chainKey : 'testnet · chain key ' + c.chainKey}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="min-w-0">
            <Input
              label="Source-chain transaction hash"
              value={input}
              onChange={setInput}
              placeholder="0x…"
              invalid={input.length > 0 && !txHash}
            />
            {input.length > 0 && !txHash ? (
              <p className="mt-1.5 text-[12px] text-breach">A transaction hash is 32 bytes of hex.</p>
            ) : null}
          </div>

          <div className="flex items-center gap-4">
            <Button variant="primary" onClick={run} disabled={!txHash || running}>
              {running ? 'Verifying…' : 'Verify'}
            </Button>
            {txHash && meta.block ? (
              <a
                href={explorer.sourceTx(txHash)}
                target="_blank"
                rel="noreferrer noopener"
                className="whitespace-nowrap text-[12px] text-muted underline underline-offset-4 hover:text-ink"
              >
                On explorer
              </a>
            ) : null}
          </div>

        </div>

        {/* Examples ride along the bottom of the panel: they are how you start,
            not a separate topic. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule bg-sunken px-6 py-3">
          <span className="eyebrow">Try one</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex.hash}
              type="button"
              disabled={running}
              onClick={() => {
                setChainId(ex.chainId);
                setInput(ex.hash);
              }}
              className="group text-left text-[12px] transition-colors disabled:opacity-40"
            >
              <span className="font-medium underline decoration-rule-strong underline-offset-4 group-hover:decoration-ink">
                {ex.label}
              </span>
              <span className="ml-2 text-faint">{ex.note}</span>
            </button>
          ))}
        </div>
      </div>

        <Section title="Verification path" aside={verified === true ? 'Complete' : undefined}>
          {/*
            Before a run this is an outline, not a report. Rendering each step's
            purpose here filled the result area with prose describing what would
            happen — which reads as documentation about the instrument rather
            than the instrument. Idle stays compact; the rail expands once there
            is something real to say.
          */}
          <ol className="rail">
            {steps.map((s, i) => (
              <StepRow key={s.key} step={s} index={i + 1} idle={idle} />
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

      <p className="max-w-3xl text-[12px] leading-relaxed text-faint">
        This proves the transaction was included in a block the attestor set has attested and that
        its receipt succeeded. It proves nothing about who controls either address, why the transfer
        happened, or whether an off-chain agreement exists.{' '}
        <Link href="/docs/verification" className="link">
          How verification works
        </Link>
      </p>
    </div>
  );
}

function StepRow({ step, index, idle }: { step: Step; index: number; idle: boolean }) {
  // Resolved states get a glyph so the outcome never depends on colour alone.
  // Pending steps get nothing — the rail node already says "not yet", and a dot
  // beside an empty node is noise. The column keeps its width either way.
  const mark =
    step.state === 'done' ? '✓' : step.state === 'failed' ? '✕' : step.state === 'blocked' ? '॥' : '';

  const tone =
    step.state === 'done'
      ? 'text-verified'
      : step.state === 'failed'
        ? 'text-breach'
        : step.state === 'blocked'
          ? 'text-pending'
          : 'text-faint';

  const railState =
    step.state === 'done' ? 'done' : step.state === 'failed' ? 'breach' : step.state === 'running' ? 'active' : undefined;

  return (
    <li className={`rail-node flex gap-4 last:pb-0 ${idle ? 'pb-3.5' : 'pb-6'}`} data-state={railState}>
      <span className={`mt-0.5 w-4 shrink-0 text-center text-[12px] font-semibold ${tone}`} aria-hidden>
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
                  : 'text-muted'
            }`}
          >
            {step.detail}
          </span>
        ) : idle ? null : (
          <span className="mt-1 block max-w-lg text-[12px] leading-relaxed text-faint">
            {ABOUT[step.key]}
          </span>
        )}
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
