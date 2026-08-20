# KNOWN_ISSUES.md

Two sections: **honest limits** of the design (BUILD.md §9, verbatim — these are permanent properties, not bugs), and **open issues** found during the build.

---

## Part 1 — Honest limits (BUILD.md §9, verbatim)

1. **The covenant is bounded, not universal.** An originator that funds a payer from an address it never binds does not breach `CIRCULAR_REPAYMENT`. Depth-1 detection only. This is inherent to a rule that must be machine-checkable, and it is why the rule is framed as a *covenant the originator chose*, not as fraud detection.
2. **Address ≠ entity.** A bound treasury is an address that produced a signature. Nothing more.
3. **Absence is unprovable.** Merkle inclusion proofs cannot show that a transaction did *not* occur. Clearbook therefore never certifies a book as clean; it makes specific claims refutable. This is a deliberate consequence of the cryptography, and saying so is a strength.
4. **On-chain evidence says nothing about off-chain agreements.** A verified transfer is not a loan.
5. **Ethereum only.** Sepolia and (per docs) Ethereum Mainnet are the supported source chains today.
6. **Writability is unreleased**; Clearbook makes no cross-chain writes.
7. **Front-running of challenges is unmitigated in v1.**
8. **Testnet economics.** Bonds are testnet CTC.

> Note on limit 5: as of 2026-08-20 this is no longer "per docs" — **both** Sepolia (`chainKey 1`) and Ethereum Mainnet (`chainKey 3`) were confirmed live and attesting (DECISIONS D-003). The limit itself stands: Ethereum only, nothing else.

---

## Part 2 — Open issues

### K-001 · Importing a gate script used to run it — FIXED

**Class:** BUG (ours). **Status:** fixed 2026-08-20.

`gate2-proof.ts` imports helpers from `gate1-evidence.ts`. Because `gate1-evidence.ts` called `main()` unconditionally at module scope, importing it **re-scanned the source chain and overwrote `integration/results/gate1-candidates.json`** — silently changing the evidence file mid-run and destroying reproducibility of a recorded result.

Caught by noticing candidate output appearing inside a Gate 2 run that should not have produced any.

**Fix:** a direct-invocation guard comparing `import.meta.url` against `process.argv[1]`. Verified: re-running `gate2-proof.ts` no longer emits any scan output and leaves the candidates file untouched.

**Lesson for later phases:** every script under `integration/` that both exports helpers and has a `main()` needs this guard.

---

### K-002 · Gate 0's 60-second advance check can report a false stall

**Class:** DOCUMENTATION/IMPLEMENTATION MISMATCH (in BUILD.md's own gate definition). **Status:** open, mitigated.

BUILD.md Gate 0 criterion 3 requires the attested height to advance within 60 seconds. Attestation is actually granted in **batches of 10 blocks roughly every 2 minutes** (DECISIONS D-005), so a healthy chain can legitimately show zero advance across a 60-second window.

This actually happened on the first Gate 0 run: Sepolia read as `STALLED` and would have been wrongly disqualified.

**Mitigation:** `integration/gate0-lag.ts` performs a 7-sample / 6-minute observation and additionally measures lag against the source-chain head. A zero-advance result from Gate 0 must be escalated to this script before any chain is declared stalled.

**Also fixed:** `gate0-capabilities.ts` no longer prints a bare `STALLED`. A flat 60-second reading is now labelled `INCONCLUSIVE (flat over 60s - run gate0-lag.ts before concluding)`, with a follow-up note naming the escalation script.

**Residual:** BUILD.md's gate text itself still defines criterion 3 as a 60-second check. The script satisfies it as written while refusing to overstate a flat result. If BUILD.md is ever revised, criterion 3 should require the longer observation.

---

### K-003 · Two different `INativeQueryVerifier.sol` in one package

**Class:** DOCUMENTATION/IMPLEMENTATION MISMATCH (upstream). **Status:** open upstream, routed around locally.

`@gluwa/usc-contracts@0.2.0` ships two same-named, materially different interface files (DECISIONS D-008). The shorter one lacks `verifyAndEmit`, the batch overloads, `calculateTxIndex` and the `TransactionVerified` event, yet compiles fine — so a wrong import silently removes the functionality Clearbook depends on.

**Route-around:** import only `contracts/write-ability/common/INativeQueryVerifier.sol`. Phase 2 should add a build-time assertion that both `verifyAndEmit` and `calculateTxIndex` resolve.

**Report upstream** alongside K-004.

---

### K-004 · Documented decoder import path does not exist

**Class:** DOCUMENTATION/IMPLEMENTATION MISMATCH (upstream, predicted by BUILD.md §1.3). **Status:** open upstream, routed around locally.

Official `USCMinter.sol` imports `@gluwa/usc-contracts/contracts/decoding/EvmV1Decoder.sol`; that directory does not exist in the published package, and the `files` field makes it unpublishable. Real path: `contracts/write-ability/common/EvmV1Decoder.sol` (DECISIONS D-007).

**Route-around:** real path + forge remapping (Phase 1). **Report upstream in `#buidl-ctc-qna`.**

---

### K-005 · SDK returns unusable `chainName`

**Class:** BUG (upstream, self-documented). **Status:** open upstream, routed around locally.

`@gluwa/usc-sdk@0.18.0` `src/chain-info/index.ts:175` — *"TODO: Name decoding seems to be failing, investigate (you get all zeros currently)"*. Confirmed live.

**Route-around:** resolve chains by numeric `chainId`; never branch on `chainName` (DECISIONS D-004).

---

### K-006 · `SOURCE_CHAIN_KEY` / `SOURCE_CHAIN_NAME` intentionally left blank in `.env`

**Class:** not a defect — a deliberate guard. **Status:** by design.

BUILD.md §1.2 is emphatic that chain keys must be resolved at runtime and **never hardcoded**. Filling these in would invite exactly that. Every script calls `resolveChainKey(info, chainId)` against the ChainInfo precompile instead. The fields remain in `.env.example` because BUILD.md specifies them, but nothing reads them.

---

### K-007 · Precompile failure behaviour unverified

**Class:** UNVERIFIED. **Status:** open — assigned to Phase 11 / Gate 7.

Whether `verifyAndEmit` **reverts** or **returns false** on a bad proof is still unknown; Phase 0 exercised only the success path (DECISIONS D-015). BUILD.md §19 requires the answer be recorded before submission.

**No security consequence today:** `EvidenceVault` will `require()` the returned bool, so both behaviours terminate the transaction. Fail-closed either way.

---

### K-010 · Two internal contradictions in BUILD.md, resolved with evidence

**Class:** DOCUMENTATION/IMPLEMENTATION MISMATCH (in the spec itself). **Status:** resolved in code; BUILD.md text should be corrected.

1. **Which states are challengeable.** §4.2's diagram and transition table allow `REGISTERED → BREACHED`; §5.3's predicate condition 1 requires `REPAYMENT_CLAIMED`. §5.3 wins — the predicate reads the loan's repayment fact, which a `REGISTERED` loan does not have, so challenging one is structurally impossible, not merely disallowed. See DECISIONS D-022.

2. **`challenge()`'s error surface.** §5.2's table lists `NoBreach`; §5.3 names a distinct error per condition. §5.3 wins, and `NoBreach` is not declared because it would be unreachable. This has a knock-on effect on §13.1's demo table, which is corrected in `DEMO.md`. See DECISIONS D-023.

Neither was silently absorbed: both are recorded, and the recommended BUILD.md edits are stated in `DECISIONS.md`.

---

### K-011 · Two economic parameters are referenced by BUILD.md but never given values

**Class:** UNVERIFIED (specification gap). **Status:** chosen conservatively, flagged for confirmation.

`REPAYMENT_BPS` (used by §4.2, §5.2 and T19) and `MIN_BOND` (used by `registerOriginator`) have no value anywhere in BUILD.md — §4.4's parameter table omits both.

Implemented as `REPAYMENT_BPS = 10_000` (repayment must cover principal in full) and `MIN_BOND = 1 ether` (equal to `BOND_PER_LOAN`). Reasoning in DECISIONS D-024. These are marked `[I]` (inference), **not** `[P]` — if the intended economics differ, this is where to look.

---

### K-012 · The §19 forbidden-word check flags its own disclaimers

**Class:** DOCUMENTATION/IMPLEMENTATION MISMATCH (in the audit checklist). **Status:** open — matters at Phase 14.

BUILD.md §19 requires "No occurrence of 'fraud', 'proven fraud', 'money laundering' or 'criminal' anywhere in code, UI, docs, deck or video".

Read literally that is self-defeating. A grep over this repository returns six matches, and **all six are required by BUILD.md itself**:

- the §0.4 "Never say / Always say" table, which cannot state a prohibition without quoting it (`DEMO.md`)
- the §13.2 closing line *"This does not prove fraud. It proves a rule the fund published was not met."* (`DEMO.md`)
- the §9 limit *"framed as a covenant the originator chose, not as fraud detection"* (`KNOWN_ISSUES.md`, `README.md`)

**Zero occurrences appear in contract code, and none is an unqualified claim.** Every one is a negation, a disclaimer, or a prohibition.

**Risk:** a Phase 14 auditor running the checklist mechanically could "fix" this by deleting the disclaimers — which would remove precisely the language that makes the project truthful, achieving the opposite of the rule's intent.

**Planned handling:** the audit check should be "no *unqualified* claim of fraud/criminality", verified by reading the six matches, not by grep count. Recorded here so the finding survives to Phase 14.

---

### K-009 · The specified secret-scanning regex will block legitimate commits

**Class:** DOCUMENTATION/IMPLEMENTATION MISMATCH (in BUILD.md's own spec). **Status:** open — due Phase 8.

BUILD.md §8.3 requires a pre-commit hook that greps tracked files for `0x[0-9a-fA-F]{64}`. That pattern matches **any 32-byte hex value**, not just private keys.

Running it across the Phase 0 tree produced 29 matches across 8 files — **every one a false positive**: source-chain transaction hashes, block hashes, Merkle roots, continuity digests, and the ERC-20 `Transfer` topic constant. A hook this literal would block essentially every commit this project needs to make, since recorded transaction hashes are core evidence artifacts (BUILD.md §16 requires six forged-proof tx hashes in the README alone).

**Planned fix:** scope the hook to what actually matters — scan for key material in the shapes it really takes (assignments to `*PRIVATE_KEY*`, `.env`-style files, unprefixed 64-hex adjacent to key-ish identifiers) and allowlist `integration/results/**` and `*.md` evidence tables. The goal is a hook that fires on a real leak, not one that trains people to bypass it with `--no-verify`.

**No key material exists in this repository today** — verified by inspection of all 29 matches, and no private key has been generated yet.

---

### K-008 · "A transaction we sent" is not yet demonstrated

**Class:** BLOCKED — requires an external funding action. **Status:** open.

BUILD.md's Gate 2 wording is *"`getProof` returns `success: true` for a transaction **we sent**"*. Phase 0 proved something adjacent and arguably stronger — two **arbitrary third-party** transactions proved and verified end-to-end (DECISIONS D-009), which is what actually retires the §14 pivot risk.

But it is **not** the literal gate wording, and Phase 12's deterministic demo scenarios require transactions we control. Closing this needs a funded throwaway Sepolia wallet — an external action only a human can take.

Until it is closed, we do not claim to have proved a transaction of our own.
