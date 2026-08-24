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

export const productPages: DocPage[] = [registry, coverage, duplicate, claims, covenants, challenges];
