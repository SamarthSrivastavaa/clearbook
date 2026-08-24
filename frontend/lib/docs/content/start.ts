import type { DocPage } from '../types';

/** Entry paths: the docs homepage, the judge accelerator, and the two overviews. */

const home: DocPage = {
  slug: '',
  title: 'Shared evidence for credit claims.',
  summary:
    'Clearbook turns independently verified source-chain activity into shared evidence for credit claims, with immutable covenant enforcement on Creditcoin.',
  audience: 'Everyone',
  blocks: [
    {
      t: 'lead',
      text: 'Clearbook turns independently verified source-chain activity into shared evidence for credit claims, with immutable covenant enforcement on Creditcoin.',
    },
    {
      t: 'next',
      items: [
        { href: '/docs/overview', label: 'What Clearbook is', sub: 'The system in one page' },
        { href: '/docs/how-it-works', label: 'How it works', sub: 'Evidence to enforcement' },
        { href: '/docs/protocol', label: 'Contracts', sub: 'Interfaces and guard order' },
      ],
    },
    { t: 'h', text: 'The shape of the system' },
    {
      t: 'flow',
      steps: [
        { label: 'Source-chain activity', sub: 'An ERC-20 transfer on a chain we do not control' },
        { label: 'Cryptographic verification', sub: 'Attestcoin proves inclusion; the precompile checks it' },
        { label: 'Shared evidence', sub: 'A TransferFact, readable by anyone', tone: 'verified' },
        { label: 'Credit claim', sub: 'One fact, one claim. Never two' },
        { label: 'Covenant', sub: 'A rule the originator published and bonded against' },
        { label: 'Challenge', sub: 'Anyone may try to prove a breach' },
        { label: 'Enforcement', sub: 'Bond slashed, challenger paid, in one transaction', tone: 'breach' },
      ],
    },
    { t: 'h', text: 'The distinction that explains everything else' },
    {
      t: 'note',
      title: 'Verification does not require permission. Commitment does.',
      text: 'Anyone can prove that a transfer happened, including a transfer between parties who have never heard of Clearbook. Committing that fact to a credit claim is different: it requires a treasury the originator proved control of by signature, and it can happen only once. Read [why that asymmetry is the architecture](/docs/evidence-registry).',
    },
    { t: 'h', text: 'Three ways in' },
    {
      t: 'next',
      items: [
        { href: '/docs/evidence-registry', label: 'The evidence registry', sub: 'Where facts live' },
        { href: '/docs/covenant-predicate', label: 'The covenant predicate', sub: 'Stated formally' },
        { href: '/docs/proves', label: 'What Clearbook proves', sub: 'And what it does not' },
      ],
    },
  ],
};

const overview: DocPage = {
  slug: 'overview',
  title: 'What is Clearbook?',
  summary: 'A shared, cryptographically verified evidence registry for private-credit claims.',
  audience: 'Everyone',
  blocks: [
    {
      t: 'lead',
      text: 'Clearbook is a shared, cryptographically verified evidence registry for private-credit claims.',
    },
    {
      t: 'p',
      text: 'Three things happen in order. Evidence is **verified**: a transfer on another chain is proven to have occurred. Evidence is **committed**: bound to one specific credit claim, and never to a second. Claims are **governed**: held to a covenant the originator published in advance, which anyone may test.',
    },
    { t: 'h', text: 'Four parts, kept separate' },
    {
      t: 'table',
      head: ['Layer', 'What it is', 'Where it runs'],
      rows: [
        ['Source chain', 'Where the money actually moved', 'Ethereum'],
        ['Protocol', 'What the contracts enforce', 'Creditcoin'],
        ['Product', 'What people interact with', 'This application'],
        ['Infrastructure', 'Proof fetching and submission', 'An off-chain worker'],
      ],
    },
    {
      t: 'p',
      text: 'The documentation keeps these apart deliberately. Collapsing all three into the single word "Clearbook" is how a system ends up claiming its infrastructure is trustworthy because its contracts are. The contracts and the infrastructure carry very different guarantees, and a reader deserves to know which one is being invoked.',
    },
    { t: 'h', text: 'What a claim must carry' },
    {
      t: 'p',
      text: 'A claim is not an assertion. To register one, an originator must cite a [TransferFact](/docs/concepts#transferfact) whose sender is a treasury it proved control of by EIP-712 signature, whose recipient equals the declared borrower, whose token equals the declared token, and whose amount equals the principal exactly. Any mismatch is refused.',
    },
    {
      t: 'note',
      title: 'Nothing here is self-reported',
      text: 'Every figure on the [credit book](/docs/claims) traces to a transfer that a precompile verified. The application renders chain reads; it does not hold a view of the world of its own.',
    },
    {
      t: 'next',
      items: [
        { href: '/docs/how-it-works', label: 'How it works', sub: 'Evidence through enforcement' },
        { href: '/docs/evidence-registry', label: 'The evidence registry', sub: 'Verified, and who consumed it' },
        { href: '/docs/proves', label: 'What Clearbook proves', sub: 'The exact boundary' },
      ],
    },
  ],
};

const howItWorks: DocPage = {
  slug: 'how-it-works',
  title: 'How it works',
  summary: 'From a transfer on Ethereum to a slashed bond on Creditcoin.',
  audience: 'Everyone',
  blocks: [
    {
      t: 'lead',
      text: 'One path, seven steps, each one refusing to proceed if the previous cannot be established.',
    },
    {
      t: 'flow',
      steps: [
        { label: '1 · A transfer happens', sub: 'Ethereum. Ordinary ERC-20, not instrumented for us' },
        { label: '2 · The block is attested', sub: 'Attestors reach quorum on the finalized block' },
        { label: '3 · A proof is built', sub: 'Merkle inclusion plus continuity, from the proof builder' },
        { label: '4 · The precompile verifies it', sub: 'On Creditcoin, at 0x…0FD2', tone: 'verified' },
        { label: '5 · A TransferFact is stored', sub: 'Receipt decoded on-chain; status asserted to be success', tone: 'verified' },
        { label: '6 · A claim commits it', sub: 'Once. factConsumedBy refuses a second' },
        { label: '7 · A challenge may settle it', sub: 'Eleven conditions, then slash and bounty', tone: 'breach' },
      ],
    },
    { t: 'h', text: 'Where the trust actually sits' },
    {
      t: 'p',
      text: 'Steps 2 and 3 involve parties we do not control: the attestor set, and the proof builder. Neither is trusted. The proof builder supplies material, and **step 4 is what makes that material mean anything**. A malicious proof builder can refuse to answer, and so deny service. It cannot forge a fact, because the precompile would reject the bundle.',
    },
    {
      t: 'note',
      tone: 'pending',
      title: 'The precompile proves inclusion, not success',
      text: 'A reverted ERC-20 transfer is included in a block exactly like a successful one, and it moved no value. Clearbook decodes the receipt and requires `receiptStatus == 1` itself, rejecting anything else with `SourceTxReverted`. This check is ours, not the precompile’s.',
    },
    { t: 'h', text: 'How long it takes' },
    {
      t: 'table',
      head: ['Stage', 'Measured'],
      rows: [
        ['Broadcast to usable evidence', '~8–10 minutes'],
        ['Of which, waiting for attestation', '97–99%'],
        ['`verify()` at the precompile', '0.8 s'],
      ],
    },
    {
      t: 'p',
      text: 'The wait is not overhead to be optimised away. Attestors attest **finalized** blocks; that delay is the security property. See [limitations](/docs/limitations).',
    },
    {
      t: 'next',
      items: [
        { href: '/docs/evidence-registry', label: 'The evidence registry', sub: 'Step 5 and 6 in detail' },
        { href: '/docs/covenants', label: 'Covenants', sub: 'What step 7 evaluates' },
        { href: '/docs/architecture', label: 'Architecture', sub: 'Components and boundaries' },
      ],
    },
  ],
};

export const startPages: DocPage[] = [home, overview, howItWorks];
