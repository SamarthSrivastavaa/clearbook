import type { DocPage } from '../types';

/** What the system does, told at product level before protocol level. */

const registry: DocPage = {
  slug: 'evidence-registry',
  title: 'The evidence registry',
  summary: 'Which verified facts exist, and which claim, if any, has consumed each one.',
  audience: 'Everyone',
  blocks: [
    {
      t: 'lead',
      text: 'The registry is the state the whole system rests on: which facts have been verified, and which claim has committed each one.',
    },
    {
      t: 'p',
      text: 'It is deliberately not an explorer. An explorer answers "what happened on a chain". The registry answers **"what can still be committed to a credit claim, and what cannot"**.',
    },
    { t: 'h', text: 'Verification is open. Commitment is not.' },
    {
      t: 'split',
      canTitle: 'Verification needs no permission',
      can: [
        'Anyone may submit a proof to the vault',
        'The transfer may be between parties with no relationship to Clearbook',
        'It may be on a token nobody here controls',
        'It may be on Ethereum mainnet, between strangers',
      ],
      cannotTitle: 'Commitment needs a bound treasury',
      cannot: [
        'The sender must be a treasury proved by EIP-712 signature',
        'The recipient must equal the declared borrower',
        'The token and amount must match the claim exactly',
        'The fact must not already be committed elsewhere',
      ],
    },
    {
      t: 'note',
      tone: 'verified',
      title: 'This asymmetry is the architecture, not a gap in it',
      text: 'It is why a real Ethereum mainnet transfer can be proven in the registry and yet never claimed there. We hold no key for either address, and no amount of verification supplies one. Registry evidence and claim evidence are different things, and the interface says so on every fact.',
    },
    { t: 'h', text: 'What a fact records' },
    {
      t: 'table',
      head: ['Field', 'Meaning'],
      rows: [
        ['`chainKey`', 'Which source chain, as the ChainInfo precompile keys it'],
        ['`blockHeight`', 'The source block the transfer was included in'],
        ['`txIndex`', 'Position of the transaction within that block'],
        ['`logIndex`', 'Transaction-local. An index into this receipt’s own log array'],
        ['`token` / `from` / `to` / `amount`', 'Decoded from the ERC-20 `Transfer` log, on-chain'],
        ['`submitter`', 'Whoever paid to submit it. Carries no privilege'],
      ],
    },
    {
      t: 'note',
      tone: 'pending',
      title: 'logIndex is transaction-local, not block-global',
      text: '`eth_getLogs` returns a block-global index. The identity used here is an index into the receipt’s own log array. Conflating the two computes the identity over the wrong value. See [security](/docs/security).',
    },
    { t: 'h', text: 'Identity, and why it is log-level' },
    {
      t: 'code',
      lang: 'solidity',
      caption: 'contracts/src/EvidenceVault.sol',
      code: 'factId = keccak256(abi.encode(chainKey, blockHeight, txIndex, logIndex));',
    },
    {
      t: 'p',
      text: 'This is deliberately stricter than a transaction-level key. One transaction routinely carries many relevant `Transfer` logs, and we measured 17 and 30 of them in real Sepolia transactions. A transaction-level key would collapse every one of those into a single identity, which would let one transfer stand in for another.',
    },
    {
      t: 'next',
      items: [
        { href: '/docs/duplicate-commitment', label: 'One fact, one claim', sub: 'The uniqueness guarantee' },
        { href: '/docs/claims', label: 'Claims', sub: 'What committing means' },
        { href: '/docs/reference', label: 'Reference', sub: 'Addresses, errors, events' },
      ],
    },
  ],
};

const duplicate: DocPage = {
  slug: 'duplicate-commitment',
  title: 'One fact, one claim',
  summary: 'A verified fact can back at most one credit claim, across every originator.',
  audience: 'Everyone',
  blocks: [
    {
      t: 'lead',
      text: 'A verified TransferFact can back at most one credit claim, and that limit holds across every originator in the registry rather than merely within one.',
    },
    {
      t: 'flow',
      steps: [
        { label: 'A fact is verified', sub: 'Available to commit', tone: 'verified' },
        { label: 'Originator A commits it', sub: 'factConsumedBy[factId] = loanId' },
        { label: 'Originator B attempts the same fact', sub: 'Separately owned, separately bonded' },
        { label: 'FactAlreadyUsed', sub: 'The transaction reverts', tone: 'breach' },
        { label: 'Nothing changed', sub: 'A keeps the fact. B gains no exposure' },
      ],
    },
    { t: 'h', text: 'Why it holds across originators' },
    {
      t: 'p',
      text: '`factConsumedBy` is a **single global mapping**, not one scoped per originator. That is what makes a shared namespace worth more than each fund keeping its own records: a fact spent by one institution is visibly unavailable to every other.',
    },
    {
      t: 'code',
      lang: 'solidity',
      caption: 'contracts/src/Clearbook.sol, registerLoan',
      code: `mapping(bytes32 => uint256) public factConsumedBy;

if (factConsumedBy[disbursementFactId] != 0) revert FactAlreadyUsed();`,
    },
    { t: 'h', text: 'The guard order matters' },
    {
      t: 'p',
      text: '`FactAlreadyUsed` is checked **before** the treasury binding. If the order were reversed, a second originator would be refused with `TreasuryNotBound`. That is a true statement, but it reports the wrong reason and hides the property being relied on. A regression test pins the ordering.',
    },
    {
      t: 'note',
      title: 'What this establishes, precisely',
      text: 'That the same **evidence** cannot be committed twice. It does **not** establish collateral identity: the same underlying obligation represented by a *different* transaction is not detected. See [what Clearbook proves](/docs/proves).',
    },
    { t: 'h', text: 'The same guard protects repayment' },
    {
      t: 'p',
      text: 'A repayment already credited to one claim cannot be credited to another, which is what stops one inbound payment settling two loans. Same mapping, same error.',
    },
    {
      t: 'next',
      items: [
        { href: '/docs/proves', label: 'What Clearbook proves', sub: 'The exact boundary' },
        { href: '/docs/protocol', label: 'Guard order', sub: 'Why the error is this one' },
      ],
    },
  ],
};

const claims: DocPage = {
  slug: 'claims',
  title: 'Claims and the credit book',
  summary: 'What a claim is, what it must cite, and the states it moves through.',
  audience: 'Users',
  blocks: [
    {
      t: 'lead',
      text: 'A claim is an originator’s statement about a loan, and every part of it that can be evidenced must be.',
    },
    { t: 'h', text: 'Registering a claim' },
    {
      t: 'p',
      text: 'To register a loan, an originator cites a disbursement fact. The contract checks that the money left a treasury **this originator bound by signature**, that the recipient equals the declared borrower, that the token matches, and that the amount equals the principal exactly. It also reserves bond against the claim.',
    },
    { t: 'h', text: 'Claim states' },
    {
      t: 'table',
      head: ['State', 'Meaning'],
      rows: [
        ['`REGISTERED`', 'Disbursement evidenced. No repayment claimed yet'],
        ['`REPAYMENT_CLAIMED`', 'A repayment fact is cited. The challenge window is open'],
        ['`DELINQUENT`', 'Past maturity with no repayment claimed'],
        ['`SETTLED`', 'The challenge window closed without a successful challenge'],
        ['`BREACHED`', 'A covenant breach was proven. Terminal'],
      ],
    },
    { t: 'h', text: 'Bond and exposure' },
    {
      t: 'table',
      head: ['Parameter', 'Value'],
      rows: [
        ['Minimum bond to register as an originator', '1 tCTC'],
        ['Bond reserved per open claim', '1 tCTC'],
        ['Slashed on a proven breach', '100% of the claim’s bond'],
        ['Paid to the challenger', '50% of the slashed amount'],
        ['Sent to the burn sink', 'The remainder'],
        ['Withdrawal cooldown', '1,200 blocks'],
      ],
    },
    {
      t: 'note',
      title: 'A claim is not a loan',
      text: 'Clearbook establishes that a transfer occurred between two addresses under conditions the originator declared. It does not establish that an off-chain loan agreement exists, or that either address belongs to any person or company.',
    },
    {
      t: 'next',
      items: [
        { href: '/docs/covenants', label: 'Covenants', sub: 'The rule a claim is measured against' },
        { href: '/docs/challenges', label: 'Challenges', sub: 'How a claim is tested' },
      ],
    },
  ],
};

const covenants: DocPage = {
  slug: 'covenants',
  title: 'Covenants',
  summary: 'A rule the originator publishes in advance, bonds against, and cannot change.',
  audience: 'Users',
  blocks: [
    {
      t: 'lead',
      text: 'A covenant is a rule the originator publishes at registration and posts a bond against. A rule you can change after publishing is not a covenant, so it is immutable thereafter.',
    },
    { t: 'h', text: 'CIRCULAR_REPAYMENT' },
    {
      t: 'p',
      text: 'The one covenant implemented today. In plain terms: **the money coming back should not be the fund’s own money going out and returning.**',
    },
    {
      t: 'note',
      title: 'The declared rule',
      text: 'No repayment may come from an address the originator’s own treasury funded for at least the repayment amount, in the same token, within N source-chain blocks, where N is published on-chain at registration.',
    },
    { t: 'h', text: 'How it is evaluated' },
    {
      t: 'p',
      text: 'A challenger cites a funding fact. The contract then evaluates eleven conditions over the two verified transfers. Each has its own named error, so a failed challenge says precisely which condition refused it, rather than merely that something did.',
    },
    {
      t: 'table',
      head: ['Group', 'Conditions', 'Tests'],
      rows: [
        ['Eligibility', '1–2', 'Is this claim open to challenge at all'],
        ['Identity', '3, 5, 6', 'Same chain; funded address is the payer; treasury is bound'],
        ['Value', '4, 7', 'Same token; funding at least covers the repayment'],
        ['Timing', '8–9', 'Funding precedes repayment, inside the published window'],
        ['Distinct evidence', '10–11', 'The cited fact is a genuinely separate leg'],
      ],
    },
    {
      t: 'p',
      text: 'Conditions 3–9 live in `CovenantLib` as a pure predicate. Conditions 1, 2, 10 and 11 are enforced in `Clearbook.challenge()`. Full error names are in the [reference](/docs/reference).',
    },
    {
      t: 'note',
      tone: 'pending',
      title: 'Bounded by construction',
      text: 'An originator that funds a payer from an address it never binds does not breach this covenant. Detection is depth-1, which is exactly why this is framed as a covenant the originator chose rather than as fraud detection. See [limitations](/docs/limitations).',
    },
    {
      t: 'next',
      items: [
        { href: '/docs/challenges', label: 'Challenges', sub: 'Submitting and settling' },
        { href: '/docs/reference', label: 'Condition errors', sub: 'All eleven, named' },
      ],
    },
  ],
};

const challenges: DocPage = {
  slug: 'challenges',
  title: 'Challenges and enforcement',
  summary: 'Anyone may prove a breach. The contract settles it in one transaction.',
  audience: 'Users',
  blocks: [
    {
      t: 'lead',
      text: 'There is no allowlist, no challenger bond, no dispute period, and no appeal, because there is nothing to deliberate.',
    },
    {
      t: 'p',
      text: 'The eleven conditions are arithmetic over evidence the chain has already verified, so the contract can settle them itself. A valid challenge slashes and pays in the same transaction that proves it. An invalid one costs the challenger gas and nothing else. No human reviews it, no committee votes on it, and the originator is not asked.',
    },

    { t: 'h', text: 'Who can challenge' },
    {
      t: 'p',
      text: 'Any address with gas. There is no registration, no stake, and no relationship to the originator required. This is not a permissive design choice made for convenience: **a challenge that needs approval is not a check on whoever grants the approval.** The moment enforcement requires standing, the party with the most to lose from enforcement acquires an interest in who has standing.',
    },
    {
      t: 'split',
      canTitle: 'A challenger needs',
      can: [
        'An address with enough gas for one transaction',
        'A claim whose challenge window is still open',
        'A verified fact already in the vault to cite as the funding leg',
      ],
      cannotTitle: 'A challenger does not need',
      cannot: [
        'Permission, registration, or an allowlist entry',
        'A bond, stake, or deposit of any kind',
        'Any relationship to the originator or the borrower',
        'To have submitted the evidence themselves',
      ],
    },

    { t: 'h', text: 'What a successful challenge does' },
    {
      t: 'flow',
      steps: [
        { label: 'Challenge submitted', sub: 'Citing a funding fact' },
        { label: 'Eleven conditions re-evaluated on-chain', sub: 'The contract does not trust the interface' },
        { label: 'Bond slashed', sub: '100% of the claim’s bond', tone: 'breach' },
        { label: 'Challenger paid', sub: '50% of the slashed amount' },
        { label: 'Remainder burned', sub: 'Sent to the protocol sink' },
        { label: 'Claim marked BREACHED', sub: 'Terminal. Exposure released', tone: 'breach' },
      ],
    },
    {
      t: 'p',
      text: 'Every step above happens inside one transaction. There is no window in which the claim is "under review", no state in which a breach has been alleged but not settled, and no point at which anyone could intervene. The proof and the consequence are the same event.',
    },

    { t: 'h', text: 'Why the console simulates first' },
    {
      t: 'p',
      text: 'The challenge console evaluates all eleven conditions from the same chain state before enabling its button, and then runs an `eth_call` against the deployed contract with the exact arguments it intends to broadcast. Nobody should open a wallet not knowing what will happen. If the simulation reverts, the interface says which named condition refused it and no transaction is sent.',
    },
    {
      t: 'note',
      tone: 'default',
      title: 'The interface is a convenience, never an authority',
      text: 'The contract re-evaluates every condition itself. A challenge submitted directly with `cast send`, bypassing this application entirely, is treated identically. If the interface and the contract ever disagreed, the contract would be right and the interface would be a bug.',
    },

    { t: 'h', text: 'Losing a race is normal' },
    {
      t: 'p',
      text: 'Bounties are competitive by construction. Another challenger may cite the same evidence first, and the reference challenger competes on exactly the same terms as a human. When that happens the losing transaction reverts `WrongStatus` and changes nothing. Front-running a challenge is possible and is documented as accepted for this version: commit and reveal is the production fix, and it costs a block of latency on the most important moment the product has.',
    },

    { t: 'h', text: 'Griefing' },
    {
      t: 'p',
      text: 'Because the challenger posts no bond, spamming invalid challenges is possible. It is also pointless. Every invalid challenge reverts, changes no state, and costs the sender gas. There is no griefing vector against the originator here, only a challenger wasting their own money.',
    },

    {
      t: 'note',
      title: 'What a breach establishes',
      text: 'That two verified transfers occurred in a specific relationship, and therefore that the originator’s own published rule was not met. It does not establish intent, control of either address by any person or entity, the existence of an off-chain loan, or any violation of law. A breach is a broken commitment, and calling it anything stronger would be the interface overstating what the cryptography settled.',
    },
    {
      t: 'next',
      items: [
        { href: '/docs/enforcement', label: 'Enforcement', sub: 'The arithmetic of a slash' },
        { href: '/docs/reference-challenger', label: 'The reference challenger', sub: 'An open process anyone can run' },
        { href: '/docs/security', label: 'Security', sub: 'Threats and assumptions' },
      ],
    },
  ],
};


const coverage: DocPage = {
  slug: 'coverage',
  title: 'Activity coverage',
  summary: 'How much of an originator’s declared activity actually reached a claim.',
  audience: 'Everyone',
  blocks: [
    {
      t: 'lead',
      text: 'Nothing forces an originator to register a loan. Rather than assume a book is complete, Clearbook measures how much of it is.',
    },
    {
      t: 'p',
      text: 'The obvious objection to any evidence-bound loan book is that the originator simply does not register the activity it would rather nobody examined. Clearbook cannot prevent that. It can measure it, and publishing that measurement is worth considerably more than pretending the problem does not exist.',
    },
    { t: 'h', text: 'The formula' },
    {
      t: 'code',
      lang: 'text',
      caption: 'A ratio with a stated denominator, not a rating',
      code: `coverage = committed / qualifying

qualifying  every successful outbound ERC-20 Transfer of a token this
            originator lends in, sent from a treasury it bound by
            signature, inside the measured block range

committed   those whose factId appears as a claim's disbursement`,
    },
    { t: 'h', text: 'What counts as qualifying' },
    {
      t: 'list',
      ordered: true,
      items: [
        'Emitted by a token contract this originator’s own claims are denominated in, read from the book and never configured.',
        '`from` equals one of the originator’s bound treasuries.',
        'The transaction receipt succeeded. A reverted transfer moved nothing and is excluded.',
        'The block falls inside the stated range.',
        'It is a standard ERC-20 `Transfer`. ERC-721 shares the same event signature and is excluded.',
      ],
    },
    { t: 'h', text: 'How a transfer is matched to a claim' },
    {
      t: 'p',
      text: 'Not by amount, and not by transaction hash. Each transfer is reduced to the vault’s own identity, `keccak256(abi.encode(chainKey, blockHeight, txIndex, logIndex))`, and compared against the disbursement facts on the book. `logIndex` here is **transaction-local**: the log’s position inside its own receipt, not the block-global index `eth_getLogs` returns. Conflating the two produces a plausible-looking identifier for a fact that does not exist, which is why the receipt fetch is mandatory rather than an optimisation.',
    },
    { t: 'h', text: 'The three classes' },
    {
      t: 'table',
      head: ['Class', 'Meaning'],
      rows: [
        ['Committed to a claim', 'Proved, and bonded against by a claim.'],
        ['Verified, never claimed', 'Proved into the vault, but no claim cites it.'],
        ['Never verified', 'Never entered the verification pipeline at all.'],
      ],
    },
    {
      t: 'note',
      tone: 'default',
      title: 'Coverage is not a credit score',
      text: 'It says nothing about creditworthiness, default risk, or whether an originator is trustworthy. It is one deterministic ratio over a stated scope, and it is an input to a judgement rather than the judgement itself.',
    },
    { t: 'h', text: 'What it cannot see' },
    {
      t: 'split',
      canTitle: 'Measured',
      can: [
        'Outbound transfers from treasuries bound by signature',
        'Tokens the originator’s own claims are denominated in',
        'The stated source-chain block range',
        'Successful transfers only',
      ],
      cannotTitle: 'Invisible to it',
      cannot: [
        'Any address the originator never declared',
        'Tokens it has never lent in',
        'Activity outside the measured block range',
        'Whether an uncommitted transfer was even a loan',
      ],
    },
    {
      t: 'p',
      text: 'That first limitation is the important one, and it ships beside every figure rather than in a footnote. What stops the measurement being theatre is that **binding cannot be undone**: `bindTreasury` reverts `AlreadyBound` for any address already bound, and the contract has no unbind path. A treasury cannot be quietly un-declared once its activity becomes inconvenient.',
    },
    {
      t: 'p',
      text: 'The denominator also counts activity that was never meant to be a loan. Gas top-ups, rebalancing and fee payments all appear as uncommitted. Coverage measures what reached a claim, not what should have.',
    },
    { t: 'h', text: 'Recomputing it yourself' },
    {
      t: 'p',
      text: 'Every input is public. The scope, the declared treasuries and their binding blocks are shown with the figure, and `npm run gate10` recomputes the same number with a second, independently written implementation and fails if the two disagree.',
    },
    {
      t: 'next',
      items: [
        { href: '/docs/evidence-registry', label: 'The evidence registry', sub: 'What a verified fact is' },
        { href: '/docs/limitations', label: 'Limitations', sub: 'Everything this system does not establish' },
      ],
    },
  ],
};

const clearance: DocPage = {
  slug: 'clearance',
  title: 'Clearance',
  summary:
    'A pre-advance check: whether a verified fact is already committed to a claim on this book.',
  audience: 'Users',
  blocks: [
    {
      t: 'lead',
      text: 'Clearance is the one screen in Clearbook that produces a decision rather than a display. A lender pastes the transaction it is about to advance against, and the book answers in one of three ways, each carrying its own scope.',
    },
    { t: 'h', text: 'Why the check exists' },
    {
      t: 'p',
      text: 'The uniqueness rule described in [one fact, one claim](/docs/duplicate-commitment) is enforced by the protocol, but only at the moment a claim is registered. Until Clearance, the only way to discover that a fact was already spent was to send a transaction and have it revert with `FactAlreadyUsed`. That is a fine guarantee and a poor workflow: the party who most needs the answer is the one deciding whether to lend, and that decision happens **before** anything is registered.',
    },
    {
      t: 'p',
      text: 'Clearance turns an after-the-fact refusal into a question anyone can ask in advance, with no wallet, no signature and no write.',
    },
    { t: 'h', text: 'The three answers' },
    {
      t: 'table',
      head: ['Outcome', 'What it means', 'What it does not mean'],
      rows: [
        [
          '**Clear in Clearbook**',
          'The transaction was verified by the Block Prover precompile, and no fact it carries is consumed by a claim on this book.',
          'That the underlying real-world obligation is unpledged anywhere else.',
        ],
        [
          '**Encumbered in Clearbook**',
          'At least one verified fact in this transaction is already committed to a claim. The protocol will refuse a second claim citing it.',
          'That the borrower has done anything wrong. A funding leg is legitimately committed once.',
        ],
        [
          '**Unverifiable**',
          'No answer can be given, and the exact reason is named: reverted, unattested, not found, no transfer log, or the prover is unavailable.',
          'That the transaction is bad. Most unverifiable results are timing, not fraud.',
        ],
      ],
    },
    {
      t: 'note',
      tone: 'pending',
      title: 'The failure direction is deliberate',
      text: 'Every path that cannot produce an answer returns **unverifiable**, never clear. A clearance check that quietly degraded to "clear" when its prover was down would be confidently wrong at exactly the moment the infrastructure it depends on had failed. `npm run gate11` asserts this for every failure path.',
    },
    { t: 'h', text: 'What runs' },
    {
      t: 'flow',
      steps: [
        { label: 'Locate the transaction', sub: 'Read from the source chain directly' },
        { label: 'Resolve the chain key', sub: 'From the ChainInfo precompile, never hardcoded' },
        { label: 'Derive fact identity', sub: 'One per qualifying transfer leg' },
        { label: 'Check attestation', sub: 'Attestors attest finalized blocks' },
        { label: 'Fetch proof', sub: 'From the untrusted proof builder' },
        { label: 'Verify at the precompile', sub: 'Nothing downstream runs unless this returns true', tone: 'verified' },
        { label: 'Read the registry', sub: 'EvidenceVault.exists' },
        { label: 'Read factConsumedBy', sub: 'The global mapping decides the answer' },
      ],
    },
    { t: 'h', text: 'One transaction can carry several facts' },
    {
      t: 'p',
      text: 'A transaction may contain more than one ERC-20 transfer. Each qualifying leg gets its own fact identity, and each is checked separately. **Any encumbered leg encumbers the transaction**, because a transaction is not safe to advance against merely because one of its legs happens to be free.',
    },
    {
      t: 'p',
      text: 'A leg is identified by its position in that transaction\u2019s own log array, not by the block-global log index a log query returns. This mirrors `EvidenceVault._decodeAndStore`, which indexes the receipt it decoded. Using the block-global value would compute an identity for a different log, and the answer would silently be about the wrong thing.',
    },
    {
      t: 'code',
      lang: 'solidity',
      caption: 'The rules Clearance mirrors, from EvidenceVault',
      code: `if (logIndex >= receipt.receiptLogs.length) revert LogIndexOutOfRange();

EvmV1Decoder.LogEntry memory lg = receipt.receiptLogs[logIndex];
if (lg.topics.length != 3 || lg.topics[0] != ERC20_TRANSFER_TOPIC) revert NotATransferLog();
if (lg.data.length != 32) revert MalformedTransferLog();`,
    },
    {
      t: 'p',
      text: 'The three-topic rule is what excludes an ERC-721 Transfer, which shares the same topic0 but carries a fourth indexed topic that would otherwise be misread as an amount.',
    },
    { t: 'h', text: 'The boundary' },
    {
      t: 'split',
      canTitle: 'Clearance can tell you',
      can: [
        'That a transaction provably occurred on a chain the attestors attest.',
        'The exact fact identity the protocol would assign each transfer in it.',
        'Whether each of those facts is already stored in the shared registry.',
        'Whether each is already committed to a claim, and to which loan.',
        'That this holds across every originator, not just the one you asked about.',
      ],
      cannotTitle: 'Clearance cannot tell you',
      cannot: [
        'That the underlying obligation is unpledged outside this book.',
        'That the same obligation is not represented by a different transaction.',
        'That an originator has not simply kept this activity off the book entirely.',
        'That a clear result makes the collateral safe to lend against.',
      ],
    },
    {
      t: 'note',
      title: 'Fact identity is not collateral identity',
      text: 'This is the limit that matters most. Clearbook prevents the same **proven fact** from being committed twice. It does not prevent two originators from pledging the same real-world obligation through two different transactions. A check that implied otherwise would be worse than no check, so the interface states the scope beside every answer rather than leaving the reader to remember it. See [what Clearbook proves](/docs/proves) and [coverage](/docs/coverage), which measures the activity a book never registered at all.',
    },
    { t: 'h', text: 'Checking it yourself' },
    {
      t: 'p',
      text: 'Every input is public and the whole path is read-only, so the answer can be reproduced without permission. `npm run gate11` checks the local fact-identity derivation against `EvidenceVault.computeFactId` on the deployed contract across the uint64 and uint32 edges, and `npm run clearance:check` runs the same function the page runs from a terminal.',
    },
    {
      t: 'next',
      items: [
        { href: '/docs/duplicate-commitment', label: 'One fact, one claim', sub: 'The rule Clearance surfaces' },
        { href: '/docs/coverage', label: 'Activity coverage', sub: 'What never reached the book at all' },
        { href: '/docs/proves', label: 'What Clearbook proves', sub: 'The exact boundary' },
      ],
    },
  ],
};

export const productPages: DocPage[] = [
  registry,
  coverage,
  duplicate,
  clearance,
  claims,
  covenants,
  challenges,
];
