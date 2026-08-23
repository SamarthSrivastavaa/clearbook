# SECURITY.md

Status: **deployed to Creditcoin CC3 testnet and exercised end-to-end.** 95 tests pass against a mock verifier, and the full protocol path — proof, on-chain decode, commitment, breach, slash, bounty — has executed live. Every claim below carries the evidence class that supports it.

The full threat table with per-threat tests is in [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).

Nothing here is aspirational: claims are marked with the evidence class that supports them —
**[P]** primary doc · **[C]** source-code verified · **[L]** live verified · **[I]** inference · **[U]** unverified · **[B]** blocked.

---

## 1. Trust boundary (BUILD.md §2.2)

```
UNTRUSTED  : worker, frontend, RPC providers, proof builder, originator,
             borrower, challenger, all user input
SEMI-TRUST : Attestcoin attestor set (quorum honesty), Creditcoin validators
TRUSTED    : Ethereum consensus (finality), Creditcoin consensus,
             the 0x0FD2 precompile implementation
```

**The worker is an orchestrator.** It acquires proof bundles and submits transactions. It has no privileged role, no signing authority over state, and no ability to make the vault believe anything. A corrupted bundle fails `verifyAndEmit` and reverts. If the worker disappears, anyone else can submit the identical bundle.

**The proof builder is untrusted.** It supplies proof *material*; the precompile is what makes that material meaningful. A malicious proof builder can deny service; it cannot forge a fact — `[L]`, and no longer an assumption: six deliberate mutations of a valid proof were each rejected by the precompile (D-041).

---

## 2. What has actually been established

| Claim | Class | Evidence |
|---|---|---|
| Chain keys are discoverable at runtime; nothing needs hardcoding | **[L]** | `resolveChainKey()` used by every script · `results/gate0-*.json` |
| Attestation is live and advancing on both supported chains | **[L]** | +30 blocks / 6 min · `results/gate0-lag-*.json` |
| Attestation lag is bounded and stable (Sepolia 36–41 blocks) | **[L]** | 7-sample observation |
| The proof builder serves ordinary third-party transactions | **[L]** | Two unrelated Sepolia txs — D-009 |
| The precompile verifies a real proof | **[L]** | `verify()` → true, repeatedly |
| `calculateTxIndex()` agrees with the source chain | **[L]** | matched on every transaction proven |
| A verified receipt decodes to the correct token/from/to/amount | **[L]** | 11/11 cross-checks, twice — D-009 |
| **Transactions we sent are provable and verifiable** | **[L]** | 5/5 staged, 40/40 cross-checks — K-008 |
| **Forged proofs are rejected** | **[L]** | 6/6 mutations rejected — D-041 |
| **The precompile REVERTS on a bad proof** | **[L]** | 6/6, with reason strings — D-041, K-007 |
| ERC-20 `Transfer` topic0 constant | **[L]** | re-derived with `cast keccak` |
| Transaction-local `logIndex` ≠ block-global `logIndex` | **[L]** | D-012 |
| `verifyAndEmit`'s failure mode | **[I]** | inferred from `verify()`; unconfirmed until Gate 7 part B |
| On-chain decode of live data by `EvidenceVault` | **[U]** | needs deployment — Gate 4 |
| Live challenge, slashing, bounty payment | **[U]** | needs deployment — Gates 5 and 6 |

**The failure path is now proven, not assumed.** The earlier caveat here — that only the success path had been exercised — no longer applies: six deliberate proof mutations were each rejected by the precompile, which settles both that forgery fails and *how* it fails.

What remains unproven is the on-chain *consumption* of verified facts: `EvidenceVault` storing them and `Clearbook` acting on them. Both need a funded deployment.

## 3. Provenance discipline (BUILD.md §3.1)

The single most important rule in the system:

> **Never store, compare against, or display a caller-supplied value that can instead be extracted from the verified receipt.**

| Field | Source | Caller-influenceable? |
|---|---|---|
| `token`, `from`, `to`, `amount` | decoded from the verified receipt | **No** |
| `receiptStatus` | decoded; asserted `== 1`; not stored | **No** |
| `txIndex` | precompile view `calculateTxIndex` | **No** |
| `chainKey`, `blockHeight` | caller-supplied **but bound by the proof** — a wrong value fails verification | Bounded |
| `logIndex` | caller-supplied index into the decoded array | Bounded: must be `< receiptLogs.length` and the log must be a `Transfer` |
| `submitter`, `ccBlock` | chain context | **No** |

Every deviation from this table is a security bug, not a style question.

---

## 4. Replay and fact identity

```
factId = keccak256(abi.encode(chainKey, blockHeight, txIndex, logIndex))
```

This is **deliberately stricter than the reference implementation**, whose key is transaction-level (`keccak(chainKey, blockHeight, txIndex)` — `[C]`, `USCBase.sol`).

**Why the extra `logIndex` is necessary, with live evidence:** one transaction can carry many `Transfer` logs relevant to different loans (batch disbursement, multicall, DEX routing). Under a transaction-level key the first ingested log would permanently lock out every other log in that transaction.

This is not hypothetical. The two transactions proved in Phase 0 carried **17 and 30 logs** respectively (`[L]`, DECISIONS D-009).

**`logIndex` is transaction-local, not block-global.** That is safe *only* because it is combined with `txIndex` in the key — and the two indices genuinely differ in live data (`[L]`, DECISIONS D-012). No reviewer should assume otherwise.

`factId` is **idempotent by design**: re-submitting a known fact is a no-op returning the existing id, not a revert. That is what makes the worker restart-safe.

---

## 5. Freshness and reorgs (BUILD.md §3.3)

- Attestors attest **finalized** source-chain blocks `[P]`. Phase 0's measured Sepolia lag of 36–41 blocks (~7–8 min) is consistent with Ethereum finality (~64 blocks / ~12.8 min) `[L]`.
- A verified fact therefore refers to a finalized block, and Clearbook applies **no additional confirmation threshold**.
- **Already-verified evidence is never invalidated.** There is no revocation path and none is needed under the finality assumption.
- **No timestamp dependence anywhere.** All timing uses `blockHeight` (source chain) or `block.number` (Creditcoin). `block.timestamp` must appear nowhere in consequential logic.

**Residual assumption, stated plainly:** *if Ethereum finality were reverted, or if the attestor quorum were compromised, a stored fact could be false. Clearbook inherits that assumption and does not attempt to mitigate it.*

---

## 6. Global invariants

| | Invariant |
|---|---|
| `I1` | `address(this).balance >= Σ originators[i].bond` |
| `I2` | `bond >= exposure` for every originator |
| `I3` | every `factId` backs at most 1 claim |
| `I4` | terminal states (`BREACHED`, `SETTLED`) never transition |
| `I5` | no stored fact came from a `receiptStatus != 1` transaction |
| `I6` | `exposure == bondPerLoan × count(status ∈ {REGISTERED, REPAYMENT_CLAIMED, DELINQUENT})` |

**Status: implemented and passing** in `contracts/test/Invariants.t.sol`, under a fuzzing handler across 64 runs × 4096 calls.

One caveat worth stating loudly: an invariant suite can pass because nothing interesting ever happened. The first version of this suite passed all six while the fuzzer never reached `challenge()` — so `I1` and `I2` held over state in which no slashing occurred. `test_handler_reaches_a_breach` now asserts the handler can drive the protocol to an actual slash. If it fails, treat every invariant result as unproven.

---

## 7. Ordering requirement in `submitTransferFact`

The step order in BUILD.md §5.1 is security-critical and must not be rearranged:

1. dedupe check **first** (idempotent no-op; also makes replay nearly free)
2. `verifyAndEmit` **before any decoding** — never decode unverified bytes into anything consequential
3. assert `receiptStatus == 1` — **the precompile does not check transaction success** (`[P]` + `[C]`); the dApp must
4. bounds-check `logIndex` before array access
5. reject `topics.length != 3` — this is what stops an ERC-721 `Transfer` (4 topics) being read as an amount
6. reject `data.length != 32`

`integration/lib/decode-receipt.ts` mirrors steps 4–6 so Phase 0 could exercise them, but **that file is a cross-check only and is banned from the trust path** (DECISIONS D-010). The authoritative implementation is Solidity.

---

## 8. Secret handling

- `.env` is gitignored; only `.env.example` is committed, with all key fields empty.
- No private key has been generated or stored in this repository as of Phase 0.
- All wallets used from here on must be **throwaway** wallets holding only testnet value.
- BUILD.md §8.3 requires a pre-commit hook grepping tracked files for `0x[0-9a-fA-F]{64}`. **Not yet implemented** — due in Phase 8 alongside the worker; earlier if any key is generated first.
- Never log private keys, seed phrases, or `.env` contents.

---

## 9. Covenant scope: the funding leg is broader than fraud

**[C]** `CIRCULAR_REPAYMENT` fires whenever the originator's bound treasury sent the
repaying address at least the repayment amount, in the same token, within
`circularWindow` source-chain blocks. It does not require those funds to be the
ones that repaid — transfer facts cannot establish that.

So a second tranche, a revolving draw, or any same-day disbursement to a
counterparty that then repays a different loan satisfies the funding leg exactly
as a circular flow does. Both deployed originators publish
`circularWindow = 5000` (~17 hours), so the exposure is real, not theoretical.

This is the covenant behaving as published. Inferring which coins repaid a loan
is precisely the inference this protocol refuses to make, and the alternative —
guessing — would be worse than the breadth. `circularWindow` is the originator's
control: a wide window is a strong claim carrying real exposure, a tight one
claims less and is operationally comfortable. **An originator running an active
revolving facility cannot use a wide window.**

Pinned by `test_03_second_tranche_makes_first_loan_challengeable` and
`test_05_tight_circular_window_excludes_the_tranche` in
`test/CovenantSemantics.t.sol`.

Consequence for automated challengers: the reference challenger acts on both
shapes, because both breach a rule the originator published, but it classifies
them. A funding leg paid to a third party who then repaid the loan is recorded
as `third-party`; one paid to the loan's own borrower is recorded as
`same-borrower` — actionable, and weaker, and said so. Operators who would
rather miss breaches than press an arguable one set `CHALLENGER_STRICT=true`.

## 10. Activity coverage: what the ratio can and cannot be made to say

**[C]** Coverage is `committed / qualifying` over successful outbound transfers
from bound treasuries, in the tokens an originator's own claims are denominated
in, inside a stated block range. Every input is public and recomputable.

Attacks considered:

| Attack | Outcome |
|---|---|
| Unbind a treasury once its activity looks bad | **Impossible.** `bindTreasury` reverts `AlreadyBound`; no unbind path exists in the contract. |
| Operate from an address never declared | **Works, and is the stated limitation.** Coverage measures declared treasuries only, and says so beside every figure. |
| Fragment one payment into many transfers | Lowers coverage, not raises it — the denominator grows. No incentive. |
| Inflate the numerator with fake commitments | Requires a verified fact and a bond per claim. Committing a fact that is not a real loan is still a bonded, challengeable claim. |
| A malicious token emitting fake `Transfer` events | Only affects tokens the originator already lends in; it would inflate their own denominator. |
| An RPC silently omitting logs | **Real risk, and it flatters the originator** by shrinking the denominator. Mitigated by server-side `from` filtering, chunks well under the node's 10,000-block `eth_getLogs` limit, and two independently written implementations that must agree (`npm run gate10`). |
| Duplicate logs inflating the denominator | Each transfer reduces to a unique `factId`; duplicates collapse. |

Not defended, and stated rather than hidden: the denominator counts activity that
was never intended as a loan — gas, rebalancing, fees — so a low figure is not by
itself evidence of anything withheld.

**Coverage is not a credit score.** It carries no opinion about creditworthiness
and is never rendered as a grade, rank, or colour.

## 11. What remains unproven

Stated plainly, because a security document that lists only successes is marketing.

- **The UI's write path has not been exercised end-to-end.** Every state-changing call demonstrated so far — `registerLoan`, `claimRepayment`, `challenge` — was submitted by script with a throwaway key. The frontend builds and simulates these transactions correctly (the challenge console runs a live `eth_call` before enabling its button), but no challenge has been *signed from a browser wallet*.
- **Branch coverage of `Clearbook.sol` is 75.6%**, against 100% line coverage. The gap is compound conditions, not unreached functions.
- **Attestation liveness is inherited, not guaranteed by us.** If the Attestcoin attestor set stops attesting a source chain, no new evidence about that chain can enter the vault. Facts already stored are unaffected.
- **The 95 unit tests run against a mock verifier.** The live proof path is proven separately, on-chain, by Gates 2/3, 4 and 7 — but the two are distinct bodies of evidence and are not interchangeable.
- **A bound treasury proves control of a key and nothing more.** It does not establish that an address belongs to any named person or company. Every downstream conclusion inherits that limit.

Deliberately accepted for v1, per BUILD.md: **challenge front-running** (T16 — commit–reveal is the production fix, and it costs a block of latency on the most important demo beat) and **reorg after attestation** (T25 — inherited from the attestor set, and we say so rather than claiming more).
