'use client';

import { useEffect, useRef, useState } from 'react';

import { SOURCE_CHAIN, creditcoin, explorer } from '@/lib/config';

/**
 * The hero artifact: a real breach, rendered as the chain of causes that produced it.
 *
 * Every value here is taken from the demo breach that actually executed on-chain:
 * the Sepolia transactions, the proof shape, the Creditcoin verification, and the
 * slash. It is a product artifact, not an illustration.
 *
 * It carries no explanatory prose, deliberately. The hero already argues its case
 * in the left column, and repeating that argument here in five paragraphs made
 * the artifact read as a second essay rather than as an instrument. What is left
 * is the sequence and the figures, which make the case better than sentences do.
 *
 * The animation communicates causality: each step resolves only after the one
 * above it, because that is the actual dependency. It runs once and stops. Under
 * prefers-reduced-motion everything is simply present.
 */

interface Step {
  chain: string;
  title: string;
  /** Label and value. Rendered inline: the figures are the content here. */
  rows: Array<[string, string]>;
  href?: string;
  tone?: 'accent' | 'breach';
}

/** Values from the breach recorded in integration/results/gate5-gate6.json. */
const STEPS: Step[] = [
  {
    chain: SOURCE_CHAIN.name,
    title: 'A transfer happens',
    rows: [
      ['token', 'WETH'],
      ['block', '11,538,688'],
      ['amount', '0.01'],
    ],
    href: explorer.sourceTx('0xca43a58891c97dac8d11e5838a6a6616586f1550a08f3316b33fd0bfdbd1b397'),
  },
  {
    chain: 'Attestcoin',
    title: 'The block is attested',
    rows: [
      ['siblings', '7'],
      ['roots', '3'],
      ['wait', '~8 min'],
    ],
  },
  {
    chain: 'Creditcoin · 0x0FD2',
    title: 'The precompile verifies it',
    rows: [
      ['verify', 'true'],
      ['receipt', '= 1'],
      ['call', '0.8s'],
    ],
    tone: 'accent',
  },
  {
    chain: 'Clearbook',
    title: 'The covenant is evaluated',
    rows: [
      ['rule', 'CIRCULAR_REPAYMENT'],
      ['met', '11 of 11'],
      ['apart', '1 block'],
    ],
    tone: 'breach',
  },
  {
    chain: 'Creditcoin',
    title: 'The bond is slashed',
    rows: [
      ['bond', '−1.0 tCTC'],
      ['paid', '+0.5 tCTC'],
      ['claim', 'BREACHED'],
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
          setTimeout(() => setRevealed(i + 1), i * 380);
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
            className={`rail-node pb-4 last:pb-0 transition-opacity duration-500 ${
              shown ? 'opacity-100' : 'opacity-20'
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

            <div className="mt-1 text-[14.5px] font-medium text-onDeep">{step.title}</div>

            {/*
              One line, not a grid of stacked label/value pairs. The figures are
              what this artifact is for, and giving each its own two-line cell
              made five steps taller than the screen they had to fit inside.
            */}
            <dl className="mt-1.5 flex flex-wrap items-baseline gap-x-3.5 gap-y-1 font-mono text-[12px]">
              {step.rows.map(([k, v], j) => (
                <div key={k} className="flex items-baseline gap-1.5">
                  <dt className="text-[10px] uppercase tracking-[0.12em] text-onDeepMuted">{k}</dt>
                  <dd
                    className={`tnum ${
                      step.tone === 'breach' && k !== 'rule' ? 'text-[#e0836f]' : 'text-onDeep'
                    }`}
                  >
                    {v}
                  </dd>
                  {/*
                    The separator trails its pair rather than leading the next
                    one. When a row wraps, a trailing mark reads as continuation
                    while a leading one reads as a bullet that lost its list.
                  */}
                  {j < step.rows.length - 1 ? (
                    <span aria-hidden className="ml-2.5 text-[#4a4638]">
                      ·
                    </span>
                  ) : null}
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
    <p className="mt-4 max-w-md text-[11.5px] leading-relaxed text-onDeepMuted">
      A breach that actually executed on {creditcoin.name}. The transactions are real and staged by
      us; they describe no real borrower. Every figure links to a block explorer.
    </p>
  );
}
