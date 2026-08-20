# TESTING.md

> **Status: Phase 1.** No contracts exist yet, so there is no `forge test` suite. What exists today is the live integration gate suite from Phase 0 and the Gate 1a compile check. This file states the strategy now so that Phase 3 has a target rather than inventing one later.

---

## Test layers

| Layer | Location | Runs against | Status |
|---|---|---|---|
| Compile-time interface contract | `contracts/src/Gate1aProbe.sol` | solc + real package paths | **passing** |
| Live protocol gates | `integration/*.ts` | CC3 testnet + Sepolia (read-only) | **passing** |
| Unit tests (mock verifier) | `contracts/test/` | local EVM | Phase 3 |
| Invariant/fuzz tests | `contracts/test/Invariants.t.sol` | local EVM | Phase 3 |
| Security tests | `contracts/test/Security.t.sol` | local EVM | Phase 3 |
| End-to-end | `integration/e2e-full.ts` | live deployment | Phase 10 |
| Forged-proof rejection | `integration/gate7-forged.ts` | live deployment | Phase 11 |

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

## Phase 3 requirements (BUILD.md)

**Coverage gate: `forge coverage` ≥ 90% of lines in `src/`.** Any exclusion must be justified in this file — an unjustified exclusion fails the gate.

Required named tests, each written as explicit setup / action / expected / assertion:

`t_replay_is_noop` · `t_multi_log_distinct_facts` · `t_forged_bytes_rejected` · `t_reverted_tx_rejected` · `t_cross_chain_rejected` · `t_wrong_token_rejected` · `t_erc721_rejected` · `t_log_index_oob` · `t_bind_requires_signature` · `t_binding_replay` · `t_fact_reuse_rejected` · `t_cannot_withdraw_exposed` · `t_double_slash` · `t_reentrancy_bounty` · `t_invalid_challenge_reverts` · `t_unbound_funding_not_a_breach` · `t_ordering_enforced` · `t_amount_boundaries` · `t_same_block_breach` · `t_payout_to_reverting_contract` · `t_large_receipt`

Happy paths: `t_register_claim_finalize` · `t_circular_flow_breach`.

Invariants `I1`–`I6` (see `SECURITY.md` §6) asserted under a fuzzing handler that randomly registers, claims, challenges, finalizes and withdraws.

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

- **The Solidity decode path is unproven against real data.** Phase 0's `[L]` decode evidence came from `integration/lib/decode-receipt.ts`, a TypeScript mirror that is explicitly **not** the production code (DECISIONS D-010). Gate 1a proved the Solidity decoder *compiles*, not that it decodes correctly. Gate 4 closes this. Until then, no claim about on-chain decoding is `[L]`.
- **The precompile's failure path has never been exercised** — only the success path. Whether it reverts or returns `false` is still unknown (KNOWN_ISSUES K-007). Gate 7.
- **No transaction we sent has been proven** — Phase 0 used third-party transactions. Closing this needs a funded throwaway Sepolia wallet (K-008).
- **Gas figures must be measured under `via_ir = true`**, since that setting changes codegen (DECISIONS D-018). Quoted formula values are not acceptable for the submission.
