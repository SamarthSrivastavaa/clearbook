# Threat Model

Adversaries are assumed to control the originator, the borrower, challengers, source-chain transaction contents and ordering, malicious ERC-20s, RPC responses, frontend input, and proof submissions.

Every threat below names the mitigation, the invariant it preserves, and **the test that proves it**. A mitigation without a test is a claim, not a control.

**Status key:** ✅ tested · 🔵 live-verified on chain · 📝 documented, accepted

---

## Evidence integrity

| # | Attack | Mitigation | Test | Status |
|---|---|---|---|---|
| T1 | **Replay a fact** to inflate claims | `factId` dedupe; re-submission is an idempotent no-op, checked *before* verification | `test_replay_is_noop` | ✅ |
| T2 | **Multi-log replay** — one log blocks or is reused for many claims | `factId` includes `logIndex`; `factConsumedBy` binds one fact to one loan | `test_multi_log_distinct_facts`, `test_fact_reuse_rejected` | ✅ |
| T3 | **Proof substitution** — swap the transaction while keeping the proof | The precompile binds bytes to the Merkle leaf | `test_forged_bytes_rejected`; six live mutations all rejected | ✅ 🔵 |
| T4 | **Reverted source transaction** cited as a real transfer | `receiptStatus == 1` asserted **by us** — the precompile does not check it | `test_reverted_tx_rejected` | ✅ |
| T5 | **Cross-chain confusion** — present a Sepolia transfer as mainnet | `chainKey` in `factId`; `challenge()` requires `F.chainKey == R.chainKey` | `test_cross_chain_distinct_facts`, `test_cross_chain_rejected` | ✅ |
| T6 | **Token spoofing** with a worthless clone | `token` read from `log.address_`, matched to the loan's declared token | `test_wrong_token_rejected` | ✅ |
| T7 | **ERC-721 confusion** — a 4-topic log read as an amount | `topics.length != 3` rejected | `test_erc721_rejected` | ✅ |
| T8 | **Log index out of range** | Bounds check before array access | `test_log_index_oob` | ✅ |
| T18 | **Stale proof** — an ancient transfer as a fresh repayment | Facts carry `blockHeight`; ordering enforced in the predicate | `test_ordering_enforced` | ✅ |
| T21 | **Malicious RPC** feeding fabricated transactions | Worker output is only a bundle; the precompile rejects fabrications | `test_forged_bytes_rejected` | ✅ 🔵 |
| T26 | **DoS via huge receipts** | Free `verify()` pre-check before spending gas; decode cost bounded | `test_large_receipt` (60 logs) | ✅ |

**T3 is the one that matters most, and it is measured rather than argued.** Six deliberate mutations — a Merkle sibling hash, a continuity root, the lower endpoint digest, the block height, an `isLeft` flag, and one byte of the encoded transaction — were each put to the precompile. All six were rejected, with descriptive reasons (`Merkle proof validation failed`, `Merkle root mismatch`, `Continuity proof does not match attestation or checkpoint`). See DECISIONS D-041.

---

## Identity and claims

| # | Attack | Mitigation | Test | Status |
|---|---|---|---|---|
| T9 | **Address spoofing** — claim a treasury you do not control | EIP-712 signature by the source-chain key | `test_bind_requires_signature` | ✅ |
| T10 | **Binding replay** across originators | `originatorId` + `nonce` + `chainId` inside the signed struct; one address binds once, ever | `test_binding_replay` | ✅ |
| T11 | **Evidence reuse** across loans | `factConsumedBy` | `test_fact_reuse_rejected` | ✅ |
| T19 | **Overpayment / partial payment** to dodge matching | Disbursement requires exact equality; repayment requires ≥ principal | `test_amount_boundaries` | ✅ |
| T22 | **Integer overflow** in `principal * repaymentBps` | Solidity 0.8 checked arithmetic; bps ≤ 10000; multiply before divide | Invariant suite | ✅ |

A bound treasury is **an address that produced a signature**. It is not evidence that any person or company controls it, and the UI says so on every screen that shows one.

---

## Economics and the challenge path

| # | Attack | Mitigation | Test | Status |
|---|---|---|---|---|
| T12 | **Bond flight** ahead of a pending challenge | `exposure` accounting plus `withdrawCooldown` | `test_cannot_withdraw_exposed`, `test_withdraw_blocked_during_cooldown_after_claim` | ✅ |
| T13 | **Double slash** | `BREACHED` is terminal; status checked first | `test_double_slash` | ✅ |
| T14 | **Reentrancy on payout** | CEI — all state written before any call; `ReentrancyGuard` | `test_reentrancy_bounty` | ✅ |
| T15 | **Griefing by invalid challenges** | Invalid challenges revert; attacker pays gas; no state written | `test_invalid_challenge_reverts` | ✅ |
| T20 | **Same-block** funding and repayment | `<=` admits it; `factId` differs by `txIndex`/`logIndex` | `test_same_block_breach` | ✅ |
| T23 | **Unsafe external call** — payee reverts, bricking `challenge()` | `call{value:}` with checked return; state already final; a reverting payee reverts the whole call and the loan stays challengeable | `test_payout_to_reverting_contract` | ✅ |
| T24 | **Approval / allowance issues** | Clearbook never moves ERC-20s. No `approve`, no `transferFrom`, no token custody. It holds only native CTC | n/a by construction | 📝 |

`test_payout_to_reverting_contract` asserts the important half: after a reverting payee blocks one challenger, **an ordinary challenger still succeeds**. The mechanism cannot be bricked by refusing the bounty.

---

## Accepted risks

| # | Risk | Why it is accepted |
|---|---|---|
| T16 | **Challenge front-running** — a valid challenge in the mempool can be copied | The production fix is commit–reveal, which adds a block of latency to the single most important demo beat and buys little on a low-MEV testnet. Documented, not mitigated in v1 |
| T17 | **Originator evades via an unbound address** | Cannot be prevented, and this is the covenant's honest boundary. Depth-1 detection is inherent to a rule that must be machine-checkable. An unbound address also cannot be cited in a disbursement or repayment claim. `test_unbound_funding_not_a_breach` proves the limit behaves as described |
| T25 | **Reorg after attestation** | Attestors attest finalized blocks. Beyond that we inherit Ethereum's finality assumption and say so rather than claiming more |

T17 is not a gap we failed to close — it is why the rule is framed as *a covenant the originator chose and bonded against* rather than as fraud detection.

---

## Global invariants

Asserted under a fuzzing handler that registers, binds, claims, challenges, finalizes and withdraws.

| | Invariant | Test |
|---|---|---|
| `I1` | `address(this).balance >= Σ bonds` | `invariant_I1_balance_covers_bonds` |
| `I2` | `bond >= exposure` for every originator | `invariant_I2_bond_covers_exposure` |
| `I3` | every `factId` backs at most one claim | `invariant_I3_fact_backs_one_claim` |
| `I4` | terminal states never transition | `invariant_I4_I6_status_and_exposure_accounting` |
| `I5` | no stored fact came from a `receiptStatus != 1` transaction | `invariant_I5_no_reverted_source_facts` |
| `I6` | `exposure == bondPerLoan × count(open loans)` | `invariant_I4_I6_status_and_exposure_accounting` |

**An invariant suite can pass because nothing interesting happened.** That is not hypothetical here: the first version passed all five while the fuzzer never once reached `challenge()`, so `I1` and `I2` were holding over state in which no slashing had occurred. `test_handler_reaches_a_breach` now asserts the handler can drive the protocol all the way to a slash. If it ever fails, treat every invariant result as unproven (DECISIONS D-029).

---

## What remains untested

Stated plainly, because a threat model that only lists successes is marketing.

- **The UI's write path is unexercised.** Every state-changing call so far was submitted by script. The frontend simulates them correctly, but no transaction has been signed from a browser wallet.
- **Branch coverage of `Clearbook.sol` is 75.6%**, below its 100% line coverage. The gap is compound conditions.
- **Attestation liveness is inherited from the attestor set.** If attestation of a source chain stops, no new evidence about it can enter the vault.

The first is a demonstration gap, not a protocol gap — the same calldata succeeds from a script. The second is a matter of deepening tests around compound conditions. The third is a stated dependency (T25), not a defect.
