import type { DocPage } from '../types';

/** The "why this and not that" pages. Each answers a real objection. */

const whyAttestcoin: DocPage = {
  slug: 'why-attestcoin',
  title: 'Why Attestcoin',
  summary: 'Clearbook must establish facts about a chain it does not control. Attestcoin is the mechanism.',
  audience: 'Developers',
  blocks: [
    {
      t: 'lead',
      text: 'Clearbook has to establish facts about activity on a chain it does not control, cannot instrument, and never deployed to. Attestcoin is what makes that possible on Creditcoin.',
    },
    { t: 'h', text: 'The requirement' },
    {
      t: 'p',
      text: 'Money is slashed on these facts. So the question "did this transfer happen?" cannot be answered by anything that could be wrong on purpose. It has to be answered by something a contract can check.',
    },
    {
      t: 'flow',
      steps: [
        { label: 'Source transaction', sub: 'Ethereum. Nothing to do with us' },
        { label: 'Attestation', sub: 'Attestors reach quorum on the finalized block' },
        { label: 'Proof', sub: 'Merkle inclusion plus continuity roots' },
        { label: 'Creditcoin verification', sub: 'The Block Prover precompile rules on it', tone: 'verified' },
        { label: 'Clearbook interpretation', sub: 'What this application decides it means' },
      ],
    },
    { t: 'h', text: 'The inversion' },
    {
      t: 'p',
      text: 'The official design-pattern documentation describes a **cooperative** source chain: deploy a contract, emit a purpose-built event, watch for it. Its own guidance is to avoid initiating cross-chain functionality from standard `Transfer` events, and it does not address the case where you do not control the source contract.',
    },
    {
      t: 'p',
      text: 'Clearbook operates in exactly that uncovered case, and it does so deliberately. **You cannot ask a fund that is cycling its own money to emit a `CircularRepaymentOccurred` event.** For covenant enforcement, uninstrumented third-party evidence is the only kind that exists.',
    },
    { t: 'h', text: 'What that costs, and how it is paid' },
    {
      t: 'p',
      text: 'Working from generic `Transfer` logs reintroduces the ambiguity the cooperative pattern avoids. Four mechanisms close it:',
    },
    {
      t: 'list',
      items: [
        '**Log-level identity.** `keccak256(chainKey, blockHeight, txIndex, logIndex)`, so many transfers inside one transaction stay distinct from one another',
        '**Transaction-local `logIndex`.** An index into the receipt’s own log array, not the block-global index that `eth_getLogs` reports',
        '**Independent receipt check.** The precompile proves inclusion, not success, so `receiptStatus == 1` is asserted separately',
        '**EIP-712 treasury binding.** An address counts as an originator’s only if that originator proved control of its key by signature',
      ],
    },
    {
      t: 'note',
      tone: 'verified',
      title: 'The test that matters',
      text: 'Replace the precompile with anything that merely reports, and a challenge becomes "trust our backend", which is precisely the thing being eliminated. That is the sense in which Attestcoin is load-bearing rather than decorative: remove it and there is no product left, only a database with opinions about other chains.',
    },
    {
      t: 'next',
      items: [
        { href: '/docs/why-not-a-database', label: 'Why not a database', sub: 'The trust-boundary argument' },
        { href: '/docs/security', label: 'Security', sub: 'What a malicious prover can and cannot do' },
      ],
    },
  ],
};

const whyCreditcoin: DocPage = {
  slug: 'why-creditcoin',
  title: 'Why Creditcoin',
  summary: 'The enforcement state has to be shared, deterministic, and economically final.',
  audience: 'Developers',
  blocks: [
    {
      t: 'lead',
      text: 'Verified evidence is only half of the problem. The consumption and enforcement state has to live somewhere that no single participant controls, on a chain that can check another chain without asking anyone.',
    },
    { t: 'h', text: 'What the state has to be' },
    {
      t: 'table',
      head: ['Requirement', 'Why Clearbook needs it'],
      rows: [
        ['Shared', 'Fact uniqueness only means something across a common namespace. Per-fund records give nothing, because the fraud being prevented is precisely the reuse of one piece of evidence across two books'],
        ['Deterministic', 'Eleven conditions must produce the same verdict for everyone who evaluates them, including the originator being challenged'],
        ['Permissionless', 'A challenge that needs approval is not a check on the party granting approval'],
        ['Economically final', 'A verdict that does not move money is an opinion. The slash settles in the same transaction that proves the breach'],
        ['Able to verify source chains', 'Via the precompiles. This is the requirement that is not substitutable, and the reason the protocol is on Creditcoin rather than a generic L1'],
      ],
    },
    {
      t: 'p',
      text: 'Four of those five are available on any competent smart-contract chain. The fifth is not. Clearbook needs a chain where **a contract can verify another chain\u2019s history natively**, inside the same transaction that acts on it, without a service in the path. That is what Creditcoin provides through the Block Prover and ChainInfo precompiles.',
    },

    { t: 'h', text: 'What it would take anywhere else' },
    {
      t: 'p',
      text: 'The requirement sounds modest until you cost the alternatives. Each of these is a real way to get Ethereum state into a contract on another chain, and each one pays for it somewhere.',
    },
    {
      t: 'table',
      head: ['Approach', 'What it would cost'],
      rows: [
        ['An Ethereum light client in Solidity', 'The contract must track consensus itself: sync committees, header chains, finality. It is the most trust-minimised option and by far the most expensive to run and maintain, and it moves a consensus implementation into the protocol\u2019s attack surface'],
        ['A bridge or general message-passing layer', 'Inherits the bridge\u2019s validator set. The evidence is then only as good as that set, and the challenge becomes a claim about the bridge rather than about the loan'],
        ['A price-feed style oracle', 'The oracle reports that a transfer happened. Nothing proves it. Every downstream guarantee reduces to trusting whoever runs the feed, which is the exact failure the product exists to remove'],
        ['Optimistic claims with fraud proofs', 'Adds a second dispute window on top of the one the covenant already has, and needs its own watcher set to be meaningful. Two layers of challenge to establish a fact a precompile can settle immediately'],
      ],
    },
    {
      t: 'p',
      text: 'Attestcoin collapses that table into a single call. `EvidenceVault` hands the precompile a proof bundle and receives a verdict in the same transaction, in roughly 0.8 seconds of call time and one block of latency. No service sits in the path, and nothing about the answer depends on who supplied the bundle.',
    },
    {
      t: 'note',
      tone: 'default',
      title: 'The proof builder is not trusted',
      text: 'It is worth being precise about what the precompile removes. A proof builder still assembles the Merkle material, and that builder is an ordinary service that can be slow, wrong, or hostile. What it cannot be is believed. The precompile either accepts the bundle or reverts, so the worst a malicious builder achieves is denial of service. Six deliberate mutations of a valid proof were rejected on-chain to establish that this is behaviour rather than intention.',
    },

    { t: 'h', text: 'What runs where' },
    {
      t: 'table',
      head: ['On Creditcoin', 'On Ethereum'],
      rows: [
        ['`EvidenceVault`, `Clearbook`, `CovenantLib`', 'Nothing'],
        ['Fact storage and uniqueness', 'Nothing'],
        ['Covenant evaluation and enforcement', 'Nothing'],
        ['Bond, slash, bounty, burn', 'Nothing'],
      ],
    },
    {
      t: 'note',
      title: 'Clearbook deploys nothing on the source chain',
      text: 'The evidence is ordinary ERC-20 transfers on tokens we do not control. That is a deliberate constraint rather than an omission. The moment a system requires its own contract on the source chain, it can only ever see activity that agreed in advance to be seen, and activity that agrees to be seen is not the activity anyone needs checked. The registry can hold a transfer between two strangers who have never heard of Clearbook, and that is the whole point.',
    },

    { t: 'h', text: 'What this choice costs' },
    {
      t: 'p',
      text: 'Stated plainly, because a rationale page that only lists advantages is advocacy. The protocol is portable in principle: nothing in `Clearbook.sol` or `CovenantLib.sol` depends on Creditcoin beyond the verifier interface. In practice it is portable only to a chain offering equivalent native verification, and today that means Creditcoin. Liveness of the attestor set is also inherited rather than earned. If attestation of a source chain stops, no new evidence about that chain can enter the vault, though facts already stored are unaffected.',
    },
    {
      t: 'next',
      items: [
        { href: '/docs/why-attestcoin', label: 'Why Attestcoin', sub: 'What the precompile actually settles' },
        { href: '/docs/architecture', label: 'Architecture', sub: 'Components and boundaries' },
        { href: '/docs/source-chains', label: 'Source chains', sub: 'What is actually supported' },
      ],
    },
  ],
};

const whyNotDatabase: DocPage = {
  slug: 'why-not-a-database',
  title: 'Why not a database, or an indexer',
  summary: 'Both can do the mechanics. Neither can hold the state without someone controlling it.',
  audience: 'Developers',
  blocks: [
    {
      t: 'lead',
      text: 'A database can enforce uniqueness. An indexer can observe transfers. The question was never capability. It is who controls the state that money moves on.',
    },
    { t: 'h', text: 'The database question, stated fairly' },
    {
      t: 'p',
      text: 'A `UNIQUE` constraint enforces uniqueness perfectly well. Postgres would happily reject a second commitment of the same evidence. The mechanics are not in dispute.',
    },
    {
      t: 'p',
      text: 'What differs is **who can change the answer**. In a database, the operator can drop the constraint, edit the row, or restore a different backup, and no participant can detect any of it from the outside. Clearbook’s operator can do none of those things, for the simple reason that the operator does not hold the state.',
    },
    {
      t: 'note',
      title: 'The precise claim',
      text: 'The claim is not that databases cannot enforce uniqueness. It is that **the registry’s evidence-consumption and enforcement state is not controlled by any single Clearbook operator**, and that this matters specifically because bonds are slashed on the strength of it.',
    },
    { t: 'h', text: 'The indexer question' },
    {
      t: 'table',
      head: ['An indexer', 'Clearbook'],
      rows: [
        ['Observes and reports', 'Verifies, records, commits, enforces'],
        ['Its output is an assertion', 'Its output is a contract state transition'],
        ['Wrong output is a bug', 'Wrong output is impossible without breaking the precompile'],
        ['You must trust the operator', 'You must trust the attestor set and the chain'],
      ],
    },
    {
      t: 'p',
      text: 'Indexers are not useless. Clearbook’s own worker is essentially an indexer, and it is explicitly untrusted. The distinction being drawn here is about the trust boundary, not the technology.',
    },
    { t: 'h', text: 'Where Clearbook does use a database' },
    {
      t: 'p',
      text: 'The worker keeps a Postgres database for its scan cursor and fact state machine. It is **bookkeeping, never truth**. The frontend has no dependency on it, and nothing in it can make the vault accept anything. See [architecture](/docs/architecture).',
    },
    {
      t: 'next',
      items: [
        { href: '/docs/security', label: 'Trust boundaries', sub: 'Stated explicitly' },
        { href: '/docs/proves', label: 'What Clearbook proves', sub: 'The exact boundary' },
      ],
    },
  ],
};

export const rationalePages: DocPage[] = [whyAttestcoin, whyCreditcoin, whyNotDatabase];
