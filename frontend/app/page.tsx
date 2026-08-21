import Link from 'next/link';

import { LiveSignal } from '@/components/LiveSignal';
import { ProvenanceCaption, ProvenanceChain } from '@/components/ProvenanceChain';
import { Eyebrow } from '@/components/ui';
import { PRECOMPILES, SOURCE_CHAIN, contracts, explorer } from '@/lib/config';
import { shortAddress } from '@/lib/format';

/**
 * The landing page.
 *
 * It has one job: make a stranger understand, in about fifteen seconds, what
 * Clearbook does that nothing else does — and then show them a real instance of
 * it rather than describing one.
 *
 * No feature grid, no testimonials, no invented statistics. The only numbers on
 * this page are read from the chain or taken from a breach that actually
 * executed.
 */
export default function LandingPage() {
  return (
    <div className="-mt-10">
      <Hero />

      <div className="mx-auto max-w-[1400px] px-6">
        <LiveSignal />
        <Mechanism />
        <Covenant />
        <Foundation />
        <Limits />
        <Close />
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section className="border-b border-rule bg-deep">
      <div className="mx-auto grid max-w-[1400px] gap-16 px-6 py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)] lg:py-28">
        <div className="flex max-w-2xl flex-col">
          <Eyebrow className="text-onDeepMuted">Evidence-bound credit · Creditcoin</Eyebrow>

          <h1 className="display-xl mt-6 text-onDeep">
            A loan book that
            <br />
            can be proven wrong.
          </h1>

          <p className="mt-7 max-w-xl text-[17px] leading-relaxed text-onDeepMuted">
            Private credit reporting is self-attested. Nobody outside the fund can check whether a
            &ldquo;repayment&rdquo; was real third-party money or the fund cycling its own.
          </p>

          <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-onDeep">
            Clearbook binds every claim to a cryptographically verified transfer on another chain,
            and lets <span className="text-onDeep underline decoration-[#3a382f] underline-offset-4">anyone</span>{' '}
            prove a covenant breach in a single transaction — and be paid for it.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4">
            <Link
              href="/book"
              className="inline-flex h-11 items-center border border-onDeep bg-onDeep px-6 text-[14px] font-medium text-deep transition-colors hover:bg-white"
            >
              Open the credit book
            </Link>
            <Link
              href="/verify"
              className="text-[14px] text-onDeepMuted underline decoration-[#3a382f] underline-offset-[6px] transition-colors hover:text-onDeep"
            >
              Verify a transaction yourself
            </Link>
          </div>

          <div className="mt-14 flex flex-wrap gap-x-10 gap-y-3 border-t border-[#2e2c25] pt-6 lg:mt-auto">
            <Fact k="Deployed" v="Creditcoin CC3 testnet" />
            <Fact k="Source chain" v={SOURCE_CHAIN.name} />
            <Fact k="Deployed on Ethereum" v="nothing" />
          </div>
        </div>

        <div className="lg:pt-2">
          <Eyebrow className="mb-6 text-onDeepMuted">One breach, end to end</Eyebrow>
          <ProvenanceChain />
          <ProvenanceCaption />
        </div>
      </div>
    </section>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.14em] text-onDeepMuted">{k}</div>
      <div className="mt-1 text-[13px] text-onDeep">{v}</div>
    </div>
  );
}

/** The three registers — the distinction the whole product rests on. */
function Mechanism() {
  const registers = [
    {
      n: '01',
      label: 'Source-chain fact',
      claim: 'What the cryptography establishes.',
      body: 'A transaction was included in an attested block, its receipt succeeded, and that one of its logs was an ERC-20 transfer of a given amount between two addresses. The Creditcoin Block Prover precompile decides this — not us, and not a server.',
    },
    {
      n: '02',
      label: 'Clearbook interpretation',
      claim: 'What this application decides on top of it.',
      body: 'That an address was bound to an originator by signature, that this transfer is the disbursement of a particular loan, and whether it satisfies the covenant the originator published and bonded against.',
    },
    {
      n: '03',
      label: 'Not claimed',
      claim: 'What is never asserted.',
      body: 'That an address belongs to any person or company. That an off-chain agreement exists. That anyone intended anything. That any law was broken. That the book is complete.',
    },
  ];

  return (
    <section className="py-20">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div>
          <Eyebrow>The distinction</Eyebrow>
          <h2 className="display-lg mt-4">
            Three registers,
            <br />
            never blurred.
          </h2>
          <p className="prose-lead mt-5 max-w-sm">
            Most systems collapse evidence, inference and claim into one confident sentence.
            Clearbook keeps them apart everywhere — in the contracts, in the interface, and in what
            it refuses to say.
          </p>
        </div>

        <dl className="rule-t">
          {registers.map((r) => (
            <div key={r.n} className="rule-b grid gap-4 py-7 sm:grid-cols-[3rem_minmax(0,14rem)_minmax(0,1fr)]">
              <div className="ident text-[11px] text-faint">{r.n}</div>
              <dt>
                <div className="text-[15px] font-medium">{r.label}</div>
                <div className="mt-1 text-[13px] text-muted">{r.claim}</div>
              </dt>
              <dd className="text-[13px] leading-relaxed text-muted">{r.body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/** Declared rule versus observed evidence — the covenant made legible. */
function Covenant() {
  return (
    <section className="rule-t py-20">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div>
          <Eyebrow>The covenant</Eyebrow>
          <h2 className="display-lg mt-4">
            A rule the fund
            <br />
            published itself.
          </h2>
          <p className="prose-lead mt-5 max-w-sm">
            Not a rule we imposed. An originator opts into <code className="font-mono text-[14px] text-ink">CIRCULAR_REPAYMENT</code> at
            registration, publishes its window on-chain, and posts a bond against it. A rule you can
            change after publishing is not a covenant, so it is immutable thereafter.
          </p>
        </div>

        <div className="grid gap-px bg-rule sm:grid-cols-2">
          <div className="bg-paper p-7">
            <Eyebrow>Declared</Eyebrow>
            <p className="mt-3 text-[14px] leading-relaxed">
              No repayment may come from an address the originator&rsquo;s own treasury funded for at
              least the repayment amount, in the same token, within{' '}
              <span className="tnum font-medium">5,000</span> source-chain blocks.
            </p>
            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              In plain terms: the money coming back should not be the fund&rsquo;s own money going out
              and returning.
            </p>
          </div>

          <div className="bg-paper p-7">
            <Eyebrow>Observed</Eyebrow>
            <p className="mt-3 text-[14px] leading-relaxed">
              The treasury sent the payer <span className="tnum font-medium">0.01 WETH</span> at block{' '}
              <span className="tnum font-medium">11,538,688</span>. The payer returned{' '}
              <span className="tnum font-medium">0.01 WETH</span> to the treasury at block{' '}
              <span className="tnum font-medium">11,538,689</span>.
            </p>
            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              One block apart, well inside the declared window. Both transfers independently verified.
            </p>
          </div>

          <div className="bg-paper p-7 sm:col-span-2">
            <div className="flex flex-wrap items-baseline justify-between gap-4">
              <div>
                <Eyebrow>Result</Eyebrow>
                <div className="mt-3 flex items-baseline gap-3">
                  <span className="status text-breach">Covenant breached</span>
                </div>
              </div>
              <p className="max-w-xl text-[12px] leading-relaxed text-faint">
                A breach establishes that two verified transfers occurred in a specific relationship,
                and therefore that the originator&rsquo;s own published rule was not met. It does not
                establish intent, control of either address, the existence of an off-chain loan, or
                any violation of law.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Foundation() {
  const items: Array<{ k: string; v: React.ReactNode; note: string }> = [
    {
      k: 'Block Prover precompile',
      v: (
        <a href={explorer.ccAddress(PRECOMPILES.blockProver)} target="_blank" rel="noreferrer noopener" className="ident ident-link">
          {shortAddress(PRECOMPILES.blockProver)}
        </a>
      ),
      note: 'Called directly. No indexer, no relayer, no oracle.',
    },
    {
      k: 'Chain keys',
      v: <span className="text-[13px]">resolved at runtime</span>,
      note: 'Never hardcoded. Read from the ChainInfo precompile on every run.',
    },
    {
      k: 'Replay key',
      v: <span className="ident">chainKey · block · txIndex · logIndex</span>,
      note: 'Log-level, stricter than the reference implementation. One transaction can carry many relevant transfers.',
    },
    {
      k: 'Receipt status',
      v: <span className="text-[13px]">asserted by us</span>,
      note: 'The precompile proves inclusion, not success. A reverted transfer moved no value.',
    },
    {
      k: 'Forged proofs',
      v: <span className="text-[13px] text-verified">6 of 6 rejected</span>,
      note: 'A valid proof mutated six ways; every mutation reverted on-chain.',
    },
    {
      k: 'Evidence latency',
      v: <span className="tnum text-[13px]">~8–10 min</span>,
      note: 'Measured, not quoted. Attestors attest finalized blocks; that wait is the security property.',
    },
  ];

  return (
    <section className="rule-t py-20">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div>
          <Eyebrow>Technical foundation</Eyebrow>
          <h2 className="display-lg mt-4">
            Nothing here is
            <br />
            a server&rsquo;s word.
          </h2>
          <p className="prose-lead mt-5 max-w-sm">
            Replace the precompile with an indexer and the challenge becomes &ldquo;trust our
            backend&rdquo; — which is the thing being eliminated. Money is slashed on these facts, so
            a server&rsquo;s assertion is not an acceptable basis.
          </p>
          {contracts.clearbook ? (
            <div className="mt-7">
              <Eyebrow className="mb-2">Deployed</Eyebrow>
              <a
                href={explorer.ccAddress(contracts.clearbook)}
                target="_blank"
                rel="noreferrer noopener"
                className="ident ident-link"
              >
                {contracts.clearbook}
              </a>
            </div>
          ) : null}
        </div>

        <dl className="rule-t">
          {items.map((i) => (
            <div
              key={i.k}
              className="rule-b grid items-baseline gap-3 py-5 sm:grid-cols-[minmax(0,13rem)_minmax(0,12rem)_minmax(0,1fr)]"
            >
              <dt className="text-[13px] font-medium">{i.k}</dt>
              <dd>{i.v}</dd>
              <dd className="text-[12px] leading-relaxed text-faint">{i.note}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function Limits() {
  const limits = [
    ['The covenant is bounded, not universal', 'An originator that funds a payer from an address it never binds does not breach it. Detection is depth-1 by construction — which is why the rule is framed as a covenant the originator chose, not as fraud detection.'],
    ['Absence is unprovable', 'Merkle inclusion proofs cannot show that a transaction did not occur. Clearbook never certifies a book as clean; it makes specific claims refutable.'],
    ['An address is not an entity', 'A bound treasury is an address that produced a signature. Nothing more.'],
    ['Ethereum only', 'Sepolia and Ethereum Mainnet are the source chains the attestor set supports today.'],
  ];

  return (
    <section className="rule-t py-20">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div>
          <Eyebrow>Honest limits</Eyebrow>
          <h2 className="display-lg mt-4">What this
            <br />
            cannot do.</h2>
          <p className="prose-lead mt-5 max-w-sm">
            Stated here rather than buried, because a system that claims less and proves it is worth
            more than one that claims everything.
          </p>
        </div>

        <dl className="rule-t">
          {limits.map(([k, v]) => (
            <div key={k} className="rule-b grid gap-3 py-5 sm:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
              <dt className="text-[13px] font-medium">{k}</dt>
              <dd className="text-[13px] leading-relaxed text-muted">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function Close() {
  return (
    <section className="rule-t py-20">
      <div className="flex flex-wrap items-end justify-between gap-10">
        <div className="max-w-xl">
          <h2 className="display-lg">
            Read the book.
            <br />
            Try to break it.
          </h2>
          <p className="prose-lead mt-5">
            One claim on it is breachable and one is not. The interface will tell you which of the
            eleven conditions holds before you ever open a wallet.
          </p>
        </div>

        <div className="flex flex-wrap gap-x-8 gap-y-4">
          <Link
            href="/book"
            className="inline-flex h-11 items-center border border-ink bg-ink px-6 text-[14px] font-medium text-paper transition-colors hover:bg-black"
          >
            Open the credit book
          </Link>
          <Link
            href="/challenge"
            className="inline-flex h-11 items-center border border-rule-strong px-6 text-[14px] font-medium transition-colors hover:border-ink"
          >
            Challenge console
          </Link>
        </div>
      </div>
    </section>
  );
}
