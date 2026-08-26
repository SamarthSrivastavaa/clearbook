# Clearbook — what it is and what is built

Written 25 August 2026. Every figure here was read from the running system or
from the repository, not recalled. Where something is unmeasured or unproven, it
says so.

---

# Part 1 — In plain language

## The problem, without jargon

Imagine a fund that lends money. It keeps a list of its loans: who borrowed,
how much, and whether they paid it back. Investors and other lenders read that
list to decide whether the fund is doing well.

**The list is written by the fund itself.**

Nobody outside can check it. If the fund says "this loan was repaid", the only
evidence is the fund's own word. And there is a specific trick this makes
possible: the fund quietly sends its *own* money to the borrower, the borrower
sends it straight back, and the fund records a repayment. Money moved. A bank
statement exists. But nothing was actually repaid — the fund paid itself.

There is a second problem, and in 2026 it stopped being hypothetical.

Each lender only sees its own copy of the paperwork. If the same asset or the
same payment is shown to two different lenders as backing for two different
loans, neither lender can tell, because neither can see the other's records.

When the UK bridging lender **Market Financial Solutions collapsed in early
2026**, court proceedings surfaced allegations that the same property assets had
been pledged multiple times to secure different loans. Over £2 billion in
lending exposure became entangled across banks and credit funds, Barclays among
them. Judges cited evidence of collateral verification failures within the
lending chain. The plainest description of what went wrong is that *multiple
lenders believed they held senior claims on the same assets, something that
should be structurally impossible in a modern financial system.*

It was possible because verification was off-chain, fragmented, and trust-based
rather than mathematically enforced. Double pledging of this kind is not simply
fraud. It is an infrastructure failure.

## What Clearbook does about it

Clearbook is a **shared noticeboard of verified payments** that several lending
funds use at once.

Four things make it different from a spreadsheet.

**1. The payments are checked, not claimed.**
When a fund says "this payment happened", Clearbook does not take its word.
It goes and proves the payment really occurred on a public blockchain — using
cryptography, not a database lookup. The fund cannot fake it, and neither can we.

**2. A payment can only be used once.**
Once a fund points at a payment and says "this is the disbursement for loan 4",
that payment is **spent**. No other fund can point at the same payment for a
different loan. The system physically refuses. Not by policy — the transaction
fails.

**3. Anyone can check before lending.**
A lender about to advance money can paste the transaction it is lending against
and ask: *is this already spoken for?* It gets one of three answers, with no
wallet and no permission. That question used to be answerable only by trying to
register a claim and watching it fail, which is far too late to be useful.

**4. The rules are published in advance, and anyone can enforce them.**
A fund publicly commits to a rule — for example, *"a repayment must not come from
money my own treasury just sent to the borrower"* — and puts up a cash deposit
against it. If anyone, anywhere, can show the rule was broken using verified
payments, they press a button: the fund loses its deposit and **the person who
proved it gets half.**

No committee. No appeal. No permission needed to be the person who checks.

## The one idea to take away

> **Checking that a payment happened needs nobody's permission.
> Using that payment to back a loan claim does.**

Anyone can prove a transfer occurred — including a transfer between two
strangers who have never heard of Clearbook. But *committing* that transfer to a
credit claim requires proving you control the address the money left, and it can
only ever happen once.

That asymmetry is the whole design.

---

# Part 2 — Properly

## What it actually is

Clearbook is a **shared, cryptographically verified evidence registry for
private-credit claims**, deployed on Creditcoin.

The precise implementation claim:

> Verified source-chain `TransferFact`s can be committed to credit claims, cannot
> be committed to multiple claims, are measurable against the activity an
> originator declared, are checkable before an advance, and are governed by
> immutable covenants that anyone may challenge and enforce.

## The mechanism, end to end

```
An ERC-20 transfer happens on Ethereum
        │              (a token we do not control, a chain we never deployed to)
        ▼
Attestors attest the finalized block          ~8–10 minutes
        ▼
A proof is built: Merkle inclusion + continuity roots
        ▼
The Block Prover precompile verifies it       on Creditcoin, 0.8s
        ▼
The receipt is decoded on-chain; receiptStatus == 1 asserted
        ▼
A TransferFact is stored — immutable, readable by anyone
        ▼
A claim commits it                            once, and only once
        ▼
A covenant is evaluated over it               11 conditions
        ▼
A challenge settles it                        bond slashed, challenger paid
```

Each step refuses to proceed if the one before it cannot be established.

Two read-only surfaces branch off this spine rather than extending it.
**Coverage** measures how much of an originator's observable activity ever
entered the pipeline at all. **Clearance** answers, for a single transaction,
whether the fact it carries has already been committed.

## Fact identity

A fact's identity is the thing every other guarantee hangs from:

```solidity
factId = keccak256(abi.encode(
    uint64 chainKey, uint64 blockHeight, uint64 txIndex, uint32 logIndex
))
```

Two details in that expression are easy to get wrong and fatal if you do.

**`chainKey` is not the EVM chain id.** It is assigned by the ChainInfo
precompile and resolved at runtime, never hardcoded. The two collide at `1` while
meaning different chains: chainKey 1 is Ethereum Sepolia, chainKey 3 is Ethereum
Mainnet.

**`logIndex` is transaction-local.** It is the position inside that
transaction's own log array, not the block-global index an `eth_getLogs` query
returns. The vault indexes `receipt.receiptLogs[logIndex]` on a decoded receipt,
so anything computing identity from the block-global value is describing a
different log, or no log at all.

## The covenant, formally

`CIRCULAR_REPAYMENT`, covenant id 1. Eleven conditions, evaluated on-chain, all
of which must hold for a breach to settle:

1. The claim is in `REPAYMENT_CLAIMED`.
2. The challenge window is still open.
3. Both cited facts exist and are verified.
4. The funding fact's `to` is the borrower.
5. The funding fact's `from` is a treasury bound to this originator.
6. Token identity matches across the legs.
7. Value is within tolerance.
8. The funding precedes the repayment.
9. It falls inside the declared circular window.
10. The two facts are distinct.
11. The funding fact is not the loan's own disbursement.

Condition 11 is what stops an honest loan being framed with its own funding leg.
Conditions 3 through 9 live in `CovenantLib` as a pure predicate, so the same
expression can be evaluated in a browser before a challenger spends gas.

**A sharp edge, documented rather than hidden.** A second tranche paid to the
same borrower inside the circular window satisfies every condition and is
therefore challengeable, even though a tranche is legitimate lending. The
covenant tests a shape, not an intent, and shapes cannot distinguish the two.
`contracts/test/CovenantSemantics.t.sol` pins this behaviour in a test named for
what it is, so the property cannot drift silently.

## The economics

Bond, bounty, burn. A breach slashes the originator's bond; half goes to whoever
proved it, half is burned to the protocol sink. The burn exists so that
challenging is not profitable enough to invite manufactured disputes, and the
bounty exists so that checking is not charity.

Exposure is bounded by free bond: an originator cannot register claims worth
more than it has staked.

---

# Part 3 — Every page, and why it exists

**Seven navigable surfaces**, plus a claim detail route. None was added to make
the product look larger.

## `/` — Landing

**Job:** make a stranger understand the product in about fifteen seconds, then
show them a real instance of it rather than describing one.

Opens with a live ticker of chain reads — block height, verified facts, bonds at
stake — so the first thing on screen proves the page is reading a live chain. The
hero carries a real breach that actually executed, rendered as the chain of
causes that produced it. Later sections state the three registers, the shared
evidence property, the covenant, enforcement, the technical foundation, and the
honest limits.

**Why it exists:** first contact. It is also the only page with a full footer.

## `/book` — The shared book

**Job:** answer "what needs my attention?" in under a second.

Opens with a sentence derived entirely from chain reads, then each originator's
position: bond posted, exposure, free bond, published windows. Then the claims,
with anything breached or challengeable lifted to the top and marked with a
status rule.

Currently shows **2 originators** — Meridian Credit Partners (8 tCTC bonded,
4 tCTC exposure) and Northgate Structured Credit (2 tCTC, no exposure) — and
**6 claims**: four in `REPAYMENT_CLAIMED`, two `BREACHED`. Meridian's bond began
at 10 tCTC and is 8 because two breaches were proven against it and settled.

**Why it exists:** this is the object the whole product is about. A loan book
that can be checked.

## `/registry` — Evidence registry

**Job:** show which verified facts exist and which claim, if any, has consumed
each one.

Deliberately not an explorer. An explorer answers *"what happened on a chain"*;
this answers *"what can still be committed to a credit claim, and what cannot."*
Consumption is read from `Clearbook.factConsumedBy` on-chain, never inferred.

Currently lists **12 verified facts** inside the scan window, of which **1 is
from Ethereum mainnet** — a real 10,506.42 USDC transfer between two strangers,
block 25,811,720. It is verified and permanently **uncommittable**, because
committing needs a treasury bound by signature and nobody here holds a key for
either address.

Opening a fact shows its provenance rail — Ethereum → Attestcoin → precompile →
Clearbook — and, for committed facts, runs a **live `eth_call`** asking the
deployed contract whether another originator could commit it. The contract
answers `FactAlreadyUsed`. That refusal is observed, not asserted.

The listing is a **bounded scan of the last 20,000 Creditcoin blocks**. There is
no indexer on this chain and the vault keeps no enumerable list. An older fact
is still fully citable by identifier and the contract accepts it regardless; the
bound limits the listing, never the protocol. The page says so on its face.

**Also carries Activity coverage.** For each originator, the fraction of its
qualifying outbound transfers, from treasuries it bound by signature, that
actually reached a claim:

```
coverage = committed / qualifying
```

It is a ratio with a stated denominator and an explicit scope, never a score. It
answers the obvious objection to any evidence-bound book — *what stops an
originator simply not registering the activity it would rather nobody looked at*
— which Clearbook cannot prevent and can only measure. The ratio never renders
without its denominator beside it, no colour ranks one originator above another,
and where there is no denominator no percentage is shown at all.

**Why it exists:** the registry is the state everything else rests on, and it is
where the verification/commitment asymmetry becomes visible on a real record.

## `/clearance` — Clearance

**Job:** answer, before an advance, whether the evidence is already spoken for.

Paste a transaction hash. Clearbook locates it on the source chain, resolves the
chain key from the precompile, derives the fact identity the protocol would
assign each transfer leg, checks attestation, fetches a proof, has the Block
Prover precompile rule on it, then reads `EvidenceVault.exists` and the global
`factConsumedBy`. Read-only throughout: no wallet, no signature, no write.

Three answers, each carrying its own scope:

| Outcome | Meaning |
|---|---|
| **Clear in Clearbook** | Verified, and no fact it carries is consumed by a claim on this book |
| **Encumbered in Clearbook** | At least one verified fact here is already committed. The protocol will refuse a second claim citing it |
| **Unverifiable** | No answer can be given, and the exact reason is named |

Three rules are enforced in code rather than left to the author:

1. **The verdict never renders without its scope.** The qualifier is exported as
   data and travels with the result, so no surface can show an outcome and forget
   it. "Clear" alone would be read as "this collateral is safe", which Clearbook
   cannot know.
2. **Every failure returns unverifiable, never clear.** A check that quietly
   degraded to "clear" when its prover was down would be confidently wrong at
   exactly the moment its infrastructure had failed.
3. **Every transfer leg is checked**, and any encumbered leg encumbers the whole
   transaction. A transaction is not safe to advance against merely because one
   of its legs happens to be free.

Three real transactions are offered as one-click examples, labelled by what each
transaction *is* rather than by what the answer will be, because the answer comes
from the live book on every run.

**Why it exists:** `factConsumedBy` already enforced uniqueness, but only at the
moment a claim was registered. Until this page, the only way to discover a fact
was spent was to send a transaction and watch it revert with `FactAlreadyUsed`.
The party who most needs that answer is the one deciding whether to lend, and
that decision happens before anything is registered. This is the MFS failure mode
turned into a question anyone can ask in advance.

## `/loan/[id]` — Claim detail

**Job:** let a credit analyst follow a claim, and let a protocol engineer drill to
the log index, on the same screen.

Shows the claim, its covenant as **declared versus observed**, the result, and
then every piece of cited evidence on the provenance rail — including, on a
breached claim, the funding leg the challenger cited. Cryptographic detail sits
behind progressive disclosure: available on every record, in the way on none.

**Why it exists:** a claim is the unit of the product. This is where it is
inspected.

## `/challenge` — Challenge console

**Job:** make proving a breach feel like an investigation rather than filling in
a form.

Four stages on a rail: select the claim, cite the funding evidence, evaluate the
covenant, submit and settle. Evidence is chosen from a list read out of the
vault's own logs — a challenger should not have to already know a 32-byte
identifier. All eleven conditions are evaluated client-side first and grouped by
what they test (eligibility, identity, value, timing, distinct evidence), each
showing its expression and, on failure, the observed value and named error.

A pinned column carries what is at stake — bond, bounty, burn — and the covenant
text, because those are needed *while* deciding, not after.

**Why it exists:** permissionless enforcement is the product's core claim. If
challenging is hard, the claim is hollow.

## `/verify` — Judge mode

**Job:** let anyone verify any Ethereum transaction, including one they found
themselves, with no wallet and no gas.

One instrument panel — source chain, hash, Verify — with two real examples
offered because most visitors do not have a transaction hash to hand. Beneath it
the verification path runs live: locate, resolve chain key, check attestation,
fetch proof, verify at the precompile.

**Why it exists:** it is the page that proves verification requires permission
from nobody. Nothing about a transaction has to involve Clearbook for Clearbook
to prove it happened.

`/verify` and `/clearance` are deliberately separate because they answer
different questions. `/verify` asks something about the world: did this happen?
`/clearance` asks something about the book: is it already spoken for? Only one of
them is a lending decision.

## `/docs` — Documentation

**27 pages** across eight sections: Introduction, Product, Protocol,
Verification, Architecture, Boundaries, Rationale, Reference. Includes the formal
covenant predicate, the invariants, the state machines, the threat model, the
coverage and clearance trust models, and a page listing exactly what the system
*cannot* establish.

Pages are structured data rather than MDX, so every internal link is validated
against the page registry at build time and a dead link fails the build. Search
runs entirely in the browser.

**Why it exists:** the product's argument is that its claims are checkable. Docs
that overstate or rot would undercut it.

---

# Part 4 — What is built

## Contracts — Creditcoin CC3 testnet

| Contract | Address | Role |
|---|---|---|
| `EvidenceVault` | `0x5b6048C74165237fF4A8A3cfe1d38E6fE7b547Af` | Verifies proofs, decodes receipts, stores facts. Permissionless |
| `Clearbook` | `0xCA02D51722947d7a93EDBe398498667bab368315` | Originators, bonds, claims, challenge, enforcement |
| `CovenantLib` | library | Conditions 3–9 as a pure predicate |
| Protocol sink | `0x…dEaD` | Burn address |

Precompiles consumed: Block Prover at `0x…0FD2`, ChainInfo at `0x…0fd3`. These
are constants of the chain, not configuration.

Solidity 0.8.28, `via_ir = true` (mandatory — the official decoder triggers
stack-too-deep otherwise, which also means `forge coverage` requires
`--ir-minimum`).

The vault's step order is load-bearing: **dedupe → verify → decode**. Re-submitting
a known fact returns early without re-verifying.

Two invariants worth naming because the product's argument rests on them:
`factConsumedBy` is a **single global mapping**, not one scoped per originator,
which is what makes a fact spent by one institution visibly unavailable to every
other. And `bindTreasury` reverts `AlreadyBound` with **no unbind path** — a
treasury declaration is permanent, so an originator cannot quietly drop an
address once its activity becomes inconvenient to measure.

## Off-chain worker

A daemon that watches the source chain and submits proofs. **Orchestration only** —
it has no privileged role and cannot make the vault believe anything. If it
submits a corrupted bundle the transaction reverts; if it disappears, anyone can
submit the identical bundle.

`DISCOVERED → WAITING_ATTESTATION → PROVED → SUBMITTED → CONFIRMED`, with
`PRECHECK_FAILED` and `FAILED` as terminal side-exits. Every transition is
persisted before the next begins, and rows stranded by a crash are re-queued at
startup.

Postgres holds the scan cursor and the state machine. It is **bookkeeping, never
truth** — the frontend reads the chain directly and has no dependency on it.

## Reference challenger

An autonomous watcher that reads the book, evaluates the covenant predicate over
available evidence, and challenges breaches without being told to. It has fired
unprompted against a live claim and settled it.

It is a **reference implementation, not an authority**. It holds no privileged
role, its address is disclosed in the interface so nobody mistakes its
challenges for protocol judgements, and everything it does any stranger could do
with the same public reads. Two structural rules govern it: it simulates before
it broadcasts, so a challenge that would revert is never sent, and it classifies
a funding leg by shape rather than asserting intent.

## Frontend

Next.js 16, wagmi, viem, Tailwind 4. **No backend and no database.** Every figure
is a chain read in the browser. The one server route is a CORS proxy to the proof
builder that holds no secrets and signs nothing. 38 routes build.

Warm paper, near-black ink, one structural accent in signal blue that is
deliberately *not* a protocol colour, so it can never be misread as verified,
breached or pending. Colour is reserved for protocol state: verified green,
breach red, pending amber. The signature motif is the **provenance rail** — a
hairline with square nodes, used wherever one thing causes the next.

Responsive down to 360px with no horizontal overflow on any route, verified by a
headless box-model audit rather than by eye.

---

# Part 5 — What has actually been proven

| Claim | Evidence |
|---|---|
| Real mainnet evidence works | 10,506.42 USDC transfer, block 25,811,720, verified and stored. All 7 fields cross-checked against Ethereum |
| Duplicate commitment is refused | Northgate attempted a fact Meridian had committed → `FactAlreadyUsed`, reverted on-chain |
| A covenant breach is enforceable | Bond −1.0 tCTC, challenger +0.5, sink +0.5, exposure released. Twice |
| An honest claim cannot be breached | Reverts `DisbursementNotFunding` — condition 11 |
| Forged proofs are rejected | Six mutations of a valid proof, six on-chain reverts |
| The worker survives a crash | Killed mid-flight at every state; no fact lost, no duplicate submission |
| Enforcement needs no human | The reference challenger detected and settled a breach unprompted, 15 blocks from claim to challenge |
| Coverage is a measurement | Recomputed by a second, independently written implementation (ethers vs viem); the two must agree exactly or gate 10 fails |
| Clearance derives the book's own identities | Local `factId` checked against `EvidenceVault.computeFactId` on the deployed contract, including the uint64 and uint32 ceilings |
| Clearance fails closed | Every unverifiable path asserted to return `unverifiable`, never `clear` |
| Nothing deployed on Ethereum | All evidence is canonical tokens we do not control |

**110 tests across 8 suites**, all passing: `Clearbook` (30), `EvidenceVault`
(19), `Security` (18), `CovenantSemantics` (15), `EvidenceVaultBatch` (13),
`Deploy` (6), `Invariants` (6), `EvidenceCommitment` (3).

Five invariants at 64 × 4,096 calls each, plus a permanent guard asserting the
fuzzer actually reaches `challenge()` — an earlier version passed every invariant
while never entering the interesting states. `invariant_I3_fact_backs_one_claim`
is the one Clearance surfaces.

Integration gates, each runnable and none permitted to skip on missing
configuration: `gate0` capabilities, `gate0:lag`, `gate1` evidence, `gate2`
proof, `gate4` decode, `gate7` forged proofs, `gate8a` worker crash, `gate9`
reference challenger, `gate10` coverage, `gate11` clearance.

Measured, not quoted: **~8–10 min** broadcast to usable evidence, **0.8s** for
`verify()`, **160k–224k gas** to submit a fact across 16 measured submissions,
**15.0s** Creditcoin block time
over a 500-block sample.

Coverage of `src/`, re-measured on this commit rather than carried forward:

| | Covered |
|---|---|
| Lines | **100.00%** (175/175) |
| Functions | **100.00%** (20/20) |
| Statements | 96.85% (246/254) |
| Branches | 85.71% (54/63) |

`EvidenceVault.sol` and `CovenantLib.sol` are at 100% on all four measures; the
uncovered branches are all in `Clearbook.sol` (32/41). Branch coverage is
published rather than omitted, because a project claiming its guarantees are
checkable does not get to hide the measure that is not 100%. Reproduce with
`forge coverage --ir-minimum` — plain `forge coverage` cannot compile this tree,
since disabling `viaIR` triggers stack-too-deep in the official decoder.

---

# Part 6 — What it cannot do

Stated here rather than buried. These are permanent properties, not a backlog.

- **Fact identity is not collateral identity.** This is the most important limit
  in the document. Clearbook prevents the same *proven fact* from being committed
  twice. It does **not** prevent two originators pledging the same real-world
  obligation through two *different* transactions. Clearance says so on its own
  face, because a check that implied otherwise would be worse than no check.
- **The covenant is bounded, not universal.** An originator funding a payer from
  an address it never binds does not breach it. Depth-1 by construction.
- **A legitimate second tranche is challengeable.** The covenant tests shape, not
  intent. Pinned in a test rather than papered over.
- **Absence is unprovable.** Merkle inclusion proofs cannot show something did
  *not* happen. Clearbook never certifies a book as clean; it makes specific
  claims refutable.
- **An address is not an entity.** A bound treasury is an address that produced a
  signature. Nothing more.
- **Coverage sees only bound treasuries.** An originator operating from an
  address it never declared is invisible to the denominator, and no ratio can
  reveal what was never in scope.
- **Clearance sees this book only.** An obligation pledged in a facility that
  does not record here is invisible to it, and always will be.
- **On-chain evidence says nothing about off-chain agreements.** A verified
  transfer is not a loan.
- **Ethereum only.** Mainnet and Sepolia are what the attestor set attests.
- **Front-running of challenges is unmitigated in v1.**
- **Testnet economics.** The protocol is deployed to CC3 testnet and bonds are
  testnet CTC. Evidence may originate from Ethereum mainnet, but nothing here
  custodies real value.

No Credal or other Creditcoin ecosystem integration exists. Credal is a
mainnet-only API with no public documentation, no developer portal and no
testnet, and none of that could be verified as reachable by a third party, so
nothing in this product claims a connection to it.

---

# Part 7 — Running it

```bash
npm install
cp .env.example .env          # fill in RPCs and throwaway keys

cd contracts && forge test    # 110 tests
cd frontend  && npm run dev   # http://localhost:3000

npm run gate2                 # prove a transaction, verify at the precompile
npm run gate7                 # mutate a valid proof six ways; all rejected
npm run gate8a                # worker crash safety
npm run gate9                 # the reference challenger, end to end
npm run gate10                # coverage, cross-checked by a second implementation
npm run gate11                # clearance identity and fail-closed behaviour
npm run demo:seed             # stage the demo book
npm run demo:status           # is the book presentable right now?
```

`npm run clearance:check` runs the same function the Clearance page runs, from a
terminal, so no demo opens on a transaction whose answer has not already been
seen. It needs `PROVER_ORIGIN` pointed at a running instance, because the proof
step goes through a browser-relative route that Node cannot address on its own.

**Seed 2–5 hours before demonstrating.** The challenge window is 1,200 Creditcoin
blocks (~5h): seed too early and it closes mid-presentation, too late and
attestation has no margin. `demo:status` will say plainly whether the book is
presentable, and degrades honestly when it is not — a closed window still leaves
two settled breaches on the book as standing evidence, and Coverage, Registry and
Clearance are unaffected by it because they read permanent state.

## Deployment

The frontend needs four environment variables: the two contract addresses,
`NEXT_PUBLIC_DEMO_MODE`, and `NEXT_PUBLIC_REFERENCE_CHALLENGER`. Everything else
has a working default in code.

One deployment note learned the hard way and recorded as `KNOWN_ISSUES` K-022:
**never define an environment variable with an empty value.** `??` falls back
only on null or undefined, so a blank platform variable is accepted as
configuration. A blank `PROOF_BUILDER_URL` silently disabled the proof proxy in
production and made `/verify` report the prover as unreachable while the prover
was healthy. The code now treats blank as absent everywhere it reads an endpoint,
but deleting such a variable is cleaner than setting it.
