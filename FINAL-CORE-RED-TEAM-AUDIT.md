# FINAL CORE RED-TEAM AUDIT

30 August 2026. Adversarial re-audit of the core, treating the previous audit as
a hypothesis to falsify rather than a baseline to extend.

---

## 1. Executive Verdict

**CORE GUARANTEE NOT FULLY PROVEN.**

This is not a request for a code change. No fix is required and none is
recommended. It is a statement about what the available evidence can and cannot
establish.

- **Clearbook's own Solidity is sound.** Every attack I mounted against
  consumption, authorization, slashing, bond accounting and the challenge
  lifecycle was stopped by an explicit guard, usually with a test that names the
  attack. No Critical, High or Medium finding.
- **The headline guarantee terminates in an unproven dependency.** "A verified
  event can be committed at most once" is enforced by Clearbook code *given* that
  fact identity is canonical. Canonicality depends entirely on precompile
  behaviour I could not verify from any available source.
- **I attempted four independent routes** to resolve it — the official writability
  and readability documentation, the SDK documentation page, the vendored
  `@gluwa/usc-sdk` TypeScript and Rust source, and the shipped ABI. None
  documents what `verifyAndEmit` validates. The SDK's own
  `computeTransactionIndex` simply forwards to the precompile; there is no
  client-side algorithm to inspect.
- **A prior conclusion is falsified.** `MockVerifier.calculateTxIndex` takes an
  **unnamed parameter** and returns a preset value — it ignores the proof
  entirely. Every test touching txIndex therefore proves forwarding, not
  derivation. Section 9.
- **One invariant holds only by constant alignment.** `bond >= exposure` is
  preserved because `SLASH_BPS <= 10_000`, not because any line of code enforces
  it. Section 6.
- **Ship as-is.** The correct response is claim discipline, not defensive
  complexity. Section 10.

---

## 2. Attack Surface Map

Ranked by actual danger given what is provable.

1. **Attestcoin / precompile boundary** — the only place a core guarantee can
   fail without a Clearbook bug. Entirely unverifiable from this repository.
2. **Identity construction** — sound *conditional* on (1). `abi.encode` over four
   fixed-width types; no packing ambiguity, no aliasing.
3. **Economic model** — safe today, but by constant alignment rather than
   enforcement.
4. **Challenge lifecycle** — boundary conditions are exact and mutually
   exclusive. Front-running of the bounty is possible and disclosed.
5. **Signature ownership** — EIP-712 with `originatorId`, per-address nonce and
   `chainId` in the struct. No replay path found.
6. **Clearbook internal logic** — no finding.
7. **External chain finality** — assumed, not enforced. Facts are permanent.
8. **Relayer boundary** — cannot reach any core guarantee. Verified on-chain.
9. **Proof encoding** — depends on (1).

---

## 3. Findings

### [R-01] Test suite cannot prove txIndex derivation, because the mock ignores the proof

**Severity:** UNKNOWN DEPENDENCY (evidentiary, not exploitable)
**Guarantee affected:** "The caller cannot choose the evidence's identity."
**Attacker:** n/a — this is a gap in evidence, not an exploit.

**Evidence, exact:**

```solidity
function calculateTxIndex(MerkleProof calldata) external view returns (uint64) {
    return txIndexResult;
}
```

The parameter is unnamed and unused. `verifyAndEmit` in the same mock increments
a counter and returns a preset boolean without inspecting `chainKey` or `height`.

**Why previous auditing missed it:** the previous audit read the interface and
reasoned correctly that `calculateTxIndex` verifies nothing alone, but then
counted the 110 passing tests as partial reassurance. They are not. Every vault
test runs against this mock, so they establish Clearbook's control flow given a
correct verifier and say nothing about the verifier.

**Real impact:** none on-chain. The impact is on what may honestly be claimed.

**Minimal fix:** none available. A test asserting the precompile binds `chainKey`
cannot be written against a mock we control — it would assert our own mock's
behaviour and manufacture false confidence. **Must fix before freeze: NO.**

### [R-02] `bond >= exposure` holds only because `SLASH_BPS <= 10_000`

**Severity:** Informational (Medium if the constant were ever changed)
**Guarantee affected:** "Maximum slash liability never exceeds reserved exposure."
**Attacker:** a future maintainer, not an external party.

**Exploit path if the coupling broke:** with `SLASH_BPS > 10_000`, `challenge`
decrements `orig.bond` by more than it decrements `orig.exposure` (which is
always exactly `BOND_PER_LOAN`, line 367). After enough slashes `exposure > bond`.
Every subsequent `registerLoan` (line 255) and `withdrawBond` (line 223) computes
`orig.bond - orig.exposure`, underflows, and reverts — permanently bricking that
originator. Not fund loss; permanent denial.

**Why it is not exploitable today:** `SLASH_BPS = 10_000` is a `constant`,
changeable only by editing source and redeploying.

**Minimal fix:** none before freeze. A compile-time assertion would be correct
engineering and requires a redeploy for zero present benefit. **Must fix before
freeze: NO.** Document as an invariant (§6).

### [R-03] Challenge bounty is front-runnable

**Severity:** Low
**Guarantee affected:** none. Enforcement still occurs; only the payee changes.
**Attacker:** a searcher observing the mempool.

A pending `challenge(loanId, fundingFactId)` is public and copyable. A searcher
can replay it with higher gas and take the 0.5 tCTC bounty. The honest challenger
loses gas; the originator is slashed identically; protocol state is unaffected.

**Why previous auditing caught it:** it did — disclosed in `07-JUDGE-QA.md` as
"unmitigated in v1", with commit-reveal named as the fix. Recorded here for
completeness. **Must fix before freeze: NO.**

### [R-04] A malicious ERC-20 can permanently lock an originator's own exposure

**Severity:** Informational
**Attacker:** an originator against itself; not reachable by a third party.

A token contract can emit `Transfer` with `amount = 2**256 - 1`. If an originator
binds that treasury and registers a loan against it, `principal` is that value,
and `claimRepayment` line 295 computes `loan.principal * REPAYMENT_BPS`, which
overflows and reverts. The loan can never be repaid, and its `BOND_PER_LOAN`
exposure is locked until challenge or maturity handling.

**Why it is not a real attack:** every step requires the originator's own
signature-bound treasury and its own `registerLoan` call. It cannot be imposed on
another party. **Must fix before freeze: NO.**

---

## 4. Fact Identity: Full Proof Chain

The most important section. Each arrow is labelled with what actually establishes it.

```
real Ethereum event
  │  ASSUMED FROM PROTOCOL — attestor set observed and attested the source block
  ▼
merkle + continuity proof (built off-chain by the prover service)
  │  UNKNOWN — no available source defines what makes a proof valid
  ▼
VERIFIER.calculateTxIndex(merkleProof)  →  txIndex
  │  PROVEN BY CLEARBOOK CODE that the value is not a caller parameter
  │  UNKNOWN that it is the true index of the proven transaction
  ▼
VERIFIER.verifyAndEmit(chainKey, blockHeight, encodedTx, sameProof, continuity)
  │  PROVEN BY CLEARBOOK CODE that the SAME merkleProof object is passed
  │  UNKNOWN whether chainKey and blockHeight are cryptographically bound
  ▼
computeFactId = keccak256(abi.encode(chainKey, blockHeight, txIndex, logIndex))
  │  CRYPTOGRAPHICALLY PROVEN — abi.encode over four fixed-width types;
  │  no packing ambiguity, injective, collision-resistant
  ▼
_decodeAndStore → receiptStatus == 1, logIndex bounds, ERC-20 shape
  │  PROVEN BY CLEARBOOK CODE (EvidenceVault.sol:178, :181, :187, :188)
  ▼
factConsumedBy[factId] — consumed exactly once, globally
     PROVEN BY CLEARBOOK CODE (Clearbook.sol:253, :278, :289, :301;
     zero delete statements; nextLoanId = 1 sentinel)
```

**Where does caller-independent canonical identity become mathematically
established?**

**It does not, from sources available in this repository.**

The chain is sound from `computeFactId` downward — that half is cryptography and
Clearbook code I have read. Upward of it, canonicality rests on a single
proposition: *a merkle proof that `verifyAndEmit` accepts for `(chainKey,
blockHeight, encodedTransaction)` uniquely determines the transaction's position,
and the same proof was used to derive `txIndex`.*

Clearbook proves the second clause — the identical `MerkleProof` struct is passed
to both calls, in both the single path (lines 68 and 81) and the batch path
(line 154 within `_ingestOne`, after line 115 verified the set).

The first clause is **UNKNOWN**. The precompile at `0x…0FD2` has no Solidity or
Rust implementation in this repository, and I checked four independent sources
for its semantics without success.

**The honest formulation** is therefore: *the identity is a closed set, no
component of which the caller can freely assert* — `txIndex` is not a parameter
at all, `chainKey` and `blockHeight` are passed to a verifier that is believed to
reject mismatches, and `logIndex` must address a real ERC-20 transfer in the
decoded receipt. "The proof derives the identity" and "the identity is
caller-independent" both overstate what is provable.

---

## 5. Duplicate-Consumption Attack Matrix

| Attack | Result | Exact reason |
|---|---|---|
| Same fact via `registerLoan` twice | **BLOCKED** | `:253` checks `factConsumedBy != 0`; `:278` writes it |
| Same fact via `claimRepayment` twice | **BLOCKED** | `:289` same check; `:301` writes |
| Same fact as disbursement *and* repayment | **BLOCKED** | Both paths read one global mapping |
| Free a fact by breaching the loan | **BLOCKED** | `challenge` never touches `factConsumedBy`; zero `delete` in file |
| Free a fact by settling the loan | **BLOCKED** | `finalize` likewise |
| Second originator commits the same fact | **BLOCKED** | Mapping is unscoped; verified live, returns `0x75606a00` |
| Sybil originators to gain consumption rights | **BLOCKED** | Global mapping; also `:262` requires a signature-bound source address |
| Front-run a lender to consume their evidence | **BLOCKED** | `:262` `treasuryOwner[fact.from] != originatorId`; binding needs an EIP-712 signature from that address |
| Re-claim a better repayment fact | **BLOCKED** | `:288` requires `REGISTERED`/`DELINQUENT`; no path returns to either |
| Two identical Transfer logs in one tx → two facts | **POSSIBLE, AND CORRECT** | They are two distinct transfers. Documented at `EvidenceVault.sol:70-73` |
| Vary `logIndex` to alias one event | **BLOCKED** | A different `logIndex` addresses a different log; `:181` bounds it to the verified receipt |
| Encoding ambiguity in `computeFactId` | **BLOCKED** | `abi.encode`, not `encodePacked`; all four types fixed-width |
| Batch path pairing confusion | **BLOCKED** | All four arrays indexed by the same `i` at `:120-122` |
| Dedupe early-return to store a forged fact | **BLOCKED** | The early return at `:76` stores nothing and mutates nothing |
| **Vary `chainKey` for one real event** | **UNKNOWN** | Depends entirely on whether `verifyAndEmit` binds it |
| **Vary `blockHeight` for one real event** | **UNKNOWN** | Same |
| **Two distinct valid proofs of one tx yielding different `txIndex`** | **UNKNOWN** | Depends on whether the merkle tree admits more than one valid path per leaf |

The three UNKNOWNs are one question wearing three hats.

---

## 6. Economic Invariants

Exact relationships as implemented:

```
slash   = min(BOND_PER_LOAN * SLASH_BPS / 10_000, orig.bond)
bounty  = slash * BOUNTY_BPS / 10_000
toSink  = slash - bounty
reserved per open loan = BOND_PER_LOAN                      (exposure)
withdrawable            = orig.bond - orig.exposure
registerLoan requires   orig.bond - orig.exposure >= BOND_PER_LOAN
```

With the shipped constants — `BOND_PER_LOAN = 1 ether`, `SLASH_BPS = 10_000`,
`BOUNTY_BPS = 5_000` — slash is exactly 1 ether, bounty exactly 0.5, sink exactly
0.5. Division is exact; `toSink` absorbs any remainder by construction, so no wei
is created or destroyed.

**Constant coupling, stated prominently:**

1. **`SLASH_BPS <= 10_000` is load-bearing.** It is what makes maximum slash
   liability never exceed reserved exposure, and therefore what preserves
   `bond >= exposure`. Nothing in the contract enforces it. Raising it above
   10,000 silently breaks the invariant and bricks originators via underflow.
2. **`BOUNTY_BPS <= 10_000` is load-bearing** for `toSink = slash - bounty` not
   to underflow.
3. **`WITHDRAW_COOLDOWN` is *not* load-bearing**, contrary to the comment at
   line 218-219 which describes it as "what stops an originator from claiming a
   repayment and pulling its bond out". It is not. `challengeWindow` is
   originator-chosen with no upper bound and can exceed the 1200-block cooldown.
   The actual protection is `exposure`, which reserves exactly the slashable
   amount for as long as the loan is open. The cooldown is defence in depth.

**Recommendation:** document (1) and (2) as invariants; correct the comment at
line 218 at the next redeploy. Do not add runtime assertions — they cost gas to
defend against a value that cannot change without a redeploy.

---

## 7. Mock vs Reality

| Guarantee | Evidence type | What is actually proven | Remaining assumption |
|---|---|---|---|
| A fact backs at most one claim | **STATIC REASONING + MOCKED + invariant fuzzing** | Clearbook's control flow is correct over reachable states | That distinct events map to distinct `factId`s |
| Exclusivity across originators | **DIRECT REAL-PROTOCOL** | Live `eth_call` on the deployed contract returns `FactAlreadyUsed` | None for the tested fact; generality is static reasoning |
| Caller cannot choose `txIndex` | **MOCKED — and the mock ignores the proof** | Only that Clearbook does not accept it as a parameter | Everything about the actual derivation |
| `chainKey` / `blockHeight` bound to the proof | **ASSUMPTION** | Nothing | The entire proposition |
| Reverted source tx never becomes a fact | **PROVEN BY CLEARBOOK CODE + MOCKED** | `:178` reads `receiptStatus` from the decoder | That the decoder reads the verified bytes faithfully |
| ERC-721 cannot be misread as ERC-20 | **PROVEN BY CLEARBOOK CODE** | `:187` requires exactly three topics | None |
| Slash never exceeds reserved exposure | **STATIC REASONING + invariant fuzzing** | Holds for shipped constants | `SLASH_BPS <= 10_000` |
| Challenge and finalize cannot overlap | **PROVEN BY CLEARBOOK CODE** | `<=` at `:345` versus `>` at `:321` | None |
| Treasury cannot be impersonated | **PROVEN BY CLEARBOOK CODE** | EIP-712 struct binds `originatorId`, nonce, `chainId` | ECDSA soundness |
| Relayer cannot alter the transaction | **DIRECT REAL-PROTOCOL** | Hostile body produced the pinned tx on-chain | None |

**The blunt version:** the 110 tests prove Clearbook is correct *given* a correct
verifier. The residual risk lives entirely in the clause after "given", and no
number of additional tests against `MockVerifier` can reduce it.

---

## 8. Final Fix List

**MUST FIX:** none.

**SHOULD FIX:** none before freeze.

**DOCUMENT AS ASSUMPTION:**
- `SLASH_BPS <= 10_000` and `BOUNTY_BPS <= 10_000` as load-bearing constants (§6).
- The precompile binding of `chainKey` and `blockHeight` as an unproven dependency (§4).
- That `WITHDRAW_COOLDOWN` is not the protection its comment claims (§6.3).

**DO NOT TOUCH:**
- The dedupe-before-verify ordering — it is what makes the worker restart-safe,
  it stores nothing, and `test_replay_is_noop` pins it deliberately.
- `exposure` accounting, the challenge/finalize boundaries, the relayer preflight
  gate, `nonReentrant` plus CEI in `challenge` and `withdrawBond`.
- Any attempt to test the precompile's semantics against `MockVerifier`. It would
  manufacture exactly the false confidence this audit exists to remove.

---

## 9. The One Thing We Were Most Wrong About

**`MockVerifier.calculateTxIndex` ignores its argument.**

```solidity
function calculateTxIndex(MerkleProof calldata) external view returns (uint64) {
    return txIndexResult;
}
```

Earlier work in this project — including my own audit yesterday — treated the
passing test suite as partial evidence that the identity is caller-independent.
It is not evidence of that at all. The mock returns a value the test itself set,
so `test_calculateTxIndex_passthrough` proves forwarding and nothing more. There
is no test anywhere that two different proofs yield two different indices,
because with this mock such a test would be impossible to write meaningfully.

The prior audit reached the right verdict on the interface — that
`calculateTxIndex` verifies nothing alone — and then failed to follow it into the
test suite. That is the correction.

---

## 10. Freeze Decision

**FREEZE CORE.**

No code change is required or recommended. Clearbook's Solidity withstood every
attack in §5 and §3, and the two lower-severity items are self-harm paths that no
third party can trigger.

The verdict in §1 is about evidence, not defects. Freeze the code, and hold the
claim at exactly what §4 supports:

> A proven event is committable once, across independent originators on this
> book. No component of the evidence's identity can be freely asserted by the
> claimant: the transaction index is not a parameter at all, the chain key and
> block height are rejected by the precompile if they do not match the proof, and
> the log index must address a real transfer inside the verified receipt.

Every clause of that is defensible. What is **not** defensible, and should not be
said, is that the proof *derives* the identity, or that identity is
caller-independent as a proven property rather than a closed-set argument resting
on precompile behaviour this repository cannot verify.

**If an expert auditor had one hour**, they should spend all of it on a single
question: does `verifyAndEmit` reject a proof whose `chainKey` or `blockHeight`
does not match? That is answerable in one live experiment against CC3 — submit a
known-good proof with a deliberately wrong `chainKey` and observe whether it
reverts. It requires no code change, and it would convert the largest UNKNOWN in
this system into a fact.
