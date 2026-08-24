import type { DocPage } from '../types';

/** Architecture, boundaries, and reference. Facts here are read from the repo. */

const architecture: DocPage = {
  slug: 'architecture',
  title: 'Architecture',
  summary: 'Four layers, and the trust boundary between them.',
  audience: 'Developers',
  blocks: [
    { t: 'lead', text: 'Four layers. Only one of them is authoritative.' },
    {
      t: 'table',
      head: ['Layer', 'Component', 'Trusted?'],
      rows: [
        ['Source chain', 'Ethereum. Third-party ERC-20 transfers', 'Yes. It is the subject of every claim'],
        ['Verification', 'Attestor set, proof builder, Block Prover precompile', 'Precompile yes; proof builder **no**'],
        ['Protocol', '`EvidenceVault`, `Clearbook`, `CovenantLib` on Creditcoin', 'Yes. This is the authority'],
        ['Infrastructure', 'Worker, Postgres, frontend', '**No.** None of it can make the vault believe anything'],
      ],
    },
    { t: 'h', text: 'Contracts' },
    {
      t: 'table',
      head: ['Contract', 'Responsibility'],
      rows: [
        ['`EvidenceVault`', 'Verifies proofs, decodes receipts, stores `TransferFact`s. Permissionless'],
        ['`Clearbook`', 'Originators, bonds, treasury binding, claims, challenge, enforcement'],
        ['`CovenantLib`', 'Covenant conditions 3–9 as a pure predicate with named errors'],
      ],
    },
    {
      t: 'p',
      text: 'The vault’s step order is security-critical and deliberate: **dedupe, then verify, then decode**. Re-submitting a known fact returns the existing id without re-verifying and without emitting.',
    },
    { t: 'h', text: 'The worker' },
    {
      t: 'p',
      text: 'A daemon that watches the source chain, waits for attestation, fetches proofs, and submits them. It is **orchestration only**. If it submits a corrupted bundle the transaction reverts; if it disappears, anyone can submit the identical bundle.',
    },
    {
      t: 'flow',
      steps: [
        { label: 'DISCOVERED', sub: 'A watched transfer was seen on the source chain' },
        { label: 'WAITING_ATTESTATION', sub: 'The block is not yet attested' },
        { label: 'PROVED', sub: 'Proof retrieved; txIndex taken from the precompile' },
        { label: 'SUBMITTED', sub: 'Sent to the vault' },
        { label: 'CONFIRMED', sub: 'Stored on Creditcoin', tone: 'verified' },
      ],
    },
    {
      t: 'p',
      text: '`PRECHECK_FAILED` and `FAILED` are terminal side-exits. Every transition is persisted before the next begins, and stranded rows are re-queued at startup, so a crash at any point replays as a no-op.',
    },
    {
      t: 'note',
      title: 'The database is bookkeeping, never truth',
      text: 'Postgres holds the scan cursor and the fact state machine. Its `UNIQUE (chain_key, block_height, tx_index, log_index)` constraint mirrors the on-chain identity exactly, so the database and the chain cannot disagree about what has been ingested. The frontend reads the chain directly and has no dependency on it.',
    },
    {
      t: 'next',
      items: [
        { href: '/docs/security', label: 'Security', sub: 'Threats and assumptions' },
        { href: '/docs/reference', label: 'Reference', sub: 'Addresses, errors, events' },
      ],
    },
  ],
};

const proves: DocPage = {
  slug: 'proves',
  title: 'What Clearbook proves',
  summary: 'The exact boundary between what is established and what is not.',
  audience: 'Everyone',
  blocks: [
    {
      t: 'lead',
      text: 'A system that states its boundary precisely is worth more than one that implies it has none. This page is the boundary.',
    },
    {
      t: 'split',
      canTitle: 'Clearbook can establish',
      can: [
        'That a transaction was included in an attested source-chain block',
        'That its receipt reported success',
        'That one of its logs was an ERC-20 transfer of a given amount between two addresses',
        'That an address produced a valid EIP-712 signature binding it to an originator',
        'That a specific verified fact has, or has not, been committed to a claim',
        'That no second claim can commit an already-committed fact',
        'That a declared covenant predicate was or was not satisfied over cited evidence',
        'That a bond was slashed and a bounty paid, atomically',
      ],
      cannotTitle: 'Clearbook cannot establish',
      cannot: [
        'That any address belongs to a person, company or fund',
        'That an off-chain loan agreement exists',
        'That anyone intended anything',
        'That any law was broken',
        'That a transaction did **not** occur. Absence is unprovable',
        'That the same obligation is not represented by a different transaction',
        'Flows that pass through addresses the originator never bound',
        'Anything about a chain the attestor set does not attest',
      ],
    },
    { t: 'h', text: 'The boundary applied to a real breach' },
    {
      t: 'p',
      text: 'Claim L-002 on the deployed book was challenged and its bond slashed. It is worth walking exactly what that settled and what it did not, because the difference is the whole discipline of this product.',
    },
    {
      t: 'table',
      head: ['Established', 'Not established'],
      rows: [
        ['Two ERC-20 transfers were included in attested Sepolia blocks and both receipts succeeded', 'That either address belongs to a fund, a person, or anyone at all'],
        ['The treasury address had proven control of its key by EIP-712 signature', 'That the signer is the institution named on the page'],
        ['The funded address is the address that repaid, in the same token, inside the published window', 'That the money repaid was the same money the treasury sent'],
        ['Eleven published conditions were evaluated and all held', 'That the originator intended anything, or that any law was broken'],
        ['A bond was slashed and a bounty paid in one transaction', 'That the book is complete, or that no other breach exists'],
      ],
    },
    {
      t: 'p',
      text: 'A breach of `CIRCULAR_REPAYMENT` establishes that **an originator\u2019s own published rule was not met** over evidence a precompile verified. It is a broken commitment, not a finding of fraud, and the documentation says so in every place the word breach appears.',
    },
    {
      t: 'note',
      title: 'The three registers, never blurred',
      text: 'A **source-chain fact** is what the cryptography establishes. A **Clearbook interpretation** is what this application decides on top of it. **Not claimed** is what is never asserted. The interface keeps them visually distinct for the same reason this page exists.',
    },
    {
      t: 'next',
      items: [
        { href: '/docs/limitations', label: 'Limitations', sub: 'Why each boundary is where it is' },
        { href: '/docs/security', label: 'Security', sub: 'Threats and mitigations' },
      ],
    },
  ],
};

const security: DocPage = {
  slug: 'security',
  title: 'Security',
  summary: 'Trust boundaries, threats, and what is done about each.',
  audience: 'Developers',
  blocks: [
    {
      t: 'lead',
      text: 'For every threat: what Clearbook does, and what it does not do.',
    },
    { t: 'h', text: 'Trust boundaries' },
    {
      t: 'table',
      head: ['Party', 'Trusted with'],
      rows: [
        ['Block Prover precompile', 'Deciding whether a proof is valid. **Fully trusted**'],
        ['Attestor set', 'Attesting finalized source blocks. Trusted for liveness and honesty'],
        ['Proof builder', '**Nothing.** It supplies material the precompile then rules on'],
        ['Worker', '**Nothing.** It pays gas and submits bundles'],
        ['Frontend', '**Nothing.** It renders chain reads'],
        ['Originator', 'Nothing beyond keys it proved control of'],
      ],
    },
    { t: 'h', text: 'Threats' },
    {
      t: 'table',
      head: ['Threat', 'What Clearbook does', 'What it does not do'],
      rows: [
        ['Forged proof', 'The precompile rejects it. Six mutations of a valid proof were tested and all six reverted on-chain', 'Cannot detect a compromised attestor quorum'],
        ['Replay of evidence', 'Log-level identity makes each transfer distinct; the vault is idempotent', 'No known gap'],
        ['Duplicate commitment', '`factConsumedBy` refuses a second claim, across all originators', 'Does not detect the same obligation via a different transaction'],
        ['Reverted source transaction', '`receiptStatus == 1` is asserted; `SourceTxReverted` otherwise', 'No known gap'],
        ['Treasury impersonation', 'EIP-712 binding; one address binds to at most one originator, ever', 'Does not establish who controls the key'],
        ['Challenge griefing', 'Invalid challenges revert and change no state', 'Does not stop a challenger wasting their own gas'],
        ['Worker failure', 'State persisted before each transition; stranded rows re-queued at startup', 'Assumes a single worker instance'],
        ['Proof builder outage', 'Denial of service only', 'Cannot proceed without proof material'],
        ['Source-chain delay', 'Evidence simply is not usable yet', 'Cannot shorten attestation'],
      ],
    },
    {
      t: 'note',
      tone: 'pending',
      title: 'Dedupe before verify has a testing consequence',
      text: 'The vault checks whether a fact exists **before** calling the precompile. That is correct and makes replay nearly free, but it means a forged bundle whose identity happens to already be stored returns early without testing anything. Forgery tests must submit at an unstored identity.',
    },
    {
      t: 'next',
      items: [
        { href: '/docs/limitations', label: 'Limitations', sub: 'The assumptions behind all of this' },
        { href: '/docs/proves', label: 'What Clearbook proves', sub: 'The boundary' },
      ],
    },
  ],
};

const limitations: DocPage = {
  slug: 'limitations',
  title: 'Limitations and assumptions',
  summary: 'Exactly what this system guarantees, and where it stops.',
  audience: 'Everyone',
  blocks: [
    {
      t: 'lead',
      text: 'Stated here rather than buried, because a system that claims less and proves it is worth more than one that claims everything.',
    },
    {
      t: 'defs',
      items: [
        {
          term: 'The covenant is bounded, not universal',
          simple: 'An originator that funds a payer from an address it never binds does not breach it.',
          technical: 'Detection is depth-1 by construction. This is why the rule is framed as a covenant the originator chose and bonded against, not as fraud detection.',
        },
        {
          term: 'The window catches honest re-lending too',
          simple:
            'If your treasury sends money to a counterparty and that same counterparty repays you shortly after, the covenant fires, even when the two payments have nothing to do with each other.',
          technical:
            'Transfer facts cannot distinguish money that funded a repayment from money that merely preceded it. A second tranche, a revolving draw, or any same-day disbursement to the address that repays you satisfies the funding leg. This is the covenant behaving as published rather than a defect, and it is why `circularWindow` is the originator’s dial. A window of 5,000 blocks, roughly seventeen hours, is a strong claim that carries real exposure. A tight window is operationally comfortable and claims correspondingly less. An originator running an active revolver cannot use a wide window.',
        },
        {
          term: 'Absence is unprovable',
          simple: 'Clearbook can never certify a book as clean.',
          technical: 'Merkle inclusion proofs establish that something happened. There is no corresponding proof that something did not. Clearbook makes specific claims refutable; it does not attest completeness.',
        },
        {
          term: 'An address is not an entity',
          simple: 'A bound treasury is an address that produced a signature. Nothing more.',
          technical: 'EIP-712 binding proves control of a key at signing time. It establishes no relationship to any legal person.',
        },
        {
          term: 'Ethereum only',
          simple: 'Evidence can come from the chains the attestor set attests, and no others.',
          technical: 'Ethereum Mainnet and Sepolia today. See [source chains](/docs/source-chains).',
        },
        {
          term: 'Attestation latency',
          simple: 'Fresh activity is not usable as evidence for roughly eight to ten minutes.',
          technical: 'Attestors attest finalized blocks. The wait is the security property, not overhead.',
        },
        {
          term: 'Testnet deployment',
          simple: 'The contracts are deployed to Creditcoin CC3 testnet.',
          technical: 'Evidence may originate from Ethereum Mainnet, but the protocol state itself is testnet. Nothing here custodies real value.',
        },
        {
          term: 'Single worker instance',
          simple: 'Running two workers at once could duplicate work.',
          technical: 'The startup requeue cannot distinguish a crashed row from one in flight elsewhere. It would duplicate *work*, never *evidence*, because the vault stores a fact once regardless.',
        },
        {
          term: 'Bounded evidence discovery',
          simple: 'The challenge console lists recent facts, not all of history.',
          technical: 'Discovery reads a bounded window of vault logs. Older facts remain fully citable by identifier; the bound limits convenience, never what the contract accepts.',
        },
      ],
    },
    {
      t: 'next',
      items: [
        { href: '/docs/proves', label: 'What Clearbook proves', sub: 'The positive side' },
        { href: '/docs/security', label: 'Security', sub: 'Threats and mitigations' },
      ],
    },
  ],
};

const sourceChains: DocPage = {
  slug: 'source-chains',
  title: 'Source chains',
  summary: 'What is supported, what supported means, and who decides it.',
  audience: 'Developers',
  blocks: [
    {
      t: 'lead',
      text: 'A chain is supported when the attestor set attests it. Not when we list it, and not when we hold an endpoint for it. This page names what that distinction currently returns.',
    },
    {
      t: 'table',
      head: ['Chain', 'Chain ID', 'Chain key', 'Status'],
      rows: [
        ['Ethereum Mainnet', '1', '3', '**Supported.** Carries real value'],
        ['Ethereum Sepolia', '11155111', '1', '**Supported.** Testnet'],
      ],
    },

    { t: 'h', text: 'What a chain key is' },
    {
      t: 'p',
      text: 'A chain key is the attestor set\u2019s own identifier for a chain, and it is **not** the EVM chain ID. Ethereum Mainnet is chain ID 1 but chain key 3; Sepolia is chain ID 11155111 but chain key 1. The two numbering schemes overlap at 1 while meaning entirely different chains, which is precisely the kind of coincidence that produces a confident, wrong answer.',
    },
    {
      t: 'note',
      tone: 'breach',
      title: 'Why the key is resolved at runtime and never hardcoded',
      text: 'A hardcoded chain key is how a Sepolia transfer ends up presented as mainnet evidence. Every path that needs a key asks the ChainInfo precompile for it, and a chain the precompile does not return is an error rather than a fallback. The code refuses instead of guessing, because a guess here is indistinguishable from a lie.',
    },

    { t: 'h', text: 'Support is decided by the precompile' },
    {
      t: 'p',
      text: 'Listing a chain in this interface names an endpoint. It does not add support, and nothing we deploy could. Adding a chain is a matter for the attestor set: until quorum is being reached on that chain\u2019s finalized blocks, no proof can be built against it and the evidence does not exist as far as Creditcoin is concerned. There is no configuration flag on our side that changes this, which is the correct arrangement.',
    },

    { t: 'h', text: 'Latency is the security property' },
    {
      t: 'p',
      text: 'Attestors reach quorum on **finalized** source blocks, so fresh activity is not usable as evidence for roughly eight to ten minutes. That wait is not overhead to be optimised away. It is the interval during which the source chain settles, and shortening it would mean attesting blocks that could still be reorganised.',
    },

    { t: 'h', text: 'A worked example: real mainnet evidence' },
    {
      t: 'p',
      text: 'The registry holds a genuine Ethereum Mainnet USDC transfer of 10,506.417092 USDC from block 25,811,720, between two addresses we do not control and that have never heard of Clearbook. It was proven by the Block Prover precompile and stored like any other fact.',
    },
    {
      t: 'flow',
      steps: [
        { label: 'A stranger sends USDC on Ethereum Mainnet', sub: 'chain key 3, block 25,811,720' },
        { label: 'Attestors reach quorum on the finalized block', sub: 'nobody asked our permission' },
        { label: 'Anyone builds a proof and submits it', sub: 'the vault is permissionless', tone: 'verified' },
        { label: 'The fact is verified and stored', sub: 'and is now citable by anyone', tone: 'verified' },
        { label: 'It can never be committed to a claim', sub: 'we hold no key for either address', tone: 'pending' },
      ],
    },
    {
      t: 'p',
      text: 'That last step is the asymmetry the whole product rests on, made concrete. **Verification requires no permission; commitment does.** A fact can be proven by anyone about anyone, but binding it to a credit claim requires a treasury proven by EIP-712 signature, and no amount of verification supplies a key you do not have. See [the evidence registry](/docs/evidence-registry).',
    },

    { t: 'h', text: 'Both chains, one namespace' },
    {
      t: 'p',
      text: 'Facts from mainnet and Sepolia share a single registry and a single uniqueness rule. The chain key is part of the fact identity, so a transfer at the same height and index on two different chains produces two different facts and can never be confused. The covenant then refuses to compare across chains at all: condition 3 requires both legs of an alleged breach to come from the same source chain, because a Sepolia transfer presented against a mainnet one would be a meaningless comparison dressed as evidence.',
    },
    {
      t: 'next',
      items: [
        { href: '/docs/verification', label: 'Verification pipeline', sub: 'How a transfer becomes a fact' },
        { href: '/docs/reference', label: 'Reference', sub: 'Addresses and networks' },
      ],
    },
  ],
};

export const technicalPages: DocPage[] = [
  architecture,
  proves,
  security,
  limitations,
  sourceChains,
];
