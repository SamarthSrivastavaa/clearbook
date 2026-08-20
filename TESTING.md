# TESTING.md

> **Status: Phase 3 complete.** 73 tests pass and line coverage of `src/` is 100%. The live integration gates from Phase 0 also still pass. Everything below reflects what actually runs today.

---

## Test layers

| Layer | Location | Runs against | Status |
|---|---|---|---|
| Live protocol gates | `integration/*.ts` | CC3 testnet + Sepolia (read-only) | **passing** |
| Vault unit tests | `contracts/test/EvidenceVault.t.sol` | local EVM | **19 passing** |
| Lifecycle tests | `contracts/test/Clearbook.t.sol` | local EVM | **30 passing** |
| Adversarial tests | `contracts/test/Security.t.sol` | local EVM | **18 passing** |
| Invariants + reachability | `contracts/test/Invariants.t.sol` | local EVM | **6 passing** |
| End-to-end | `integration/e2e-full.ts` | live deployment | Phase 10 |
| Forged-proof rejection | `integration/gate7-forged.ts` | live deployment | Phase 11 |

### Coverage — Gate 3

| File | Lines | Branches |
|---|---|---|
| `src/Clearbook.sol` | **100.00% (110/110)** | 75.61% |
| `src/EvidenceVault.sol` | **100.00% (33/33)** | 100.00% |
| `src/libraries/CovenantLib.sol` | **100.00% (8/8)** | 100.00% |

**151/151 lines in `src/` — 100%, against the required ≥90%.** `src/interfaces/IEvidenceVault.sol` contains no executable lines and is the only exclusion; it needs no justification beyond that.

Branch coverage of `Clearbook.sol` is lower than line coverage at **75.61%**. The uncovered branches are mostly compound-condition short-circuits already exercised from one side (for example `status != REGISTERED && status != DELINQUENT`). Gate 3's criterion is lines; this is recorded rather than hidden, and is the obvious place to deepen tests next.

> **`forge coverage` will not compile this project without `--ir-minimum`.** Coverage disables `via_ir`, which reintroduces the "Stack too deep" error the official decoder triggers (DECISIONS D-018/D-028). Use `make coverage`, or:
> ```
> cd contracts && forge coverage --ir-minimum --report summary
> ```
> Forge warns that `--ir-minimum` can produce less accurate source mappings, so treat the named behavioural tests below — not the percentage — as the real evidence.

---

## Running what exists today

None of these need a funded wallet or an API key — every call is read-only against public endpoints.

```bash
npm run gate0        # Gate 0: capability discovery      (~70s, includes a 60s re-poll)
npm run gate0:lag    # attestation lag observation       (~6 min)
npm run gate1        # discover a real third-party ERC-20 Transfer
npm run gate2        # Gates 2+3: prove, verify, decode, cross-check
cd contracts && forge build   # Gate 1a
```

Every gate writes a machine-readable record to `integration/results/`. Those files are committed deliberately: BUILD.md §16 requires gate outputs in the submission, and they are the evidence behind the `[L]` claims in `DECISIONS.md`.

### Gate pass criteria

| Gate | Passes when |
|---|---|
| 0 | non-empty chain list · ≥1 chain attesting · attested height advances |
| 1a | `forge build` succeeds against the real `@gluwa/usc-contracts` paths |
| 2 | `getProof` returns `success: true` |
| 3 | `verify()` at `0x0FD2` returns `true` |
| 4 | on-chain decoded `token`/`from`/`to`/`amount` match the source-chain explorer exactly |
| 5 | a real circular flow triggers `challenge()`; a non-circular one reverts `NoBreach` |
| 6 | bond, bounty, sink and `exposure` all move by exactly the expected amounts |
| 7 | **all six** proof mutations are rejected |

**A caveat on Gate 0's criterion 3.** Attestation is granted in batches (~10 blocks every ~2 min), so a healthy chain can legitimately show zero advance across a 60-second window — this happened on the first run and would have wrongly condemned Sepolia. `gate0-capabilities.ts` now reports a flat reading as `INCONCLUSIVE` rather than `STALLED`; escalate to `gate0:lag` before concluding anything. See KNOWN_ISSUES K-002.

---

## BUILD.md's required tests — where each one lives

Named with a `test_` prefix (Foundry's convention) rather than BUILD.md's `t_`; the mapping is one-to-one.

| BUILD.md name | Implemented as | File |
|---|---|---|
| `t_replay_is_noop` | `test_replay_is_noop` | `EvidenceVault.t.sol` |
| `t_multi_log_distinct_facts` | `test_multi_log_distinct_facts` | `EvidenceVault.t.sol` |
| `t_forged_bytes_rejected` | `test_forged_bytes_rejected` | `EvidenceVault.t.sol` |
| `t_reverted_tx_rejected` | `test_reverted_tx_rejected` | `EvidenceVault.t.sol` |
| `t_erc721_rejected` | `test_erc721_rejected` | `EvidenceVault.t.sol` |
| `t_log_index_oob` | `test_log_index_oob` | `EvidenceVault.t.sol` |
| `t_large_receipt` | `test_large_receipt` (60 logs) | `EvidenceVault.t.sol` |
| `t_cross_chain_rejected` | `test_cross_chain_distinct_facts` + `test_cross_chain_rejected` | `EvidenceVault.t.sol`, `Security.t.sol` |
| `t_wrong_token_rejected` | `test_wrong_token_rejected` | `Clearbook.t.sol` |
| `t_bind_requires_signature` | `test_bind_requires_signature` | `Clearbook.t.sol` |
| `t_binding_replay` | `test_binding_replay` | `Clearbook.t.sol` |
| `t_fact_reuse_rejected` | `test_fact_reuse_rejected` | `Clearbook.t.sol` |
| `t_cannot_withdraw_exposed` | `test_cannot_withdraw_exposed` | `Clearbook.t.sol` |
| `t_amount_boundaries` | `test_amount_boundaries` | `Clearbook.t.sol` |
| `t_register_claim_finalize` | `test_register_claim_finalize` | `Clearbook.t.sol` |
| `t_circular_flow_breach` | `test_circular_flow_breach` | `Security.t.sol` |
| `t_double_slash` | `test_double_slash` | `Security.t.sol` |
| `t_reentrancy_bounty` | `test_reentrancy_bounty` | `Security.t.sol` |
| `t_invalid_challenge_reverts` | `test_invalid_challenge_reverts` | `Security.t.sol` |
| `t_unbound_funding_not_a_breach` | `test_unbound_funding_not_a_breach` | `Security.t.sol` |
| `t_ordering_enforced` | `test_ordering_enforced` | `Security.t.sol` |
| `t_same_block_breach` | `test_same_block_breach` | `Security.t.sol` |
| `t_payout_to_reverting_contract` | `test_payout_to_reverting_contract` | `Security.t.sol` |

Invariants `I1`–`I6` (`SECURITY.md` §6) are asserted in `Invariants.t.sol` under a handler that registers, binds, claims, challenges, finalizes and withdraws. `I4` and `I6` share one function because the exposure identity is what proves terminal states released their bond correctly.

### The vacuity guard — `test_handler_reaches_a_breach`

An invariant suite can pass because nothing interesting ever happened. That is not hypothetical here: the first version of this suite passed all five invariants while the fuzzer **never once reached `challenge()`**, so `I1` and `I2` were holding over state in which no slashing had occurred (DECISIONS D-029).

`test_handler_reaches_a_breach` drives the handler deterministically through register → loan → claim → challenge and asserts a slash actually occurred. **If it ever fails, treat every invariant result as unproven** — they are passing over state that never reaches the mechanism they exist to protect.

### Testing the failure mode we have not observed

`test_verifier_revert_also_fails_closed` exists because the real precompile's failure behaviour is still unverified (K-007). `MockVerifier` can either return `false` or revert, and `EvidenceVault` is tested to store nothing under **both**. Whichever way Gate 7 resolves it, the vault already fails closed.

### Mock verifier

`test/mocks/MockVerifier.sol` implements `INativeQueryVerifier` with a settable return value and a settable `calculateTxIndex`. The vault takes an injectable verifier address **in tests only**; `Deploy.s.sol` must assert production uses `0x…0FD2`. That assertion is itself a required test — a testability seam that reaches production is a vulnerability, not a convenience.

---

## Testing principles for this project

1. **Never weaken a check to make a test pass.** If verification fails, diagnose the protocol interaction. A test that passes because validation was removed is worse than a failing test.
2. **Negative controls are first-class.** The honest loan that *cannot* be breached (demo scenario A) is as important as the one that can — it is what shows the mechanism discriminates rather than always firing.
3. **Real data beats synthetic data at the boundaries.** Mocks are for logic; the decoder and the precompile must be exercised against real `txBytes`.
4. **A gate that cannot fail proves nothing.** Gate 7 exists to try to break our own system, and a forged proof being *accepted* is a finding worth more than any feature.

---

## Known gaps

- **The Solidity decode path is unproven against *real* data.** The tests build `txBytes` in the decoder's exact layout and the real `EvmV1Decoder` decodes them, so the decoder is genuinely exercised — but every input is synthetic. Phase 0's `[L]` evidence came from a TypeScript mirror that is explicitly **not** production code (DECISIONS D-010). Gate 4 closes this by feeding a real proof bundle to the deployed vault. Until then, no claim about on-chain decoding of live data is `[L]`.
- **Branch coverage of `Clearbook.sol` is 75.61%**, below its 100% line coverage. See the coverage section above.
- **The contracts have never run on a real chain.** Everything here is a local EVM. Gas figures shown by `forge test` are not the CC3 figures the submission requires.
- **The precompile's failure path has never been exercised** — only the success path. Whether it reverts or returns `false` is still unknown (KNOWN_ISSUES K-007). Gate 7.
- **No transaction we sent has been proven** — Phase 0 used third-party transactions. Closing this needs a funded throwaway Sepolia wallet (K-008).
- **Gas figures must be measured under `via_ir = true`**, since that setting changes codegen (DECISIONS D-018). Quoted formula values are not acceptable for the submission.
