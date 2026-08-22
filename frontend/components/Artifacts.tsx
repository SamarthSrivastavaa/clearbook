import type { ReactNode } from 'react';

/**
 * Fragments of the real interface, quoted inside the narrative page.
 *
 * The landing page argues that this system exists and works. The most direct
 * support for that claim is to show the system rather than describe it — so
 * these are built from the same primitives the application uses, with values
 * taken from the breach that actually executed on Creditcoin CC3.
 *
 * They are markup, not screenshots. That matters twice: they stay correct when
 * the app changes, and they stay sharp at any zoom or pixel density.
 *
 * Every figure here is real and staged by us. Nothing is invented to look good.
 */

function Chrome({
  label,
  right,
  children,
  onDeep = false,
}: {
  label: string;
  right?: ReactNode;
  children: ReactNode;
  onDeep?: boolean;
}) {
  return (
    <figure className={`artifact ${onDeep ? 'artifact-onDeep' : ''}`}>
      <figcaption className="artifact-bar">
        <span className="eyebrow">{label}</span>
        {right ? <span className="ml-auto text-[10px] tracking-[0.14em] uppercase text-faint">{right}</span> : null}
      </figcaption>
      {children}
    </figure>
  );
}

/** The claim record, as the book renders it. */
export function ClaimArtifact({ onDeep = false }: { onDeep?: boolean }) {
  const ink = onDeep ? 'text-onDeep' : 'text-ink';
  const muted = onDeep ? 'text-onDeepMuted' : 'text-muted';
  const rule = onDeep ? 'border-[#33312a]' : 'border-rule';

  return (
    <Chrome label="Claim record" right="Creditcoin CC3" onDeep={onDeep}>
      <div className="px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <span className={`font-mono text-[20px] font-medium tracking-tight ${ink}`}>L-002</span>
          <span className="inline-flex items-center gap-2">
            <span className="inline-block h-3 w-[2px] bg-breach" aria-hidden />
            <span className="text-[11px] font-semibold tracking-[0.14em] uppercase text-breach">
              Breached
            </span>
          </span>
        </div>

        <dl className={`mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t ${rule} pt-3.5`}>
          {[
            ['Principal', '0.01 WETH'],
            ['Borrower', '0x942B…7f1d'],
            ['Covenant', 'CIRCULAR_REPAYMENT'],
            ['Source chain', 'Ethereum Sepolia'],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="eyebrow">{k}</dt>
              <dd className={`tnum mt-1 font-mono text-[12px] ${ink}`}>{v}</dd>
            </div>
          ))}
        </dl>

        <p className={`mt-4 border-t ${rule} pt-3 text-[12px] leading-relaxed ${muted}`}>
          Bond slashed 1.0 tCTC. Proven by an address that holds no privileged role.
        </p>
      </div>
    </Chrome>
  );
}

/**
 * One covenant condition, inspected.
 *
 * This is the screen a protocol engineer drills into and the one a credit
 * analyst can still read: the rule in words, the expression, the observed
 * values, and the comparison that decided it.
 */
export function ConditionArtifact({ onDeep = false }: { onDeep?: boolean }) {
  const ink = onDeep ? 'text-onDeep' : 'text-ink';
  const muted = onDeep ? 'text-onDeepMuted' : 'text-muted';
  const rule = onDeep ? 'border-[#33312a]' : 'border-rule';

  const rows: Array<[string, string, string]> = [
    ['Funding leg', '0.01 WETH', 'block 11,538,688'],
    ['Repayment', '0.01 WETH', 'block 11,538,689'],
  ];

  return (
    <Chrome label="Condition 7 of 11" right="Value" onDeep={onDeep}>
      <div className="px-5 py-4">
        <p className={`display-sm ${ink}`}>
          The payer received at least what it repaid.
        </p>

        <dl className="mt-4 space-y-2">
          {rows.map(([k, v, at]) => (
            <div key={k} className="flex flex-wrap items-baseline gap-x-3">
              <dt className={`min-w-[92px] text-[12px] ${muted}`}>{k}</dt>
              <dd className={`tnum font-mono text-[13px] font-medium ${ink}`}>{v}</dd>
              <dd className="tnum ml-auto font-mono text-[11px] text-faint">{at}</dd>
            </div>
          ))}
        </dl>

        <div className={`mt-4 flex flex-wrap items-center justify-between gap-3 border-t ${rule} pt-3.5`}>
          <code className={`tnum font-mono text-[12px] ${muted}`}>funding ≥ repayment</code>
          <span className="inline-flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 bg-verified" aria-hidden />
            <span className="text-[11px] font-semibold tracking-[0.14em] uppercase text-verified">
              Satisfied
            </span>
          </span>
        </div>
      </div>
    </Chrome>
  );
}

/** A verified source-chain transfer, as the evidence rail renders it. */
export function EvidenceArtifact({ onDeep = false }: { onDeep?: boolean }) {
  const ink = onDeep ? 'text-onDeep' : 'text-ink';
  const muted = onDeep ? 'text-onDeepMuted' : 'text-muted';
  const rule = onDeep ? 'border-[#33312a]' : 'border-rule';

  return (
    <Chrome label="Verified evidence" right="Ethereum Sepolia" onDeep={onDeep}>
      <div className="px-5 py-4">
        <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
          <span className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-[0.14em] text-faint">From</span>
            <span className={`font-mono text-[13px] ${ink}`}>0xBD0E…367A</span>
          </span>

          <span className="flex flex-1 items-center gap-2.5 pb-1" aria-hidden>
            <span className={`h-px flex-1 ${onDeep ? 'bg-[#4a4638]' : 'bg-rule-strong'}`} />
            <span className={`tnum whitespace-nowrap font-mono text-[13px] font-medium ${ink}`}>
              0.01 WETH
            </span>
            <span className={`h-px flex-1 ${onDeep ? 'bg-[#4a4638]' : 'bg-rule-strong'}`} />
            <span className="text-faint">→</span>
          </span>

          <span className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-[0.14em] text-faint">To</span>
            <span className={`font-mono text-[13px] ${ink}`}>0x942B…7f1d</span>
          </span>
        </div>

        <div className={`mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2 border-t ${rule} pt-3`}>
          <span className="tnum font-mono text-[11px] text-faint">block 11,538,688</span>
          <span className="tnum font-mono text-[11px] text-faint">txIndex 79</span>
          <span className="tnum font-mono text-[11px] text-faint">logIndex 0</span>
          <span className="ml-auto inline-flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 bg-verified" aria-hidden />
            <span className="text-[11px] font-medium text-verified">receipt status 1</span>
          </span>
        </div>

        <p className={`mt-3 text-[12px] leading-relaxed ${muted}`}>
          Inclusion proven by the Block Prover precompile. Receipt decoded on-chain.
        </p>
      </div>
    </Chrome>
  );
}
