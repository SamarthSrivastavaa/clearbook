import type { DocPage } from '../types';

/**
 * The protocol layer: contracts, formal predicate, state machines, invariants.
 *
 * Everything here is stated precisely enough to be checked against the source.
 * Where a rule is arithmetic, it is written as arithmetic.
 */

const contracts: DocPage = {
  slug: 'protocol',
  title: 'Contracts',
  summary: 'Three contracts, their responsibilities, and the order their guards run in.',
  audience: 'Developers',
  blocks: [
    {
      t: 'lead',
      text: 'Three contracts on Creditcoin. `EvidenceVault` decides what is true, `Clearbook` decides what it means for a claim, and `CovenantLib` decides whether a rule was met.',
    },
    { t: 'h', text: 'EvidenceVault' },
    {
      t: 'p',
      text: 'Permissionless. Anyone may submit a proof; the submitter gains no privilege over the resulting fact. Its step order is load-bearing:',
    },
    {
      t: 'list',
      ordered: true,
      items: [
        '**Dedupe.** Compute `factId`. If it already exists, return it and stop. No verification, no event, no state change.',
        '**Verify.** Call `verifyAndEmit` on the Block Prover precompile. Revert `ProofRejected` if it returns false.',
        '**Decode.** Run the official `EvmV1Decoder` over the verified bytes, assert `receiptStatus == 1`, extract the ERC-20 `Transfer` at the given transaction-local `logIndex`, and store.',
      ],
    },
    {
      t: 'note',
      tone: 'pending',
      title: 'Dedupe precedes verify, deliberately',
      text: 'It makes replay nearly free and the worker restart-safe. The consequence is that a bundle whose identity is already stored returns early **without testing the proof**, so any forgery test must submit at an unstored identity or it proves nothing at all.',
    },
    { t: 'h', text: 'Fact identity' },
    {
      t: 'code',
      lang: 'solidity',
      caption: 'contracts/src/EvidenceVault.sol',
      code: 'factId = keccak256(abi.encode(chainKey, blockHeight, txIndex, logIndex));',
    },
    {
      t: 'p',
      text: 'Four coordinates, not a transaction hash. A transaction hash identifies a transaction; a claim cites a **transfer**, and one transaction routinely carries many. Keying on the hash would collapse distinct transfers into a single identity. We observed 17 and 30 relevant `Transfer` logs inside single real transactions.',
    },
    {
      t: 'p',
      text: '`logIndex` is **transaction-local**: an index into `ReceiptFields.receiptLogs`, not the block-global index `eth_getLogs` returns. The two differ routinely. Conflating them computes the identity over the wrong value, and the resulting fact would describe a different transfer than intended.',
    },
    { t: 'h', text: 'Clearbook' },
    {
      t: 'table',
      head: ['Function', 'Effect'],
      rows: [
        ['`registerOriginator`', 'Creates an originator with a bond, a covenant, and immutable windows'],
        ['`bindTreasury`', 'Binds an address by EIP-712 signature. One address, one originator, ever'],
        ['`topUpBond` / `withdrawBond`', 'Adjusts bond. Withdrawal is subject to `WITHDRAW_COOLDOWN`'],
        ['`registerLoan`', 'Commits a disbursement fact to a new claim and reserves bond'],
        ['`claimRepayment`', 'Commits a repayment fact and opens the challenge window'],
        ['`markDelinquent`', 'Marks a claim past maturity with no repayment'],
        ['`finalize`', 'Settles a claim whose challenge window closed unchallenged'],
        ['`challenge`', 'Evaluates the covenant and, on breach, slashes and pays'],
      ],
    },
    { t: 'h', text: 'Guard order in registerLoan' },
    {
      t: 'p',
      text: 'The order is observable behaviour rather than an implementation detail. It determines **which error a caller sees**, and therefore what they learn about why they were refused.',
    },
    {
      t: 'table',
      head: ['#', 'Guard', 'Error'],
      rows: [
        ['1', 'Caller owns the originator', '`NotOwner`'],
        ['2', 'Originator is active', '`InactiveOriginator`'],
        ['3', 'Maturity is in the future', '`BadWindow`'],
        ['4', '**Fact is not already committed**', '**`FactAlreadyUsed`**'],
        ['5', 'Free bond covers `BOND_PER_LOAN`', '`InsufficientBond`'],
        ['6', 'Fact exists in the vault', '`UnknownFact`'],
        ['7', 'Token, recipient and amount match the claim', '`FactMismatch`'],
        ['8', 'Sender is a treasury bound to this originator', '`TreasuryNotBound`'],
      ],
    },
    {
      t: 'note',
      title: 'Why 4 must precede 8',
      text: 'A second originator citing a committed fact fails at 4 with `FactAlreadyUsed`. If uniqueness were checked after the binding, that caller would instead see `TreasuryNotBound`. That is true, but it reports a different reason and conceals the uniqueness property entirely. A regression test pins this ordering.',
    },
    {
      t: 'next',
      items: [
        { href: '/docs/covenant-predicate', label: 'The covenant predicate', sub: 'Stated formally' },
        { href: '/docs/state-machine', label: 'State machines', sub: 'Claims and evidence' },
        { href: '/docs/invariants', label: 'Invariants', sub: 'What must always hold' },
      ],
    },
  ],
};

const predicate: DocPage = {
  slug: 'covenant-predicate',
  title: 'The covenant predicate',
  summary: 'CIRCULAR_REPAYMENT stated as a formal condition over two verified facts.',
  audience: 'Developers',
  blocks: [
    {
      t: 'lead',
      text: 'A covenant is a predicate over verified evidence. Because it is arithmetic and equality over recorded fields, the contract can evaluate it without interpretation.',
    },
    { t: 'h', text: 'Notation' },
    {
      t: 'table',
      head: ['Symbol', 'Meaning'],
      rows: [
        ['`L`', 'The claim under challenge'],
        ['`O`', 'The originator of `L`'],
        ['`f_d`, `f_r`', 'The disbursement and repayment facts of `L`'],
        ['`f_f`', 'The funding fact cited by the challenger'],
        ['`K(f)`, `T(f)`, `A(f)`, `H(f)`', 'chainKey, token, amount, blockHeight of fact `f`'],
        ['`S(f)`, `R(f)`', 'Sender and recipient of fact `f`'],
        ['`bound(a)`', '`treasuryOwner[a]`. The originator that proved control of address `a`, or 0'],
        ['`W_c`, `W_ch`', '`O.circularWindow` in source blocks; `O.challengeWindow` in Creditcoin blocks'],
      ],
    },
    { t: 'h', text: 'The predicate' },
    {
      t: 'p',
      text: 'A challenge succeeds if and only if **all eleven** conjuncts hold. Any single failure reverts with that conjunct’s named error, and no state changes.',
    },
    {
      t: 'code',
      lang: 'text',
      caption: 'Breach(L, f_f). All must hold',
      code: `  1.  status(L) = REPAYMENT_CLAIMED                    WrongStatus
  2.  block.number ≤ claimBlock(L) + W_ch                WindowClosed

  3.  K(f_f) = K(f_r)                                    ChainMismatch
  5.  R(f_f) = S(f_r)                                    NotTheSamePayer
  6.  bound(S(f_f)) = id(O)                              FundingNotFromBoundTreasury

  4.  T(f_f) = T(f_r)                                    TokenMismatch
  7.  A(f_f) ≥ A(f_r)                                    FundingBelowRepayment

  8.  H(f_f) ≤ H(f_r)                                    FundingNotBefore
  9.  H(f_r) − H(f_f) ≤ W_c                              OutsideWindow

 10.  id(f_f) ≠ id(f_r)                                  SameFact
 11.  id(f_f) ≠ id(f_d)                                  DisbursementNotFunding`,
    },
    {
      t: 'p',
      text: 'Grouped by what each tests: **1–2** eligibility, **3, 5, 6** identity, **4, 7** value, **8–9** timing, **10–11** distinctness. Conditions 3–9 are a pure function in `CovenantLib`; 1, 2, 10 and 11 are enforced in `Clearbook.challenge()` because they depend on claim state.',
    },
    { t: 'h', text: 'What the predicate does not quantify over' },
    {
      t: 'p',
      text: 'The predicate ranges over exactly two facts: the cited funding leg and the claim’s repayment. It contains no existential over intermediate addresses, so a flow `treasury → X → payer → treasury` satisfies no conjunct set unless `X` is itself bound. This is **depth-1 by construction**, and it is why the rule is framed as a covenant the originator chose rather than as detection.',
    },
    {
      t: 'note',
      title: 'Soundness and completeness',
      text: 'The predicate is **sound** with respect to its own statement. If it returns true, those eleven relations hold over evidence the precompile verified. It is not **complete** with respect to circular financing in general: flows outside its quantification are not detected. See [limitations](/docs/limitations).',
    },
    {
      t: 'next',
      items: [
        { href: '/docs/enforcement', label: 'Enforcement', sub: 'What follows a true predicate' },
        { href: '/docs/invariants', label: 'Invariants', sub: 'What holds regardless' },
      ],
    },
  ],
};

const enforcement: DocPage = {
  slug: 'enforcement',
  title: 'Enforcement and economics',
  summary: 'The arithmetic of a slash, and why a challenger needs no bond.',
  audience: 'Developers',
  blocks: [
    {
      t: 'lead',
      text: 'A true predicate settles atomically in the transaction that proved it. There is no dispute period because there is nothing to deliberate.',
    },
    { t: 'h', text: 'The arithmetic' },
    {
      t: 'code',
      lang: 'text',
      caption: 'Basis points are out of 10,000',
      code: `slash   = BOND_PER_LOAN × SLASH_BPS  / 10000
bounty  = slash         × BOUNTY_BPS / 10000
toSink  = slash − bounty

with the deployed parameters:

slash   = 1 tCTC × 10000 / 10000  =  1.0 tCTC
bounty  = 1 tCTC ×  5000 / 10000  =  0.5 tCTC
toSink  = 1.0 − 0.5               =  0.5 tCTC`,
    },
    {
      t: 'p',
      text: 'The originator’s bond decreases by `slash`; the challenger’s balance increases by `bounty`; the protocol sink receives `toSink`. The claim’s reserved exposure is released, and its status becomes `BREACHED`, which is terminal.',
    },
    { t: 'h', text: 'Why the challenger posts no bond' },
    {
      t: 'p',
      text: 'A challenger bond exists to price spam. Here spam is already priced: an invalid challenge **reverts**, so it changes no state and consumes only the sender’s gas. Requiring a bond would add a barrier to the one action the system wants to be maximally available, in exchange for deterring behaviour that is already self-defeating.',
    },
    {
      t: 'table',
      head: ['Outcome', 'Originator', 'Challenger', 'Sink'],
      rows: [
        ['Valid challenge', '−1.0 tCTC bond, exposure released', '+0.5 tCTC, less gas', '+0.5 tCTC'],
        ['Invalid challenge', 'Unchanged', '−gas', 'Unchanged'],
        ['Window closes unchallenged', 'Exposure released on `finalize`', 'Unchanged', 'Unchanged'],
      ],
    },
    {
      t: 'note',
      title: 'The bounty must be strictly less than the slash',
      text: 'If `bounty = slash`, an originator could challenge its own breaching claim and recover the full bond, making the covenant costless to break. `BOUNTY_BPS < SLASH_BPS` is what makes self-challenge strictly loss-making. The difference is burned, and nothing recovers it.',
    },
    {
      t: 'next',
      items: [
        { href: '/docs/invariants', label: 'Invariants', sub: 'Accounting that must hold' },
        { href: '/docs/security', label: 'Security', sub: 'Threats and assumptions' },
      ],
    },
  ],
};

const stateMachine: DocPage = {
  slug: 'state-machine',
  title: 'State machines',
  summary: 'Claim states, evidence states, and the transitions between them.',
  audience: 'Developers',
  blocks: [
    { t: 'lead', text: 'Two state machines: one for claims on-chain, one for evidence acquisition off-chain.' },
    { t: 'h', text: 'Claim states' },
    {
      t: 'table',
      head: ['From', 'To', 'Via', 'Condition'],
      rows: [
        ['`NONE`', '`REGISTERED`', '`registerLoan`', 'Disbursement fact committed; bond reserved'],
        ['`REGISTERED`', '`REPAYMENT_CLAIMED`', '`claimRepayment`', 'Repayment fact committed'],
        ['`REGISTERED`', '`DELINQUENT`', '`markDelinquent`', 'Past maturity, no repayment'],
        ['`DELINQUENT`', '`REPAYMENT_CLAIMED`', '`claimRepayment`', 'Late repayment still admissible'],
        ['`REPAYMENT_CLAIMED`', '`SETTLED`', '`finalize`', 'Challenge window closed unchallenged'],
        ['`REPAYMENT_CLAIMED`', '`BREACHED`', '`challenge`', 'Predicate satisfied. Terminal'],
      ],
    },
    {
      t: 'p',
      text: '`SETTLED` and `BREACHED` are terminal. A challenge against either reverts `WrongStatus`, which is condition 1 of the predicate.',
    },
    { t: 'h', text: 'Evidence acquisition' },
    {
      t: 'flow',
      steps: [
        { label: 'DISCOVERED', sub: 'A watched transfer was seen on the source chain' },
        { label: 'WAITING_ATTESTATION', sub: 'The containing block is not yet attested' },
        { label: 'PROVED', sub: 'Proof retrieved; txIndex taken from the precompile, not guessed' },
        { label: 'SUBMITTED', sub: 'Bundle sent to the vault' },
        { label: 'CONFIRMED', sub: 'Stored on Creditcoin', tone: 'verified' },
      ],
    },
    {
      t: 'p',
      text: '`PRECHECK_FAILED` and `FAILED` are terminal side-exits, entered when a free pre-flight check fails or when a permanent error is classified. Transient errors return to `DISCOVERED` and retry.',
    },
    { t: 'h', text: 'Crash semantics' },
    {
      t: 'p',
      text: 'Every transition is persisted **before** the next begins, so a process killed at any point leaves a row in a well-defined state. On startup, rows stranded in `WAITING_ATTESTATION`, `PROVED` or `SUBMITTED` are re-queued to `DISCOVERED`.',
    },
    {
      t: 'p',
      text: 'Replay is safe by construction: proving is read-only, the database key mirrors `factId` exactly, and the vault is idempotent. A re-submitted fact re-derives the same identity and is reported as already existing rather than stored twice.',
    },
    {
      t: 'next',
      items: [
        { href: '/docs/invariants', label: 'Invariants', sub: 'What holds across all transitions' },
        { href: '/docs/architecture', label: 'Architecture', sub: 'Where each machine runs' },
      ],
    },
  ],
};

const invariants: DocPage = {
  slug: 'invariants',
  title: 'Invariants',
  summary: 'Properties that hold across every reachable state, checked by fuzzing.',
  audience: 'Developers',
  blocks: [
    {
      t: 'lead',
      text: 'Five invariants, asserted after every call in a randomised sequence. They are the accounting the system cannot violate without a bug.',
    },
    {
      t: 'code',
      lang: 'text',
      caption: 'Let B_o = bond of originator o, E_o = exposure of o',
      code: `I1   balance(Clearbook)  ≥  Σ_o B_o
       The contract can always pay out every bond it holds.

I2   ∀ o :  B_o  ≥  E_o
       No originator is exposed beyond what it has posted.

I3   ∀ committed f :  factConsumedBy[f] = the unique claim citing f
       No fact backs two claims. Global, not per originator.

I4/I6  status(L) and E_o agree for every claim
       Exposure is reserved exactly while a claim is open.

I5   ∀ stored f :  receiptStatus(f) = 1
       No fact derives from a reverted source transaction.`,
    },
    { t: 'h', text: 'How they are checked' },
    {
      t: 'p',
      text: 'A handler drives randomised sequences of protocol calls and the invariants are asserted after each. The suite runs 64 sequences of 4,096 calls per invariant.',
    },
    {
      t: 'note',
      tone: 'pending',
      title: 'A passing invariant suite can still be vacuous',
      text: 'An earlier version of this suite passed every invariant while the fuzzer never once reached `challenge()`. The properties held only because the interesting states were never entered. `test_handler_reaches_a_breach` is a permanent guard that asserts the handler actually gets there. An invariant suite that cannot reach its own failure modes proves nothing.',
    },
    { t: 'h', text: 'Coverage' },
    {
      t: 'table',
      head: ['Measure', 'Value'],
      rows: [
        ['Tests', '94, across 7 suites'],
        ['Line coverage of `src/`', '100% (151/151)'],
        ['Branch coverage of `Clearbook.sol`', '75.61%, recorded rather than hidden'],
        ['Invariant runs', '64 sequences × 4,096 calls, per invariant'],
      ],
    },
    {
      t: 'p',
      text: 'The uncovered branches are mostly compound-condition short-circuits already exercised from one side. Line coverage is the stated criterion; the branch figure is published because omitting it would be the more flattering choice.',
    },
    {
      t: 'next',
      items: [
        { href: '/docs/security', label: 'Security', sub: 'Threats these invariants bound' },
        { href: '/docs/reference', label: 'Reference', sub: 'Parameters and errors' },
      ],
    },
  ],
};

const verification: DocPage = {
  slug: 'verification',
  title: 'Verification pipeline',
  summary: 'How a source-chain transfer becomes a fact a contract will accept.',
  audience: 'Developers',
  blocks: [
    {
      t: 'lead',
      text: 'Four stages between a transfer occurring and a contract being willing to act on it. Each refuses to proceed if the previous cannot be established.',
    },
    { t: 'h', text: '1 · Attestation' },
    {
      t: 'p',
      text: 'Attestors reach quorum on a **finalized** source block. Until that happens no proof can be built against it, and the evidence simply does not exist as far as Creditcoin is concerned. The chain key is resolved from the ChainInfo precompile at runtime and never hardcoded. A hardcoded key is exactly how a Sepolia transfer ends up presented as mainnet.',
    },
    { t: 'h', text: '2 · Proof construction' },
    {
      t: 'p',
      text: 'The proof builder returns a Merkle inclusion proof for the transaction plus continuity roots linking the block to an attested endpoint. It is **untrusted**: it supplies material, not conclusions. A malicious proof builder can withhold service; it cannot cause a false fact, because stage 3 would reject the bundle.',
    },
    { t: 'h', text: '3 · On-chain verification' },
    {
      t: 'p',
      text: '`EvidenceVault` calls the Block Prover precompile. If it returns false the transaction reverts `ProofRejected` and nothing is stored. A valid proof was mutated in six ways: a Merkle sibling, a continuity root, the lower endpoint digest, the block height, an `isLeft` flag, and one byte of the transaction. Every one of the six was rejected on-chain.',
    },
    { t: 'h', text: '4 · Receipt decoding' },
    {
      t: 'p',
      text: 'The official `EvmV1Decoder` runs **on-chain**, inside the vault, over bytes the precompile has just verified. Three checks follow, each with its own error:',
    },
    {
      t: 'list',
      items: [
        '`receiptStatus == 1`, else `SourceTxReverted`. The precompile proves inclusion rather than success, and a reverted transfer moved no value',
        'A log exists at the given transaction-local index, else `LogIndexOutOfRange`',
        'That log is a well-formed ERC-20 `Transfer`, else `NotATransferLog` or `MalformedTransferLog`',
      ],
    },
    {
      t: 'note',
      tone: 'verified',
      title: 'Where the trust actually sits',
      text: 'Stages 1 and 2 involve parties outside our control. Neither is trusted. Stage 3 is what converts material into fact. Replace it with anything that merely reports, and every downstream guarantee collapses into "trust our backend".',
    },
    { t: 'h', text: 'Timing' },
    {
      t: 'table',
      head: ['Stage', 'Measured'],
      rows: [
        ['Broadcast to usable evidence', '~8–10 minutes'],
        ['Share of that spent awaiting attestation', '97–99%'],
        ['`verify()` at the precompile', '0.8 s'],
        ['`submitTransferFact`', '~226,000 gas'],
      ],
    },
    {
      t: 'p',
      text: 'The latency is not overhead awaiting optimisation. Attestors attest finalized blocks; the wait **is** the security property, and shortening it would weaken the guarantee it produces.',
    },
    {
      t: 'next',
      items: [
        { href: '/docs/source-chains', label: 'Source chains', sub: 'What is attested' },
        { href: '/docs/protocol', label: 'Contracts', sub: 'What consumes the proof' },
      ],
    },
  ],
};


const referenceChallenger: DocPage = {
  slug: 'reference-challenger',
  title: 'The reference challenger',
  summary: 'An open process anyone can run that submits real challenges. The protocol does not depend on it.',
  audience: 'Developers',
  blocks: [
    {
      t: 'lead',
      text: 'Enforcement that requires someone to be watching is only as good as whoever is watching. Clearbook ships a process that watches, and it holds no privilege whatsoever.',
    },
    {
      t: 'p',
      text: 'The reference challenger reads the shared book, finds claims whose challenge window is open, looks for verified evidence that would breach one, and submits a real `challenge()` transaction. It is an ordinary account with gas calling a public function. **Anyone can run it, and Clearbook works exactly the same if nobody does.**',
    },
    { t: 'h', text: 'What it is not' },
    {
      t: 'split',
      canTitle: 'It does',
      can: [
        'Read public state and public events',
        'Simulate `challenge()` against the deployed contract',
        'Broadcast a transaction any account could broadcast',
        'Compete with other challengers for the same bounty',
      ],
      cannotTitle: 'It does not',
      cannot: [
        'Monitor anyone. It reads a public book, exactly as any observer would',
        'Decide that a covenant was breached; only the contract does that',
        'Hold any role, permission, or privileged access',
        'Guarantee detection, or claim a book is clean',
      ],
    },
    {
      t: 'note',
      tone: 'default',
      title: 'Clearbook does not monitor your loans',
      text: 'It would be easy to describe this as monitoring, and it would be wrong. There is no service, no subscription, and no operator watching on anyone’s behalf. There is a public book and a loop that anyone may run against it.',
    },
    { t: 'h', text: 'Two rules' },
    {
      t: 'p',
      text: '**The contract is the authority.** Off-chain filtering only decides which candidates deserve a simulation. Nothing is broadcast unless `eth_call` against the deployed `challenge()` succeeds first with the exact arguments intended. A filter that is too permissive wastes a call; one that is too strict misses a detection. Neither can produce a wrong slash.',
    },
    {
      t: 'p',
      text: '**It reports the shape rather than flattening it.** Transfer facts cannot distinguish money that funded a repayment from money that merely preceded it, so a second tranche looks exactly like a circular flow. Both break a rule the originator published and bonded against, so the challenger acts on both, but it records which of the two it found. A third party the treasury funded repaying the loan has no ordinary lending explanation; the borrower repaying after receiving more money has an obvious one. Set `CHALLENGER_STRICT=true` to refuse the weaker shape entirely. See [limitations](/docs/limitations).',
    },
    {
      t: 'flow',
      steps: [
        { label: 'Read open claims', sub: 'REPAYMENT_CLAIMED, window still open' },
        { label: 'Match verified evidence', sub: 'off-chain filter, an optimisation only' },
        { label: 'Classify the shape', sub: 'third-party, or the weaker same-borrower case', tone: 'pending' },
        { label: 'Simulate on-chain', sub: 'eth_call against the deployed challenge()' },
        { label: 'Broadcast, or stop', sub: 'a revert ends it; nothing is sent', tone: 'default' },
        { label: 'Bond slashed, bounty paid', sub: 'settled in one transaction', tone: 'breach' },
      ],
    },
    { t: 'h', text: 'Races are expected' },
    {
      t: 'p',
      text: 'A human may challenge the same claim first. Another challenger may win. The window may close between simulation and inclusion. In every case the transaction simply reverts and the process moves on. Losing a race is the normal outcome of a competitive bounty rather than a failure.',
    },
    { t: 'h', text: 'Why competition is the point' },
    {
      t: 'p',
      text: 'Multiple independent challengers competing for the same bounty is intended. It is also an economic hypothesis rather than a demonstrated property: more claims make the shared evidence more valuable, which creates more opportunities to challenge, which should attract more independent challengers. Nothing here proves that happens at scale.',
    },
    { t: 'h', text: 'Running it' },
    {
      t: 'code',
      lang: 'bash',
      caption: 'Set a funded throwaway key; without it the worker skips enforcement entirely',
      code: `CHALLENGER_PRIVATE_KEY=0x...   # an ordinary account with gas
CLEARBOOK_ADDRESS=0x...

npm run worker`,
    },
    {
      t: 'p',
      text: 'The key is read from the environment, never logged and never exposed to the browser. It holds no protocol authority: if it were compromised, the attacker could challenge claims and collect bounties, which is precisely what any member of the public may already do.',
    },
    {
      t: 'next',
      items: [
        { href: '/docs/enforcement', label: 'Enforcement and economics', sub: 'What a slash pays, and to whom' },
        { href: '/docs/limitations', label: 'Limitations', sub: 'Why a breach is not the same as fraud' },
      ],
    },
  ],
};

export const protocolPages: DocPage[] = [
  contracts,
  predicate,
  enforcement,
  referenceChallenger,
  stateMachine,
  invariants,
  verification,
];
