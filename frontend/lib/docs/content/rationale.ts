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
        '**Log-level identity** — `keccak256(chainKey, blockHeight, txIndex, logIndex)`, so many transfers in one transaction stay distinct',
        '**Transaction-local `logIndex`** — an index into the receipt’s own log array, not the block-global index',
        '**Independent receipt check** — the precompile proves inclusion, not success, so `receiptStatus == 1` is asserted here',
        '**EIP-712 treasury binding** — an address only counts as an originator’s if that originator proved control of the key',
      ],
    },
    {
      t: 'note',
      tone: 'verified',
      title: 'The test that matters',
      text: 'Replace the precompile with anything that merely reports, and the challenge becomes "trust our backend" — which is the thing being eliminated. That is the sense in which Attestcoin is load-bearing rather than decorative.',
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
      text: 'Verified evidence is only half of it. The consumption and enforcement state has to live somewhere no single participant controls.',
    },
    { t: 'h', text: 'What the state has to be' },
    {
      t: 'table',
      head: ['Requirement', 'Why Clearbook needs it'],
      rows: [
        ['Shared', 'Fact uniqueness only means something across a common namespace. Per-fund records give nothing'],
        ['Deterministic', 'Eleven conditions must produce the same verdict for everyone who evaluates them'],
        ['Permissionless', 'A challenge that needs approval is not a check on the party granting approval'],
        ['Economically final', 'A verdict that does not move money is an opinion'],
        ['Able to verify source chains', 'Via the precompiles — the reason this is Creditcoin and not a generic L1'],
      ],
    },
    {
      t: 'p',
      text: 'The last row is the one that is not substitutable. Clearbook needs a chain where a contract can verify another chain’s history natively. That is what Creditcoin provides through the Block Prover and ChainInfo precompiles.',
    },
    { t: 'h', text: 'What runs where' },
    {
      t: 'table',
      head: ['On Creditcoin', 'On Ethereum'],
      rows: [
        ['`EvidenceVault`, `Clearbook`, `CovenantLib`', 'Nothing'],
        ['Fact storage and uniqueness', '—'],
        ['Covenant evaluation and enforcement', '—'],
        ['Bond, slash, bounty, burn', '—'],
      ],
    },
    {
      t: 'note',
      title: 'Clearbook deploys nothing on the source chain',
      text: 'The evidence is ordinary ERC-20 transfers on tokens we do not control. That is a deliberate constraint, not an omission — the moment we require a source-chain deployment, we can only see activity that agreed to be seen.',
    },
    {
      t: 'next',
      items: [
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
      text: 'A database can enforce uniqueness. An indexer can observe transfers. The question is not capability — it is who controls the state that money moves on.',
    },
    { t: 'h', text: 'The database question, stated fairly' },
    {
      t: 'p',
      text: 'A `UNIQUE` constraint enforces uniqueness perfectly well. Postgres would happily reject a second commitment of the same evidence. The mechanics are not in dispute.',
    },
    {
      t: 'p',
      text: 'What differs is **who can change the answer**. In a database, the operator can drop the constraint, edit the row, or restore a different backup — and no participant can detect it from the outside. Clearbook’s operator can do none of those things, because the operator does not hold the state.',
    },
    {
      t: 'note',
      title: 'The precise claim',
      text: 'Not "databases cannot do uniqueness". The claim is that **the registry’s evidence-consumption and enforcement state is not controlled by a single Clearbook operator** — and that this matters specifically because bonds are slashed on it.',
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
      text: 'Indexers are not useless — Clearbook’s own worker is essentially one, and it is explicitly untrusted. The distinction is the trust boundary, not the technology.',
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
