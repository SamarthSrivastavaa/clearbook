# FINAL CORE SECURITY AUDIT

Conducted 30 August 2026 against the deployed core, reading source rather than
trusting any prior audit in this project.

---

## 1. Executive Verdict

**CORE SAFE TO FREEZE.**

No CRITICAL or HIGH finding. Four INFORMATIONAL/LOW items, none of which breaks a
stated guarantee. Every attack I mounted against evidence exclusivity, slashing
correctness, authorization and bond accounting failed against an explicit guard,
and in most cases against a guard *plus* a test that names the attack.

The single strongest reason for the verdict: **`SLASH_BPS = 10_000` makes the
slash exactly equal to `BOND_PER_LOAN`, and `exposure` reserves exactly
`BOND_PER_LOAN` per open loan** — so the amount at risk is arithmetically always
covered, and the withdraw path cannot outrun a challenge no matter how the
originator sets its own windows.

The largest residual risk is not a bug. It is an assumption about a precompile
whose source is not in this repository (§6.2).

---

## 2. Scope and Ground Truth

**Inspected directly, line by line:**

- `contracts/src/EvidenceVault.sol` (233 lines, complete)
- `contracts/src/Clearbook.sol` (383 lines, all state-mutating paths)
- `contracts/src/libraries/CovenantLib.sol` (83 lines, complete)
- `node_modules/@gluwa/usc-contracts/.../INativeQueryVerifier.sol` (92 lines, complete)
- `frontend/app/api/collide/route.ts`, `frontend/components/CommitGuard.tsx`
- Test declarations in `Security.t.sol`, `EvidenceVault.t.sol`, `EvidenceVaultBatch.t.sol`, `EvidenceCommitment.t.sol`

**Verified against live chain (CC3, 30 Aug):** `factConsumedBy` for the pinned
fact, originator 2 bond and ownership, `treasuryOwner` for the bound treasury,
loan 2 status, relayer balance, and a `registerLoan` simulation returning
`0x75606a00`.

**Inferred, not verified:** the internal behaviour of the Block Prover precompile
at `0x…0FD2`. It has no Solidity source available here. Every claim about what
`verifyAndEmit` validates is an inference from its interface and from the
`TransactionVerified(chainKey, height, transactionIndex)` event it emits. This is
stated as an assumption in §6.2 rather than presented as verified.

---

## 3. Core Guarantees Audited

| Guarantee | Enforcement Point | Attack Result | Status |
|---|---|---|---|
| A verified fact backs at most one claim | `Clearbook.sol:253`, `:289` — both paths check `factConsumedBy != 0` | No path writes zero; no `delete`; no clearing function exists | **IMPOSSIBLE** |
| Exclusivity holds across originators | `factConsumedBy` is `mapping(bytes32=>uint256)`, unscoped | Second originator hits the same guard; verified live | **IMPOSSIBLE** |
| `loanId 0` never issued, so `!= 0` is a sound sentinel | `nextLoanId = 1` (`:89`) | No path assigns 0 | **IMPOSSIBLE** |
| Caller cannot choose `txIndex` | `EvidenceVault.sol:68` / `:154` via precompile | Caller supplies a proof, not an index; a forged proof fails `verifyAndEmit` | **PREVENTED** (see §6.2) |
| Only the originator's owner may register/claim | `:250`, `:287`, `:222`, `:191` | No ownership transfer exists; no proxy path | **IMPOSSIBLE** |
| A fact can only be consumed by whoever controls its source address | `:262` `treasuryOwner[fact.from] != originatorId` | Binding needs an EIP-712 signature from that address | **IMPOSSIBLE** |
| One address binds to one originator, permanently | `:194` `AlreadyBound`, no unbind | Signature commits `originatorId`, so no cross-originator replay | **IMPOSSIBLE** |
| A breach cannot be slashed twice | `:343` status must be `REPAYMENT_CLAIMED` | Post-slash status is `BREACHED` | **IMPOSSIBLE** |
| Slash is always covered by bond | `SLASH_BPS=10_000`, `exposure += BOND_PER_LOAN` | Withdraw is bounded by `bond - exposure` | **IMPOSSIBLE** |
| Challenge and finalize cannot both apply | `:345` `<=` vs `:321` `>` | Mutually exclusive at every block | **IMPOSSIBLE** |
| Reverted source transactions never become facts | `EvidenceVault.sol:178` | Precompile does not check status; Clearbook does | **PREVENTED** |
| ERC-721 cannot be misread as ERC-20 | `:187` `topics.length != 3` | Fourth topic would be misread as amount | **PREVENTED** |

---

## 4. Confirmed Vulnerabilities

**No CRITICAL or HIGH findings.** Four lower-severity items follow.

### [C-01] `submitTransferFact` returns success for an unverified proof on the dedupe path

**Severity:** LOW (INFORMATIONAL for Clearbook itself; LOW for third-party integrators)
**Affected component:** `EvidenceVault.submitTransferFact`, lines 68–78
**Exact invariant broken:** None of Clearbook's. The affected property is
"a successful return implies the submitted proof was verified" — which the
contract never promises, but which an integrator could reasonably assume.

**Attack preconditions:** A fact already exists for some `(chainKey,
blockHeight, txIndex, logIndex)`.

**Step-by-step:**
1. `calculateTxIndex` is `view` and takes *only* the merkle proof. It performs no
   verification — it computes an index from sibling laterality. Any caller can
   construct a `MerkleProof` with arbitrary siblings and obtain an arbitrary index.
2. Attacker crafts siblings whose laterality yields the `txIndex` of an existing
   fact, and passes that fact's `chainKey`, `blockHeight`, `logIndex`.
3. `factId` matches an existing entry, so line 76 returns early.
4. **`verifyAndEmit` is never called.** The transaction succeeds.

**Expected result:** rejection, or at least no success signal.
**Actual result:** success, returning a valid `factId`.

**Impact:** No state change, no fact created or altered, no consumption affected.
The cost is gas and a misleading success signal. This matters only because
`EvidenceVault` is explicitly documented as application-agnostic so "any
Creditcoin dApp can consume it" — a future integrator calling
`submitTransferFact` and treating a non-reverting return as proof-of-validity
would be wrong. Clearbook itself is unaffected: it never calls this function, it
reads `VAULT.getFact()`.

**Why tests did not miss it:** They did not. `test_replay_is_noop` asserts
verbatim `"dedupe precedes verification"`. This ordering is deliberate and
documented at lines 48–50 as making the worker restart-safe. It is a design
choice, correctly tested.

**Smallest correct fix:** None to the code. Document in `IEvidenceVault` that a
successful return means "a fact with this identity exists", not "your proof was
verified". A code fix (verifying before the early return) would remove the
idempotency that makes the worker crash-safe and is not worth it.

**Files:** `contracts/src/interfaces/IEvidenceVault.sol` (natspec only).
**Regression tests:** none required.
**Deployment implications:** none. No redeploy.

### [C-02] `InactiveOriginator` is unreachable

**Severity:** INFORMATIONAL
**Affected component:** `Clearbook.sol:144`, `:192`, `:211`, `:251`

`active` is set `true` at registration (`:178`) and **no function ever sets it
false**. Three runtime checks and one error selector can never fire.

**Impact:** Dead code. No security consequence. Worth knowing because it means
there is no deactivation or emergency-stop path for a misbehaving originator —
which is consistent with the stated design ("there is no admin who could change
them, by design") but should not be mistaken for a dormant safety valve.

**Smallest correct fix:** none before freeze. Removing it would require a
redeploy for zero security gain.

### [C-03] An originator whose bond is exhausted can breach at no cost

**Severity:** INFORMATIONAL
**Affected component:** `Clearbook.sol:361` `if (slash > orig.bond) slash = orig.bond;`

If `orig.bond` has reached zero, `slash = 0`, `bounty = 0`, and a proven breach
transitions the loan to `BREACHED` with no economic consequence and no challenger
reward — removing the incentive to challenge it at all.

**Why this is bounded and not a real hole:** `registerLoan:255` requires
`orig.bond - orig.exposure >= BOND_PER_LOAN`, so an originator cannot open new
loans without free bond. Reaching zero bond requires having already been slashed
for every loan it opened. The clamp is also correct behaviour — you cannot take
what is not there.

**Smallest correct fix:** none. Any alternative (debt, negative balance)
introduces more risk than it removes.

### [C-04] `challengeWindow` has no upper bound

**Severity:** INFORMATIONAL
**Affected component:** `Clearbook.sol:165` — only `challengeWindow >= MIN_CHALLENGE_WINDOW` is checked.

An originator may set `challengeWindow = type(uint32).max`, making `finalize`
effectively unreachable and locking its own `exposure` permanently.

**Impact:** Self-harm only. It cannot be imposed on another party, and it
*increases* the setter's own exposure to challenge. No overflow: line 321 and
line 345 both widen to `uint256` before adding.

---

## 5. Exploit Attempts That Failed

These are the strongest attacks I mounted. Each failed against an explicit guard.

**Consume the same fact twice via the repayment path instead of disbursement.**
Fails: `:289` applies the identical `factConsumedBy != 0` check, so a fact
consumed as a disbursement cannot later be claimed as a repayment, and vice
versa. `test_duplicate_repayment_commitment_rejected` covers it.

**Free a consumed fact by breaching or settling the loan.** Fails: neither
`challenge` nor `finalize` touches `factConsumedBy`. There are zero `delete`
statements in the file and no function writes zero to that mapping.

**Grief a lender by front-running them to consume their evidence.** Fails:
`:262` requires `treasuryOwner[fact.from] == originatorId`, and binding that
address requires an EIP-712 signature *from that address*. An attacker can only
consume facts that left an address they cryptographically control.

**Bind a victim's treasury to my own originator to poison attribution.** Fails:
the signed struct is `TreasuryBinding(originatorId, ethAddress, nonce, chainId)`
— `originatorId` is inside the hash, so a signature produced for one originator
cannot be replayed for another. `AlreadyBound` makes it single-shot.

**Withdraw bond after claiming a repayment, before a challenger arrives.**
Fails, and this was the attack I expected to land. `withdrawBond:223` bounds the
withdrawal by `bond - exposure`, and `exposure` holds exactly `BOND_PER_LOAN` per
open loan while `SLASH_BPS = 10_000` makes the slash exactly `BOND_PER_LOAN`. The
encumbered amount always equals the amount at risk. `WITHDRAW_COOLDOWN` is
belt-and-braces, not the actual protection — which matters, because the cooldown
(1200) can be *shorter* than a self-chosen `challengeWindow`, and if exposure
were not doing the work this would be exploitable.

**Front-run a challenge with `finalize` to escape slashing.** Fails: `challenge`
requires `block.number <= claimBlock + challengeWindow`; `finalize` requires
`>`. There is no block at which both succeed, so there is no ordering game.

**Slash the same loan twice, or re-enter to double-pay the bounty.** Fails three
times over: the status guard at `:343`, the `nonReentrant` modifier, and strict
CEI ordering (all state written by `:367` before any `call`).
`test_double_slash` and `test_reentrancy_bounty` cover it.

**Steal or redirect a bounty.** Fails: the payee is `msg.sender`, not a
parameter. A payee that reverts reverts the whole challenge, harming only itself
and leaving the loan still challengeable — `test_payout_to_reverting_contract`.

**Extract value through rounding.** Fails: `slash = 1 ether`, `bounty = 0.5
ether`, `toSink = slash - bounty` absorbs any remainder by construction. No
division creates or destroys wei.

**Drive `exposure` above `bond` to brick registration or withdrawal.** Fails:
`challenge` decrements both by exactly `BOND_PER_LOAN`, preserving `bond >=
exposure`, and registration only increments when free bond suffices.

**Register sybil originators to poison the registry or bypass exclusivity.**
Fails to achieve anything: `factConsumedBy` is global, so an extra originator has
no additional consumption rights, and it still cannot consume evidence from an
address it has not signature-bound. Cost is 1 tCTC per sybil for zero capability.

**Falsely slash an honest originator with an unrelated funding fact.** Fails
against seven conjunctive conditions in `CovenantLib` — same chain, same token,
`funding.to == repayment.from`, funding from *this* originator's bound treasury,
`funding.amount >= repayment.amount`, `funding.blockHeight <= repayment.blockHeight`,
and within the published window. `test_unbound_funding_not_a_breach` and five
sibling tests cover the negative cases.

---

## 6. Assumptions That Remain

### 6.1 Protocol assumptions

**`bond >= exposure` is an emergent property, not an enforced one.** It holds
because of how three separate call sites happen to interact. There is no explicit
assertion of it anywhere in the contract. It is asserted by the invariant suite
(`invariant_I2_bond_covers_exposure`), which is the right place — but a future
change to `SLASH_BPS` above 10,000 would silently break it. *Consequence if
violated:* `withdrawBond:223` and `registerLoan:255` revert on underflow,
freezing the originator.

### 6.2 Attestcoin assumptions — the largest residual risk

**`verifyAndEmit` is assumed to bind `chainKey` and `blockHeight` to the proof,
not merely echo them.** Clearbook stores the *caller's* `chainKey` and
`blockHeight` into the fact identity (`EvidenceVault:74`, `:197-208`). If the
precompile validated the merkle and continuity proofs without checking that they
belong to the claimed chain and height, a caller could store one real event under
several identities by varying `chainKey`.

I could not verify this: the precompile has no source in this repository. The
inference that it *does* bind them is strong — a continuity proof is meaningless
unless checked against a specific chain's attested roots, and the precompile
emits `TransactionVerified(chainKey, height, transactionIndex)`, indicating it
knows all three. But it remains an inference.

*Consequence if violated:* the one-fact-one-claim guarantee degrades to
one-fact-per-chainKey-one-claim. This is the single assumption on which the
headline claim rests.

**`calculateTxIndex` is assumed to return the true index for any proof that
`verifyAndEmit` accepts.** It is a `view` function taking only the proof and
verifying nothing on its own; the binding comes entirely from passing the *same*
proof to `verifyAndEmit` in the same call. That pairing is correct in both the
single and batch paths.

### 6.3 Chain assumptions

Source-chain reorgs deeper than the attestation's finality are assumed
impossible. Clearbook stores facts permanently and never revisits them.
*Consequence:* a fact from a reorged block would remain committed forever.

### 6.4 Deployment assumptions

`PROTOCOL_SINK` is assumed to accept value. If it were ever set to a reverting
contract, `challenge:379-380` would revert and **all breaches would become
unchallengeable**. Currently `0x…dEaD`, which has no code and accepts transfers.
This is a constructor argument with no validation — the highest-consequence
deploy-time parameter in the system.

`VERIFIER` is injectable for test mocking; `Deploy.s.sol` asserts production uses
`0x…0FD2`. A deployment bypassing that script could point at an attacker-controlled
verifier and forge arbitrary facts. *This is the highest-severity
misconfiguration available* and is mitigated only by deploy discipline.

### 6.5 Operational and trusted-key assumptions

`ORIGINATOR_B_PRIVATE_KEY` sits in Vercel production environment. Its blast
radius is bounded to originator 2 (§8) and it cannot reach the consumed fact or
Layer 1's verdict, but it is a live key on a hosted platform.

---

## 7. Test Gap Analysis

The suite covers the attack classes well. Three classes are absent:

**Cross-`chainKey` identity substitution.** No test asserts that the same
underlying event cannot be stored twice under two different `chainKey` values.
`test_cross_chain_distinct_facts` asserts the *opposite* direction — that
different chains produce different facts, which is desired. The adversarial
version cannot be written honestly against a mock verifier, because the mock
decides whether to accept a mismatched chainKey, so the test would assert our own
mock's behaviour rather than the protocol's. **Should not be added before
freeze** — it would create false confidence about §6.2 rather than resolve it.

**Batch index-pairing confusion.** No test supplies a batch where
`merkleProofs[i]` corresponds to a different item than `heights[i]`. Reading the
loop at `:120-122`, all four arrays are indexed by the same `i`, so pairing is
structurally correct. **Optional**, low value.

**`bond >= exposure` after an adversarial slash sequence.** The invariant suite
covers this over random sequences, which is stronger than a unit test would be.
**Not needed.**

---

## 8. API and Relayer Audit

Route: `POST /api/collide`. Traced end to end.

**Can an arbitrary internet user spend relayer funds unexpectedly?** Only within
the intended action, and only gas. The route can construct exactly one
transaction — `registerLoan` with constants from `DEMO_ARTIFACTS.pinnedFact`.
Measured cost 0.000082 tCTC per send against ~0.999 tCTC, roughly 12,000 sends.

**Bypass rate limits?** Partially, yes. Limits are in-memory (`lastSeen`,
`hourCount`), so on multi-instance serverless they are per-instance, and the IP
is read from `x-forwarded-for`, which a client can attempt to spoof. **Worst case
is faster gas depletion on a throwaway testnet wallet**, after which the button
reports a relayer error and Layer 1 is unaffected. Accepted, and documented in
the route's own comments.

**Manipulate transaction parameters?** No. The route reads **no request body at
all**. Verified empirically on 28 Aug: a body naming `to: 0x…dEaD`, `value: 1e18`,
`data: 0xdeadbeef`, `originatorId: 99` produced an on-chain transaction to
Clearbook with value 0 and originator 2.

**Cause a transaction other than the intended collision?** No. Destination,
calldata, signer, value and gas are all module constants or server env.

**Exploit a simulation/execution state change?** This is the sharpest question,
and the design answers it. The route broadcasts **only** if `simulateContract`
currently reverts with `FactAlreadyUsed`. Were consumption state ever to change
between deploys, an unguarded send would *succeed* and permanently commit the
fact under originator 2 — the one action here capable of damaging the registry.
The preflight makes that unreachable rather than unlikely. A TOCTOU window
technically exists between simulation and broadcast; exploiting it would require
the pinned fact to become unconsumed, which has no code path.

**Learn secrets?** No. `ORIGINATOR_B_PRIVATE_KEY` is server-only, never prefixed
`NEXT_PUBLIC_`, never returned. Error strings are truncated to 200 characters and
first-line only.

**Cause denial of service?** Of the button, yes — by exhausting the hourly cap or
the wallet. Of the protocol or Layer 1, no.

---

## 9. Economic and Game-Theoretic Attack Surface

**Profitable griefing of an honest originator: possible by design, and disclosed.**
`CovenantLib` states it at lines 17–23: a second tranche or revolving draw to an
address that repays satisfies the funding leg exactly as a circular flow does. An
originator running a revolving facility can be slashed for behaviour that is not
misconduct. The originator's only control is `circularWindow`. This is the
published covenant, is tested (`test_same_block_breach`, boundary cases), and is
disclosed in the product. **Not a vulnerability; a real economic exposure that
must never be described as fraud detection.**

**Self-challenge:** covered by `test_self_challenge_is_loss_making` — an
originator challenging itself loses the sink's half.

**Reward farming:** impossible. Each loan can be slashed once, bounty is a fixed
fraction, and challenging requires a genuine breach.

---

## 10. Production Configuration Audit

Verified against production on 30 August:

| Item | Value | Status |
|---|---|---|
| `EvidenceVault` | `0x5b6048C7…47Af` | matches env |
| `Clearbook` | `0xCA02D517…8315` | matches env; confirmed as tx destination |
| `factConsumedBy(pinnedFact)` | `1` | permanent |
| Originator 2 bond | `2e18`, owner `0xCC37…4FD8` | matches relayer signer |
| Relayer balance | 0.9991 tCTC | ~12,000 sends |
| Loan 2 status | `5` = `BREACHED` | enforcement beat intact |

**One divergence worth naming:** rate limiting behaves differently locally
(single process) than on Vercel (potentially multiple instances). The audited
model is the weaker production one, and it is accepted.

---

## 11. False Confidence Audit

**"110 tests pass" does not prove the identity guarantee.** Every vault test runs
against `MockVerifier`. The mock decides what `calculateTxIndex` returns and
whether `verifyAndEmit` accepts. The tests prove *Clearbook's* logic given a
correct verifier; they cannot and do not prove the verifier is correct. §6.2 is
untouched by the test count.

**"We observed the refusal live" proves one path, once.** The live `eth_call`
confirms the guard fires for one pinned fact from one sender. Generality comes
from reading the code — `factConsumedBy` is unscoped and checked before any
originator-specific state — not from the observation.

**The invariant suite is the strongest evidence here, and it is still bounded.**
`invariant_I3_fact_backs_one_claim` runs 64 × 4096 calls over handler-generated
sequences. That is far better than unit tests, and it is still only the state
space the handler can reach. The anti-vacuity test guarding it is the right
mitigation and is present.

**`treasuryOwner` reads at challenge time, not at registration time.** A binding
added after a loan is registered makes that loan retroactively challengeable.
This is not exploitable by a third party — binding is owner-gated — but anyone
reasoning "the covenant was fixed when the loan was made" is wrong.

---

## 12. Required Fixes Before Freeze

**MUST FIX:** none.

**SHOULD FIX:** none before freeze. [C-01] warrants a natspec sentence in
`IEvidenceVault` clarifying that a successful `submitTransferFact` return means
"a fact with this identity exists", not "your proof verified". Documentation only,
no redeploy, and it is only material if a third party integrates the vault.

**OPTIONAL HARDENING (post-hackathon, requires redeploy — do not do now):**
validate `protocolSink != address(0)` and that it accepts value in the
constructor; add an explicit `bond >= exposure` assertion; remove the unreachable
`active` checks.

**DO NOT TOUCH:** the dedupe-before-verify ordering (it is what makes the worker
restart-safe), `SLASH_BPS`, `BOND_PER_LOAN`, the exposure accounting, the
challenge/finalize boundary conditions, and the preflight gate in the relayer.

---

## 13. Final Attack Verdict

**1. Can the same verified event be committed twice?**
**NO.** Both consumption sites (`:253` disbursement, `:289` repayment) check
`factConsumedBy != 0` before any state write, `nextLoanId` starts at 1 so the
sentinel is sound, and no code path writes zero or deletes an entry. Tested by
`test_cross_originator_duplicate_commitment_rejected`,
`test_duplicate_repayment_commitment_rejected`, and the stateful invariant
`invariant_I3_fact_backs_one_claim`. Confirmed live against the deployment.

**2. Can one verified event be represented as two different fact identities?**
**CONDITIONAL.** Not within a single `chainKey`: identity is deterministic over
`(chainKey, blockHeight, txIndex, logIndex)` and `txIndex` comes from the proof.
Across `chainKey` values it depends entirely on the precompile binding `chainKey`
to the attestation set — §6.2. I could not verify this from available source.

**3. Can a caller influence a supposedly canonical identity?**
**CONDITIONAL, and narrower than previously claimed in this project.** `txIndex`
cannot be supplied — but `calculateTxIndex` is a `view` function over the proof
that verifies nothing by itself, so a caller *can* obtain any index they like
from a crafted proof. What stops abuse is that the same proof must then satisfy
`verifyAndEmit`. `chainKey`, `blockHeight` and `logIndex` are all caller-supplied
and are constrained by verification and by receipt bounds respectively, not by
derivation. The accurate statement is: **the identity is a closed set, no
component of which can be freely asserted** — not "the proof derives the identity".

**4. Can one originator bypass another's prior consumption?**
**NO.** The mapping is global and unscoped, checked before any originator-specific
state. Verified live: a `registerLoan` simulation as originator 2's owner against
originator 1's fact returns `0x75606a00` = `FactAlreadyUsed`.

**5. Can an unauthorized party mutate protected registry state?**
**NO.** Every mutating path is either owner-gated (`:191`, `:222`, `:250`, `:287`),
permissionless but state-machine-constrained (`markDelinquent`, `finalize`), or
permissionless and self-verifying (`challenge`, `submitTransferFact`). There is no
admin, no upgrade path, no ownership transfer, and no pause.

**6. Can a false breach slash an honest originator?**
**CONDITIONAL — by published design, not by defect.** Seven conjunctive
conditions must hold, including that the funding leg came from a treasury *this
originator itself bound by signature*. Within those conditions, a legitimate
second tranche is indistinguishable from circular funding and **will** slash. This
is documented in `CovenantLib` lines 17–23 and disclosed in the product. It must
never be presented as fraud detection.

**7. Can a real breach escape slashing through a loophole?**
**NO, with one bounded exception.** Withdrawal cannot outrun it (exposure covers
the slash exactly); finalize cannot pre-empt it (mutually exclusive windows). The
exception is [C-03]: an originator whose bond already reached zero breaches for
free — bounded, since it cannot open new loans without free bond.

**8. Can a challenger steal or duplicate rewards?**
**NO.** Payee is `msg.sender`, not a parameter. Double-slash is blocked by the
status guard, by `nonReentrant`, and by CEI ordering independently.

**9. Can the relayer be abused to lose funds beyond intended demo behaviour?**
**NO, beyond gas.** No request input reaches the signed transaction — verified
empirically on-chain. Rate limits are best-effort on multi-instance hosting, so
an attacker can accelerate gas depletion of a throwaway testnet wallet. The key's
blast radius is originator 2's own bond and treasury binding; it cannot reach the
consumed fact, the incumbent claim, the vault, or Layer 1's verdict.

**10. What is the single most dangerous remaining assumption?**
That `verifyAndEmit` **binds** `chainKey` and `blockHeight` to the proof rather
than echoing them (§6.2). Every other guarantee in this system is enforced by
code I have read. This one is enforced by a precompile I cannot read, and the
headline claim depends on it.

---

## 14. Final Freeze Decision

**A — FREEZE. No material core weakness found.**

Actions required: **none to contract or product code.**

The only thing I would change is a sentence of documentation ([C-01]), and it is
optional. No redeploy, no migration, no new tests before freeze.

One instruction for what gets *said* rather than built: when asked how the
identity guarantee works, use the closed-set formulation — `txIndex` recovered
from the proof and unsuppliable, `chainKey` and `blockHeight` rejected on
mismatch, `logIndex` bounded to a real transfer in the verified receipt. Do not
say the proof "derives" or "decides" the identity. §13.3 is why: it is a closed
set, which is a precise and defensible claim, and it is not the same claim.
