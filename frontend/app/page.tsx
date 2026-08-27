import Link from 'next/link';

import { LiveSignal } from '@/components/LiveSignal';
import { ProvenanceCaption, ProvenanceChain } from '@/components/ProvenanceChain';
import { ClaimArtifact, ConditionArtifact, EvidenceArtifact } from '@/components/Artifacts';
import { CollideButton } from '@/components/CollideButton';
import { CommitGuard } from '@/components/CommitGuard';
import { Footer } from '@/components/Footer';
import { Plate } from '@/components/Plate';
import { Ticker } from '@/components/Ticker';
import { Eyebrow } from '@/components/ui';
import { DEMO_ARTIFACTS, PRECOMPILES, SOURCE_CHAIN_LABEL, contracts, explorer } from '@/lib/config';
import { shortAddress } from '@/lib/format';

/**
 * The landing page.
 *
 * It has one job: make a stranger understand, in about fifteen seconds, what
 * Clearbook does that nothing else does, then show them a real instance of
 * it rather than describing one.
 *
 * No feature grid, no testimonials, no invented statistics. The only numbers on
 * this page are read from the chain or taken from a breach that actually
 * executed.
 */
export default function LandingPage() {
  return (
    <div className="-mt-10">
      <Ticker />
      <Hero />

      <div className="mx-auto max-w-[1400px] px-6">
        <LiveSignal />
        <TwoGaps />
        <Mechanism />
      </div>

      <SharedEvidence />

      <div className="mx-auto max-w-[1400px] px-6">
        <Covenant />
      </div>

      <Enforcement />

      <div className="mx-auto max-w-[1400px] px-6">
        <Preview />
        <Foundation />
        <Limits />
        <Close />
      </div>

      <Footer />
    </div>
  );
}

function Hero() {
  return (
    <section className="border-b border-rule bg-deep">
      <div className="mx-auto grid max-w-[1400px] gap-x-16 gap-y-12 px-6 py-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,500px)] lg:py-12">
        <div className="flex max-w-2xl flex-col">
          <Eyebrow className="text-onDeepMuted">Evidence-bound credit · Creditcoin</Eyebrow>

          <h1 className="display-xl mt-5 text-onDeep">
            A loan book that
            <br />
            can be proven wrong.
          </h1>

          <p className="mt-6 max-w-xl text-[16px] leading-relaxed text-onDeepMuted">
            Private credit reporting is self-attested. Nobody outside the fund can check whether a
            repayment was real third-party money or the fund cycling its own.
          </p>

          <p className="mt-3.5 max-w-xl text-[16px] leading-relaxed text-onDeep">
            Clearbook is a shared registry of verified transfers. Every claim cites one,{' '}
            <span className="text-onDeep underline decoration-[#3a382f] underline-offset-4">
              no two claims cite the same one
            </span>
            , and anyone can prove a breach in one transaction and be paid for it.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4">
            <Link
              href="/book"
              className="press hard-signal inline-flex h-12 items-center border-2 border-onDeep bg-onDeep px-7 text-[14px] font-semibold uppercase tracking-[0.06em] text-deep transition-colors hover:bg-white"
            >
              Open the credit book
            </Link>
            <Link
              href="/verify"
              className="press inline-flex h-12 items-center border-2 border-[#4a4638] px-7 text-[14px] font-semibold uppercase tracking-[0.06em] text-onDeep transition-colors hover:border-onDeep"
            >
              Verify a transaction yourself
            </Link>
          </div>

          <div className="mt-10 flex flex-wrap gap-x-10 gap-y-3 border-t border-[#2e2c25] pt-5 lg:mt-auto">
            {/*
              Ordered so the two facts that carry the thesis sit together: we read a
              chain carrying real value, and we deployed nothing on it. Naming only
              the demo's staged chain here understated what the vault holds, and
              was inaccurate, since evidence may come from any attested chain.
            */}
            <Fact k="Source chains" v={SOURCE_CHAIN_LABEL} href="/registry" />
            <Fact k="Deployed on Ethereum" v="nothing" />
            <Fact k="Deployed" v="Creditcoin CC3 testnet" />
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

function Fact({ k, v, href }: { k: string; v: string; href?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.14em] text-onDeepMuted">{k}</div>
      {href ? (
        // A claim a reader can go check is worth more than one they cannot.
        <Link
          href={href}
          className="mt-1 block text-[13px] text-onDeep underline decoration-[#3a382f] underline-offset-4 transition-colors hover:decoration-onDeep"
        >
          {v}
        </Link>
      ) : (
        <div className="mt-1 text-[13px] text-onDeep">{v}</div>
      )}
    </div>
  );
}

/**
 * The two gaps.
 *
 * Attestcoin settles one question completely: did this transaction happen. Two
 * questions survive it, and a book that answers neither is not usable as credit
 * evidence no matter how sound each individual proof is.
 *
 * This section exists because the product answers both and previously said so
 * in two places that never met. Reuse was argued in the shared-evidence band;
 * omission was measured on the registry and mentioned nowhere on this page at
 * all. Naming them as a pair is the whole point: they are complementary failure
 * modes, not two features.
 *
 * No cards and no figures here on purpose. The section states a model; the
 * sections after it are where each half is demonstrated on live state.
 */
function TwoGaps() {
  const gaps = [
    {
      n: '01',
      gap: 'Omission',
      question: 'Was the relevant activity exposed at all?',
      mechanism: 'Coverage',
      body: 'Nothing forces an originator to register the loan it would rather nobody read. Clearbook cannot prevent that, so it measures it: the share of an originator\u2019s qualifying transfers, from treasuries it bound by signature, that actually reached a claim. A ratio with its denominator beside it, never a score.',
      href: '/registry',
      cta: 'See it measured',
    },
    {
      n: '02',
      gap: 'Reuse',
      question: 'Has this evidence already been committed?',
      mechanism: 'Evidence exclusivity',
      body: 'A verified fact can back at most one credit claim, and that limit holds across every originator in the registry rather than merely within one. The second attempt does not get a warning. It reverts.',
      href: '/clearance',
      cta: 'Check a transaction',
    },
  ];

  return (
    <section className="rule-t py-14">
      <div className="grid items-end gap-x-16 gap-y-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
        <div>
          <Eyebrow>The two gaps</Eyebrow>
          <h2 className="display-lg mt-3">Proof is not enough.</h2>
        </div>
        <p className="text-[14px] leading-relaxed text-muted lg:pb-2">
          Attestcoin proves a payment happened. It cannot say whether the payments you were shown
          are all of them, and it cannot say whether the one in front of you is already backing
          somebody else’s loan. Clearbook governs both.
        </p>
      </div>

      <ol className="mt-12 grid items-stretch gap-x-16 gap-y-10 sm:grid-cols-2">
        {gaps.map((g) => (
          <li key={g.n} className="flex h-full flex-col border-t-2 border-ink pt-5">
            <div className="flex items-baseline gap-3">
              <span className="ident text-[11px] text-signal">{g.n}</span>
              <h3 className="statement">{g.gap}</h3>
            </div>
            <p className="mt-2 text-[13px] text-faint">{g.question}</p>

            <p className="mt-4 text-[13px] leading-relaxed text-muted">{g.body}</p>

            <div className="mt-auto flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-rule pt-3">
              <span className="eyebrow">{g.mechanism}</span>
              <Link href={g.href} className="link text-[13px]">
                {g.cta} &rarr;
              </Link>
            </div>
          </li>
        ))}
      </ol>

      {/* Where the two answers are actually spent. Stated as one line rather
          than a third column, because clearance and enforcement are downstream
          of the model, not part of it. */}
      <p className="mt-10 max-w-3xl text-[13px] leading-relaxed text-faint">
        Both answers feed the same two places:{' '}
        <Link href="/clearance" className="link">
          clearance
        </Link>{' '}
        before an advance is made, and{' '}
        <Link href="/challenge" className="link">
          enforcement
        </Link>{' '}
        when a covenant the originator published turns out to be broken.
      </p>
    </section>
  );
}

/** The three registers: the distinction the whole product rests on. */
function Mechanism() {
  const registers = [
    {
      n: '01',
      label: 'Source-chain fact',
      claim: 'What the cryptography establishes.',
      body: 'A transaction was included in an attested block, its receipt succeeded, and one of its logs was an ERC-20 transfer between two addresses. The Block Prover precompile decides this, not us and not a server.',
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
    <section className="py-14">
      <div className="grid items-end gap-x-16 gap-y-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <div>
          <Eyebrow>The distinction</Eyebrow>
          <h2 className="display-lg mt-3">Three registers, never blurred.</h2>
        </div>
        <p className="text-[14px] leading-relaxed text-muted lg:pb-2">
          Most systems collapse evidence, inference and claim into one confident sentence. Clearbook
          keeps them apart everywhere: in the contracts, in the interface, and in what it refuses to
          say.
        </p>
      </div>

      <ol className="mt-12 grid gap-6 sm:grid-cols-3">
        {registers.map((r, i) => (
          <li
            key={r.n}
            // Flush baselines, matching the other multi-column blocks on this
            // page. The staircase that used to sit here made three equal
            // registers look like a ranked list, and left the third stranded
            // well below the fold of its own row.
            className="border-t-2 border-ink pt-5"
          >
            <span className="ident text-[11px] text-signal">{r.n}</span>
            <h3 className="statement mt-2">{r.label}</h3>
            <p className="mt-1.5 text-[13px] text-faint">{r.claim}</p>
            <p className="mt-3 text-[13px] leading-relaxed text-muted">{r.body}</p>
          </li>
        ))}
      </ol>
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
    // Full-bleed and set on sunken ground: this is the property the whole
    // registry argument rests on, and it should not read as one more section.
    <section className="border-y-2 border-ink bg-sunken">
      <div className="mx-auto max-w-[1400px] px-6 py-20">
        {/* Heading and lead sit side by side: at this size the headline would
            otherwise leave half the band empty to its right. */}
        <div className="grid items-end gap-x-16 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
          <div>
            <Eyebrow>Shared evidence</Eyebrow>
            <h2 className="display-xl mt-3">
              One fact,
              <br />
              one claim.
            </h2>
          </div>
          <p className="prose-lead lg:pb-3">
            Verification needs no permission. Anyone can prove a transfer happened, including one
            between parties who have never heard of Clearbook. Committing that fact to a claim is
            different: it needs a treasury proven by signature, and it can happen only once.
          </p>
        </div>

        <div className="mt-14 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,300px)]">
          <div className="hard border-2 border-ink bg-surface p-7">
            <div className="flex items-center gap-2.5">
              <span className="inline-block h-3 w-[3px] bg-verified" aria-hidden />
              <h3 className="text-[13px] font-semibold tracking-[0.04em] text-verified">
                Verification is open
              </h3>
            </div>
            <p className="mt-4 text-[14px] leading-relaxed">
              The registry holds facts proven from Ethereum mainnet: real transfers, between
              addresses we do not control, on a chain we have never deployed to. Proving one
              required permission from nobody.
            </p>
          </div>

          <div className="hard border-2 border-ink bg-surface p-7">
            <div className="flex items-center gap-2.5">
              <span className="inline-block h-3 w-[3px] bg-breach" aria-hidden />
              <h3 className="text-[13px] font-semibold tracking-[0.04em] text-breach">
                Commitment is exclusive
              </h3>
            </div>
            <p className="mt-4 text-[14px] leading-relaxed">
              A second originator attempting a fact another has already committed is refused with{' '}
              <code className="font-mono text-[13px]">FactAlreadyUsed</code>. That is not a claim
              made here in prose. It is run below, against the deployment, as you read this.
            </p>
          </div>

          <div className="lg:pt-4">
            <p className="text-[12px] leading-relaxed text-faint">
              This establishes that the same <em>evidence</em> cannot be committed twice. It does
              not establish collateral identity. The same underlying obligation represented by a
              different transaction is not detected, and Clearbook does not claim otherwise.
            </p>
            {/* Two ways in, and they are different questions. The registry is the
                record; clearance is the decision a lender makes before adding to
                it. A reader who has just been told commitment is exclusive is
                exactly the reader who wants to know how to check. */}
            <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2">
              <Link href="/registry" className="link inline-flex text-[14px]">
                Open the evidence registry →
              </Link>
              <Link href="/clearance" className="link inline-flex text-[14px]">
                Check evidence before you lend →
              </Link>
            </div>
          </div>
        </div>

        {/*
          The property above, executed rather than described.

          Full width and beneath both cards, because it is evidence for the pair
          rather than an illustration belonging to one of them. The inputs are
          pinned (DEMO_ARTIFACTS.pinnedFact) so this renders immediately: waiting
          on a registry scan here would put a skeleton where the argument is
          supposed to be. Pinning is sound because consumption is permanent —
          `factConsumedBy` has no clearing path — so the fact cannot quietly
          become available again and make this panel wrong.
        */}
        {/* Same column template as the cards above, with the demonstration
            spanning the two of them. Left to stretch the full width it ran past
            where that row ends and broke the band's rhythm. */}
        <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,300px)]">
          <div className="lg:col-span-2">
            <p className="max-w-2xl text-[13px] leading-relaxed text-muted">
              <span className="text-ink">Exclusivity, live.</span> One verified transfer, already
              committed by Meridian. The panel asks Creditcoin whether a different originator could
              commit the same evidence to a claim of its own. Nothing is connected, and the answer
              below is the contract&rsquo;s, not ours.
            </p>
            <CommitGuard
              factId={DEMO_ARTIFACTS.pinnedFact.factId}
              token={DEMO_ARTIFACTS.pinnedFact.token}
              borrower={DEMO_ARTIFACTS.pinnedFact.borrower}
              amount={DEMO_ARTIFACTS.pinnedFact.amount}
              otherOriginatorId={DEMO_ARTIFACTS.secondOriginatorId}
              otherOriginatorName={DEMO_ARTIFACTS.secondOriginatorName}
              otherOriginatorOwner={DEMO_ARTIFACTS.secondOriginatorOwner}
              incumbentLoanId={DEMO_ARTIFACTS.pinnedFact.incumbentLoanId}
              recordedTxHash={DEMO_ARTIFACTS.duplicateCommitmentTx}
            />
            {/* The optional escalation, deliberately beneath the verdict rather
                than beside it: the eth_call above is the proof, and this only
                turns it into a receipt for a reader who wants one. */}
            <div className="px-5">
              <CollideButton />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Declared rule versus observed evidence: the covenant made legible. */
function Covenant() {
  return (
    <section className="rule-t py-14">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
        <div className="order-1 lg:order-2 lg:pt-1">
          <Eyebrow>The covenant</Eyebrow>
          <h2 className="display-lg mt-4">
            A rule the fund
            <br />
            published itself.
          </h2>
          <p className="mt-4 text-[14px] leading-relaxed text-muted">
            Not a rule we imposed. An originator opts into{' '}
            <code className="font-mono text-[14px] text-ink">CIRCULAR_REPAYMENT</code> at
            registration, publishes its window on-chain, and posts a bond against it. A rule you can
            change after publishing is not a covenant, so it is immutable thereafter.
          </p>
        </div>

        <div className="order-2 grid gap-px bg-rule sm:grid-cols-2 lg:order-1">
          <div className="bg-paper p-7">
            <Eyebrow>Declared</Eyebrow>
            <p className="mt-3 text-[14px] leading-relaxed">
              No repayment may come from an address the originator&rsquo;s own treasury funded for
              at least the repayment amount, in the same token, within{' '}
              <span className="tnum font-medium">5,000</span> source-chain blocks.
            </p>
            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              In plain terms: the money coming back should not be the fund&rsquo;s own money going
              out and returning.
            </p>
          </div>

          <div className="bg-paper p-7">
            <Eyebrow>Observed</Eyebrow>
            <p className="mt-3 text-[14px] leading-relaxed">
              The treasury sent the payer <span className="tnum font-medium">0.01 WETH</span> at
              block <span className="tnum font-medium">11,538,688</span>. The payer returned{' '}
              <span className="tnum font-medium">0.01 WETH</span> to the treasury at block{' '}
              <span className="tnum font-medium">11,538,689</span>.
            </p>
            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              One block apart, well inside the declared window. Both transfers independently
              verified.
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
                A breach establishes that two verified transfers occurred in a specific
                relationship, and therefore that the originator&rsquo;s own published rule was not
                met. It does not establish intent, control of either address, the existence of an
                off-chain loan, or any violation of law.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Enforcement: the consequence, on a dark band.
 *
 * Placed here for two reasons. Narratively it is the payoff: the covenant was
 * broken, and this is what the protocol did about it. Compositionally the page
 * needed a beat. Without it the hero is the only moment of contrast and
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
      <Plate
        name="archive"
        className="absolute inset-0 -z-10 h-full w-full opacity-25"
        tone="deep"
      />
      <div className="band-grid band-grid-fade absolute inset-0 -z-10" aria-hidden />
      <div
        className="absolute inset-0 -z-10 bg-gradient-to-br from-deep via-deep/94 to-deep/80"
        aria-hidden
      />

      <div className="mx-auto grid max-w-[1400px] gap-14 px-6 py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,480px)] lg:py-24">
        <div className="flex flex-col">
          <Eyebrow>Enforcement</Eyebrow>
          <h2 className="display-lg mt-4 text-onDeep">
            One transaction.
            <br />
            No arbitrator.
          </h2>
          <p className="prose-lead mt-5 max-w-md text-onDeepMuted">
            There is no dispute period, no vote, no committee, and no appeal, because there is
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
            you precisely which one refused it, rather than simply that it did.
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
 * breach that executed on-chain. Markup, not screenshots, so they cannot drift
 * from what the app actually does.
 */
function Preview() {
  return (
    <section className="rule-t py-14">
      <div className="max-w-2xl">
        <Eyebrow>The interface</Eyebrow>
        <h2 className="display-lg mt-4">Built to be read closely.</h2>
        <p className="prose-lead mt-5">
          A credit analyst should be able to follow it, and a protocol engineer should be able to
          drill to the log index. The same screen serves both, because the difference between them
          is depth, not a different set of facts.
        </p>
      </div>

      <div className="mt-12 grid items-start gap-x-10 gap-y-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="tilt-l lg:mt-10">
          <ClaimArtifact />
          <p className="mt-4 max-w-md text-[13px] leading-relaxed text-muted">
            Status, covenant, and the evidence cited. Nothing self-reported.
          </p>
        </div>
        <div className="tilt-r">
          <EvidenceArtifact />
          <p className="mt-4 max-w-md text-[13px] leading-relaxed text-muted">
            The transaction, its receipt status, and the transaction-local log index: the
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
        <a
          href={explorer.ccAddress(PRECOMPILES.blockProver)}
          target="_blank"
          rel="noreferrer noopener"
          className="ident ident-link"
        >
          {shortAddress(PRECOMPILES.blockProver)}
        </a>
      ),
      note: 'Called directly. No indexer, no relayer, no oracle.',
    },
    {
      k: 'Replay key',
      v: <span className="ident">chainKey · block · txIndex · logIndex</span>,
      note: 'Log-level, stricter than the reference. One transaction can carry many relevant transfers.',
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
    <section className="rule-t py-14">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
        <div>
          <Eyebrow>Technical foundation</Eyebrow>
          <h2 className="display-lg mt-4">
            Nothing here is
            <br />a server&rsquo;s word.
          </h2>
          <p className="prose-lead mt-5 max-w-sm">
            Replace the precompile with an indexer and the challenge becomes &ldquo;trust our
            backend&rdquo;, which is the thing being eliminated. Money is slashed on these facts, so
            a server&rsquo;s assertion is not an acceptable basis.
          </p>
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
      'An originator that funds a payer from an address it never binds does not breach it. Detection is depth-1 by construction, which is why the rule is framed as a covenant the originator chose, not as fraud detection.',
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

  // Mirrored against the section above it: that one puts its heading on the
  // left, this one on the right. The alternation is what stops four stacked
  // sections reading as one repeated template.
  return (
    <section className="rule-t py-14">
      <div className="grid gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <ul className="order-2 grid gap-x-12 gap-y-10 sm:grid-cols-2 lg:order-1">
          {limits.map(([k, v], n) => (
            <li
              key={k}
              // Flush baselines. The alternating offset that used to sit here
              // read as a rendering fault rather than as composition: with the
              // heading in the right-hand column, a dropped second item put its
              // rule below its neighbour's and the numbering looked misordered.
              className="max-w-md border-t-2 border-ink pt-4"
            >
              <span className="ident text-[11px] text-signal">
                {String(n + 1).padStart(2, '0')}
              </span>
              <h3 className="statement mt-2">{k}</h3>
              <p className="mt-2.5 text-[13px] leading-relaxed text-muted">{v}</p>
            </li>
          ))}
        </ul>

        <div className="order-1 lg:order-2 lg:pt-2">
          <Eyebrow>Honest limits</Eyebrow>
          <h2 className="display-lg mt-3">What this cannot do.</h2>
          <p className="mt-4 text-[14px] leading-relaxed text-muted">
            Stated here rather than buried, because a system that claims less and proves it is worth
            more than one that claims everything.
          </p>
        </div>
      </div>
    </section>
  );
}

function Close() {
  return (
    <section className="rule-t py-14">
      <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-8">
        <h2 className="display-lg max-w-xl">
          Read the book.
          <br />
          Try to break it.
        </h2>

        <div className="flex flex-wrap gap-x-6 gap-y-4">
          <Link
            href="/book"
            className="press hard-sm inline-flex h-12 items-center border-2 border-ink bg-ink px-7 text-[14px] font-semibold uppercase tracking-[0.06em] text-paper transition-colors hover:bg-black"
          >
            Open the credit book
          </Link>
          <Link
            href="/challenge"
            className="press hard-rule inline-flex h-12 items-center border-2 border-ink px-7 text-[14px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-sunken"
          >
            Challenge console
          </Link>
        </div>
      </div>
    </section>
  );
}
