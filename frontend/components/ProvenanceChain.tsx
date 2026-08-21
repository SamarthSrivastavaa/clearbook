'use client';

import { useEffect, useRef, useState } from 'react';

import { SOURCE_CHAIN, creditcoin, explorer } from '@/lib/config';

/**
 * The hero artifact: a real breach, rendered as the chain of causes that produced it.
 *
 * Every value here is taken from the demo breach that actually executed on-chain
 * — the Sepolia transactions, the proof shape, the Creditcoin verification, and
 * the slash. It is a product artifact, not an illustration.
 *
 * The animation exists to communicate causality: each step resolves only after
 * the one above it, because that is the actual dependency. It runs once and
 * stops. Under prefers-reduced-motion everything is simply present.
 */

interface Step {
  chain: string;
  title: string;
  detail: string;
  rows: Array<[string, string]>;
  href?: string;
  tone?: 'accent' | 'breach';
}

/** Values from the breach recorded in integration/results/gate5-gate6.json. */
const STEPS: Step[] = [
  {
    chain: SOURCE_CHAIN.name,
    title: 'A transfer happens',
    detail: 'An ordinary ERC-20 transfer on a token we do not control.',
    rows: [
      ['Token', 'WETH'],
      ['Block', '11,538,688'],
      ['Amount', '0.01'],
    ],
    href: explorer.sourceTx('0xca43a58891c97dac8d11e5838a6a6616586f1550a08f3316b33fd0bfdbd1b397'),
  },
  {
    chain: 'Attestcoin',
    title: 'The block is attested',
    detail: 'Attestors attest finalized blocks. A proof of inclusion becomes available.',
    rows: [
      ['Merkle siblings', '7'],
      ['Continuity roots', '3'],
      ['Wait', '~8 min'],
    ],
  },
  {
    chain: 'Creditcoin · 0x0FD2',
    title: 'The precompile verifies it',
    detail: 'Inclusion is proven on-chain. Nothing here is a server’s assertion.',
    rows: [
      ['verifyAndEmit', 'true'],
      ['Receipt status', 'asserted = 1'],
      ['Call', '0.8s'],
    ],
    tone: 'accent',
  },
  {
    chain: 'Clearbook',
    title: 'The covenant is evaluated',
    detail:
      'The treasury funded the payer, then the payer repaid the treasury — inside the window the originator published.',
    rows: [
      ['Covenant', 'CIRCULAR_REPAYMENT'],
      ['Conditions met', '11 of 11'],
      ['Blocks apart', '1'],
    ],
    tone: 'breach',
  },
  {
    chain: 'Creditcoin',
    title: 'The bond is slashed',
    detail: 'One transaction. No arbitrator, no dispute period, no vote.',
    rows: [
      ['Originator bond', '−1.0 tCTC'],
      ['Challenger', '+0.5 tCTC'],
      ['Claim', 'BREACHED'],
    ],
    href: explorer.ccTx('0x3a22a0fffd9d78ed6547658406f641fb337fe9e4638ac9e35eaa9c9020e93d47'),
    tone: 'breach',
  },
];

export function ProvenanceChain() {
  const [revealed, setRevealed] = useState(0);
  const ref = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setRevealed(STEPS.length);
      return;
    }
    // Reveal in sequence, and only once the artifact is actually on screen.
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        io.disconnect();
        STEPS.forEach((_, i) => {
          setTimeout(() => setRevealed(i + 1), i * 420);
        });
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <ol ref={ref} className="rail rail-dark" aria-label="How a covenant breach is established">
      {STEPS.map((step, i) => {
        const shown = i < revealed;
        return (
          <li
            key={step.title}
            data-state={shown ? (step.tone === 'breach' ? 'breach' : 'done') : undefined}
            className={`rail-node pb-7 last:pb-0 transition-opacity duration-500 ${
              shown ? 'opacity-100' : 'opacity-25'
            }`}
          >
            <div className="flex items-baseline gap-3">
              <span className="eyebrow text-onDeepMuted">{step.chain}</span>
              {step.href && shown ? (
                <a
                  href={step.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-[10px] uppercase tracking-[0.14em] text-onDeepMuted underline underline-offset-4 transition-colors hover:text-onDeep"
                >
                  view
                </a>
              ) : null}
            </div>

            <div className="mt-1.5 text-[15px] font-medium text-onDeep">{step.title}</div>
            <p className="mt-1 max-w-md text-[13px] leading-relaxed text-onDeepMuted">{step.detail}</p>

            <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-1.5">
              {step.rows.map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-[10px] uppercase tracking-[0.14em] text-onDeepMuted">{k}</dt>
                  <dd
                    className={`tnum font-mono text-[13px] ${
                      step.tone === 'breach' && k !== 'Covenant' ? 'text-[#e0836f]' : 'text-onDeep'
                    }`}
                  >
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        );
      })}
    </ol>
  );
}

/** Small print under the artifact: what this is and is not. */
export function ProvenanceCaption() {
  return (
    <p className="mt-8 max-w-md text-[12px] leading-relaxed text-onDeepMuted">
      This is a breach that actually executed on {creditcoin.name}. The transactions are real and
      staged by us for demonstration; they describe no real borrower. Every figure links to a block
      explorer.
    </p>
  );
}
