# Clearbook — what it is and what is built

Written 23 August 2026. Every figure here was read from the running system or
from the repository, not recalled.

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

There is a second problem. Each lender only sees its own copy of the paperwork.
If the same asset or the same payment is shown to two different lenders as
backing for two different loans, neither lender can tell, because neither can
see the other's records.

## What Clearbook does about it

Clearbook is a **shared noticeboard of verified payments** that several lending
funds use at once.

Three things make it different from a spreadsheet:

**1. The payments are checked, not claimed.**
When a fund says "this payment happened", Clearbook does not take its word.
It goes and proves the payment really occurred on a public blockchain — using
cryptography, not a database lookup. The fund cannot fake it, and neither can we.

**2. A payment can only be used once.**
Once a fund points at a payment and says "this is the disbursement for loan 4",
that payment is **spent**. No other fund can point at the same payment for a
different loan. The system physically refuses. Not by policy — the transaction
fails.

**3. The rules are published in advance, and anyone can enforce them.**
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
> be committed to multiple claims, and are governed by immutable covenants that
> anyone may challenge and enforce.

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

## Why each piece is where it is

**Why a blockchain at all.** Money is slashed on these facts. A database can
enforce uniqueness perfectly well — but its operator can drop the constraint,
edit the row, or restore a different backup, and no participant can detect it
from outside. The point is not that databases cannot do uniqueness; it is that
**the consumption and enforcement state is not controlled by any single
operator**, including us.

**Why Creditcoin specifically.** Clearbook needs a chain where a contract can
verify *another* chain's history natively. That is what the Block Prover and
ChainInfo precompiles provide. Everything else — shared state, deterministic
execution, economic finality — is available elsewhere; this is not.

**Why Attestcoin is load-bearing.** The official design-pattern documentation
describes a *cooperative* source chain: you deploy your own contract, it emits an
event you designed, your worker watches for it. Clearbook does the opposite — it
reads ordinary third-party ERC-20 `Transfer` logs. That is deliberate, because
for covenant enforcement the cooperative regime is useless: **you cannot ask a
fund that is cycling its own money to emit a `CircularRepaymentOccurred` event.**

Working from uninstrumented evidence is the harder problem. Four mechanisms make
it safe:

| Mechanism | Why it is needed |
|---|---|
| Log-level identity `keccak256(chainKey, blockHeight, txIndex, logIndex)` | One transaction routinely carries many relevant transfers — 17 and 30 observed in real ones |
| Transaction-local `logIndex` | `eth_getLogs` returns a block-global index; using it computes identity over the wrong value |
| `receiptStatus == 1` asserted by us | The precompile proves *inclusion*, not *success*. A reverted transfer moved no value |
| EIP-712 treasury binding | An address only counts as an originator's if that originator proved control of the key |

## The covenant, formally

`CIRCULAR_REPAYMENT` — the one covenant implemented. A challenge succeeds if and
only if **all eleven** conjuncts hold:

```
  1.  status(L) = REPAYMENT_CLAIMED                 WrongStatus
  2.  block.number ≤ claimBlock(L) + W_ch           WindowClosed
  3.  K(f_f) = K(f_r)                               ChainMismatch
  4.  T(f_f) = T(f_r)                               TokenMismatch
  5.  R(f_f) = S(f_r)                               NotTheSamePayer
  6.  bound(S(f_f)) = id(O)                         FundingNotFromBoundTreasury
  7.  A(f_f) ≥ A(f_r)                               FundingBelowRepayment
  8.  H(f_f) ≤ H(f_r)                               FundingNotBefore
  9.  H(f_r) − H(f_f) ≤ W_c                         OutsideWindow
 10.  id(f_f) ≠ id(f_r)                             SameFact
 11.  id(f_f) ≠ id(f_d)                             DisbursementNotFunding
```

Where `f_f` is the cited funding leg, `f_r` the repayment, `f_d` the
disbursement, `W_c` the published circular window and `W_ch` the challenge
window. Each failure reverts with its own named error, so a rejected challenge
says *which* condition refused it.

**Soundness and completeness.** The predicate is sound with respect to its own
statement. It is *not* complete with respect to circular financing in general:
it quantifies over exactly two facts, so a flow routed through an address the
originator never bound satisfies no conjunct set. Depth-1 by construction.

## The economics

```
slash  = BOND_PER_LOAN × SLASH_BPS  / 10000  =  1.0 tCTC
bounty = slash         × BOUNTY_BPS / 10000  =  0.5 tCTC
toSink = slash − bounty                      =  0.5 tCTC
```

The bounty is deliberately **less** than the slash. If they were equal, an
originator could challenge its own breaching claim and recover the full bond,
making the covenant costless to break. The burned difference is what makes
self-challenge strictly loss-making.

A challenger posts **no bond**. Spam is already priced: an invalid challenge
reverts, changes no state, and costs only the sender's gas.

---

# Part 3 — Every page, and why it exists

The application has **six user-facing surfaces**. None was added to make the
product look larger.

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

Opens with a sentence derived entirely from chain reads — *"One covenant has been
proven breached and the bond slashed. Two claims are open to challenge for
another 4.4h."* Then each originator's position: bond posted, exposure, free
bond, published windows. Then the claims, with anything breached or challengeable
lifted to the top and marked with a status rule.

Currently shows **2 originators** — Meridian Credit Partners (9 tCTC bonded) and
Northgate Structured Credit (2 tCTC) — and **4 claims**.

**Why it exists:** this is the object the whole product is about. A loan book
that can be checked.

## `/registry` — Evidence registry

**Job:** show which verified facts exist and which claim, if any, has consumed
each one.

Deliberately not an explorer. An explorer answers *"what happened on a chain"*;
this answers *"what can still be committed to a credit claim, and what cannot."*
Consumption is read from `Clearbook.factConsumedBy` on-chain, never inferred.

Currently holds **11 verified facts**, of which **1 is from Ethereum mainnet** —
a real 10,506.42 USDC transfer between two strangers, block 25,811,720. It is
verified and permanently **uncommittable**, because committing needs a treasury
bound by signature and nobody here holds a key for either address.

Opening a fact shows its provenance rail — Ethereum → Attestcoin → precompile →
Clearbook — and, for committed facts, runs a **live `eth_call`** asking the
deployed contract whether another originator could commit it. The contract
answers `FactAlreadyUsed`. That refusal is observed, not asserted.

**Why it exists:** the registry is the state everything else rests on, and it is
where the verification/commitment asymmetry becomes visible on a real record.

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

## `/docs` — Documentation

**24 pages** across eight sections: Introduction, Product, Protocol,
Verification, Architecture, Boundaries, Rationale, Reference. Includes the formal
covenant predicate, the invariants, the state machines, the threat model, and a
page listing exactly what the system *cannot* establish.

Every internal link is validated at build time — a dead link fails the build.
Search runs entirely in the browser.

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

Solidity 0.8.28, `via_ir = true` (mandatory — the official decoder triggers
stack-too-deep otherwise).

The vault's step order is load-bearing: **dedupe → verify → decode**. Re-submitting
a known fact returns early without re-verifying.

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

## Frontend

Next.js 16, wagmi, viem, Tailwind 4. **No backend and no database.** Every figure
is a chain read in the browser. The one server route is a CORS proxy to the proof
builder that holds no secrets and signs nothing.

Warm paper, near-black ink, one structural accent. Colour is reserved for
protocol state: verified green, breach red, pending amber. The signature motif is
the **provenance rail** — a hairline with square nodes, used wherever one thing
causes the next.

---

# Part 5 — What has actually been proven

| Claim | Evidence |
|---|---|
| Real mainnet evidence works | 10,506.42 USDC transfer, block 25,811,720, verified and stored. All 7 fields cross-checked against Ethereum |
| Duplicate commitment is refused | Northgate attempted a fact Meridian had committed → `FactAlreadyUsed`, reverted on-chain |
| A covenant breach is enforceable | Bond −1.0 tCTC, challenger +0.5, sink +0.5, exposure released |
| An honest claim cannot be breached | Reverts `DisbursementNotFunding` — condition 11 |
| Forged proofs are rejected | Six mutations of a valid proof, six on-chain reverts |
| The worker survives a crash | Killed mid-flight at every state; no fact lost, no duplicate submission |
| Nothing deployed on Ethereum | All evidence is canonical tokens we do not control |

**95 tests**, 7 suites, 100% line coverage of `src/`; branch coverage 75.61%,
published rather than omitted. Five invariants at 64 × 4,096 calls each, plus a
permanent guard asserting the fuzzer actually reaches `challenge()` — an earlier
version passed every invariant while never entering the interesting states.

Measured, not quoted: **~8–10 min** broadcast to usable evidence, **0.8s** for
`verify()`, **~226,000 gas** to submit a fact.

---

# Part 6 — What it cannot do

Stated here rather than buried.

- **The covenant is bounded, not universal.** An originator funding a payer from
  an address it never binds does not breach it. Depth-1 by construction.
- **Absence is unprovable.** Merkle inclusion proofs cannot show something did
  *not* happen. Clearbook never certifies a book as clean.
- **An address is not an entity.** A bound treasury is an address that produced a
  signature. Nothing more.
- **Collateral identity is not established.** The same obligation represented by a
  *different* transaction is not detected. The primitive is duplicate commitment
  of **verified evidence**, not of collateral.
- **Ethereum only.** Mainnet and Sepolia are what the attestor set attests.
- **Testnet.** The protocol is deployed to CC3 testnet. Evidence may originate
  from Ethereum mainnet, but nothing here custodies real value.

---

# Part 7 — Running it

```bash
npm install
cp .env.example .env          # fill in RPCs and throwaway keys

cd contracts && forge test    # 95 tests
cd frontend  && npm run dev   # http://localhost:3000

npm run gate2                 # prove a transaction, verify at the precompile
npm run gate7                 # mutate a valid proof six ways; all rejected
npm run gate8a                # worker crash safety
npm run demo:seed             # stage the demo book
```

**Seed 2–5 hours before demonstrating.** The challenge window is 1,200 Creditcoin
blocks (~5h): seed too early and it closes mid-presentation, too late and
attestation has no margin.
