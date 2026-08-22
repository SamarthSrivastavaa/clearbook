import Link from 'next/link';

import { LiveSignal } from '@/components/LiveSignal';
import { ProvenanceCaption, ProvenanceChain } from '@/components/ProvenanceChain';
import { ClaimArtifact, ConditionArtifact, EvidenceArtifact } from '@/components/Artifacts';
import { Plate } from '@/components/Plate';
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
      </div>

      <LedgerBand />

      <div className="mx-auto max-w-[1400px] px-6">
        <SharedEvidence />
        <Covenant />
      </div>

      <Enforcement />

      <div className="mx-auto max-w-[1400px] px-6">
        <Preview />
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
            Clearbook is a shared registry of cryptographically verified transfers. Every claim must
            cite one,{' '}
            <span className="text-onDeep underline decoration-[#3a382f] underline-offset-4">
              no two claims can cite the same one
            </span>
            , and anyone can prove a covenant breach in a single transaction — and be paid for it.
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
      body: 'A transaction was included in an attested block, its receipt succeeded, and one of its logs was an ERC-20 transfer between two addresses. The Block Prover precompile decides this — not us, and not a server.',
    },
    {
      n: '02',
      label: 'Clearbook interpretation',
      claim: 'What this application decides on top of it.',
      body: 'That an address was bound to an originator by signature, that this transfer is a particular loan’s disbursement, and whether it satisfies the covenant that originator bonded against.',
    },
    {
      n: '03',
      label: 'Not claimed',
      claim: 'What is never asserted.',
      body: 'That an address belongs to any person or company. That an off-chain agreement exists. That anyone intended anything. That any law was broken. That the book is complete.',
    },
  ];

  return (
    <section className="py-16">
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

/**
 * The shared registry, and the one property that makes sharing worth anything.
 *
 * A fund keeping its own evidence gains nothing from verification it already
 * trusts. The value appears only when the namespace is shared: a fact spent by
 * one originator is then visibly unavailable to every other.
 */
function SharedEvidence() {
  return (
    <section className="rule-t py-16">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div>
          <Eyebrow>Shared evidence</Eyebrow>
          <h2 className="display-lg mt-4">One fact, one claim.</h2>
          <p className="prose-lead mt-5 max-w-sm">
            Verification needs no permission — anyone can prove a transfer happened, including one
            between parties who have never heard of Clearbook. Committing that fact to a claim is
            different: it needs a treasury proven by signature, and it can happen only once.
          </p>
          <Link href="/registry" className="link mt-6 inline-flex text-[14px]">
            Open the evidence registry →
          </Link>
        </div>

        <div>
          <dl className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
            <div>
              <dt className="statement">Verification is open</dt>
              <dd className="mt-2 text-[13px] leading-relaxed text-muted">
                The registry holds facts proven from Ethereum mainnet — real transfers, between
                addresses we do not control, on a chain we have never deployed to. Proving one
                required permission from nobody.
              </dd>
            </div>
            <div>
              <dt className="statement">Commitment is exclusive</dt>
              <dd className="mt-2 text-[13px] leading-relaxed text-muted">
                A second originator attempting a fact another has already committed is refused with{' '}
                <code className="font-mono text-[12px]">FactAlreadyUsed</code>. The registry runs
                that call live against the deployment rather than asserting the outcome.
              </dd>
            </div>
          </dl>

          <p className="mt-8 max-w-xl text-[12px] leading-relaxed text-faint">
            This establishes that the same <em>evidence</em> cannot be committed twice. It does not
            establish collateral identity — the same underlying obligation represented by a different
            transaction is not detected, and Clearbook does not claim otherwise.
          </p>
        </div>
      </div>
    </section>
  );
}

/** Declared rule versus observed evidence — the covenant made legible. */
function Covenant() {
  return (
    <section className="rule-t py-16">
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
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div>
                <Eyebrow>Result</Eyebrow>
                {/* The loudest thing this system does. Rendering it as another
                    small row understated it by an order of magnitude. */}
                <p className="verdict verdict-breach mt-3">
                  <span className="inline-block h-[0.9em] w-[3px] shrink-0 bg-breach" aria-hidden />
                  Covenant breached
                </p>
                <p className="mt-3 max-w-sm text-[13px] leading-relaxed text-muted">
                  All eleven conditions held. The bond was slashed in the same transaction that
                  proved it.
                </p>
              </div>
              <p className="max-w-sm text-[12px] leading-relaxed text-faint">
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

/**
 * A full-bleed plate, and one sentence.
 *
 * The page needed somewhere to rest. Everything around it is dense — ledgers,
 * expressions, addresses — and a reader who never gets a pause stops reading.
 * The image carries no information: it is paper, photographed, because that is
 * what this product is a book of.
 */
function LedgerBand() {
  return (
    <section className="relative isolate mt-4 overflow-hidden">
      <Plate name="ledger" className="absolute inset-0 -z-10 h-full w-full" tone="light" />
      {/* Scrim: the statement has to stay legible whatever the photograph does. */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-deep/92 via-deep/70 to-deep/25" aria-hidden />

      <div className="mx-auto max-w-[1400px] px-6 py-20 lg:py-24">
        <p className="statement max-w-xl text-onDeep">
          Every claim on this book points at something that already happened somewhere else — and
          anyone can go and check it.
        </p>
        <p className="mt-4 max-w-md text-[13px] leading-relaxed text-onDeepMuted">
          The evidence is ordinary ERC-20 transfers on a token we do not control, on a chain we did
          not deploy to.
        </p>
      </div>
    </section>
  );
}

/**
 * Enforcement — the consequence, on a dark band.
 *
 * Placed here for two reasons. Narratively it is the payoff: the covenant was
 * broken, and this is what the protocol did about it. Compositionally the page
 * needed a beat — without it the hero is the only moment of contrast and
 * everything after it reads as one uninterrupted grey column.
 */
function Enforcement() {
  const ledger: Array<[string, string, string]> = [
    ['Originator bond', '−1.0 tCTC', 'slashed in full'],
    ['Challenger', '+0.5 tCTC', 'paid on success'],
    ['Protocol sink', '+0.5 tCTC', 'burn address'],
  ];

  return (
    <section className="band-deep relative isolate mt-20 overflow-hidden">
      {/* Depth, not decoration: the band is flat black otherwise, and this is the
          one place where institutional weight is the point. */}
      <Plate name="archive" className="absolute inset-0 -z-10 h-full w-full opacity-25" tone="deep" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-deep via-deep/94 to-deep/80" aria-hidden />

      <div className="mx-auto grid max-w-[1400px] gap-14 px-6 py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,480px)] lg:py-24">
        <div className="flex flex-col">
          <Eyebrow>Enforcement</Eyebrow>
          <h2 className="display-lg mt-4 text-onDeep">
            One transaction.
            <br />
            No arbitrator.
          </h2>
          <p className="prose-lead mt-5 max-w-md text-onDeepMuted">
            There is no dispute period, no vote, no committee, and no appeal — because there is
            nothing to deliberate. The conditions are arithmetic over evidence the chain already
            verified, so the contract can settle them itself.
          </p>

          <dl className="mt-10 border-t border-[#2e2c25]">
            {ledger.map(([k, v, note]) => (
              <div
                key={k}
                className="flex flex-wrap items-baseline gap-x-5 gap-y-1 border-b border-[#2e2c25] py-4"
              >
                <dt className="min-w-[9.5rem] text-[13px] text-onDeepMuted">{k}</dt>
                <dd className="tnum font-mono text-[15px] font-medium text-onDeep">{v}</dd>
                <dd className="ml-auto text-[12px] text-onDeepMuted">{note}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-6 max-w-md text-[12px] leading-relaxed text-onDeepMuted">
            Half the slashed bond pays whoever proved it; half is burned. The challenger posts no
            bond of their own, so an invalid challenge costs them gas and nothing else.
          </p>
        </div>

        <div className="flex flex-col lg:pt-2">
          <Eyebrow>What the contract checked</Eyebrow>
          <div className="mt-5">
            <ConditionArtifact onDeep />
          </div>
          <p className="mt-6 max-w-md text-[12px] leading-relaxed text-onDeepMuted">
            One of eleven. Each is a named condition with its own error, so a failed challenge tells
            you precisely which one refused it — not simply that it did.
          </p>
          {/* Bottom-aligned so the column closes level with the ledger opposite,
              rather than leaving the band visibly unbalanced. */}
          <Link
            href="/challenge"
            className="mt-8 inline-flex self-start text-[13px] text-onDeep underline decoration-[#4a4638] underline-offset-[6px] transition-colors hover:decoration-onDeep lg:mt-auto"
          >
            Open the challenge console →
          </Link>
        </div>
      </div>
    </section>
  );
}

/**
 * The product itself, quoted.
 *
 * Everything above argues that this system is real. This shows it. The two
 * panels are the application's own components rendered with values from the
 * breach that executed on-chain — markup, not screenshots, so they cannot drift
 * from what the app actually does.
 */
function Preview() {
  return (
    <section className="rule-t py-16">
      <div className="max-w-2xl">
        <Eyebrow>The interface</Eyebrow>
        <h2 className="display-lg mt-4">Built to be read closely.</h2>
        <p className="prose-lead mt-5">
          A credit analyst should be able to follow it, and a protocol engineer should be able to
          drill to the log index. The same screen serves both, because the difference between them
          is depth, not a different set of facts.
        </p>
      </div>

      <div className="mt-12 grid items-start gap-8 lg:grid-cols-2">
        <div>
          <ClaimArtifact />
          <p className="mt-4 max-w-md text-[13px] leading-relaxed text-muted">
            Status, covenant, and the evidence cited. Nothing self-reported.
          </p>
        </div>
        <div>
          <EvidenceArtifact />
          <p className="mt-4 max-w-md text-[13px] leading-relaxed text-muted">
            The transaction, its receipt status, and the transaction-local log index — the
            coordinates the replay key is computed over.
          </p>
        </div>
      </div>

      <div className="mt-10">
        <Link href="/book" className="link text-[14px]">
          Open the credit book →
        </Link>
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
      note: 'Log-level, stricter than the reference. One transaction can carry many relevant transfers.',
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
      note: 'Measured, not quoted. The wait is the security property.',
    },
  ];

  return (
    <section className="rule-t py-16">
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
          {/* Fills the column's dead space with the one image that is literally
              about authentication rather than atmosphere. */}
          <Plate name="seal" className="mt-9 aspect-[4/3] w-full max-w-[300px]" />

          {contracts.clearbook ? (
            <div className="mt-8">
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
  const limits: Array<[string, string]> = [
    [
      'The covenant is bounded, not universal',
      'An originator that funds a payer from an address it never binds does not breach it. Detection is depth-1 by construction — which is why the rule is framed as a covenant the originator chose, not as fraud detection.',
    ],
    [
      'Absence is unprovable',
      'Merkle inclusion proofs cannot show that a transaction did not occur. Clearbook never certifies a book as clean; it makes specific claims refutable.',
    ],
    [
      'An address is not an entity',
      'A bound treasury is an address that produced a signature. Nothing more.',
    ],
    [
      'Ethereum only',
      'Sepolia and Ethereum Mainnet are the source chains the attestor set supports today.',
    ],
  ];

  // Composed deliberately unlike the specification table above it: no rules, no
  // two-column ledger, more air. This section is the product declining to claim
  // things, and it should read quieter than the section that makes claims.
  return (
    <section className="rule-t py-16">
      <div className="max-w-2xl">
        <Eyebrow>Honest limits</Eyebrow>
        <h2 className="display-lg mt-4">What this cannot do.</h2>
        <p className="prose-lead mt-5">
          Stated here rather than buried, because a system that claims less and proves it is worth
          more than one that claims everything.
        </p>
      </div>

      <ul className="mt-14 grid gap-x-16 gap-y-12 sm:grid-cols-2">
        {limits.map(([k, v]) => (
          <li key={k} className="max-w-md">
            <h3 className="statement">{k}</h3>
            <p className="mt-3 text-[13px] leading-relaxed text-muted">{v}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Close() {
  return (
    <section className="rule-t py-16">
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
