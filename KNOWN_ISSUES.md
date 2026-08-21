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

### K-007 · Precompile failure behaviour — RESOLVED: it reverts

**Class:** was UNVERIFIED. **Status:** resolved 2026-08-21 by live execution.

BUILD.md §1.3 recorded a contradiction: the SDK documentation says the precompile *reverts* on failed verification, while the reference `USCBase` does `require(verified, ...)` on a returned bool.

`integration/gate7-forged.ts` settles it. Six mutations of a real proof, all put to the read-only `verify()`: **6/6 reverted**, with descriptive reason strings (`Merkle proof validation failed`, `Merkle root mismatch`, `Continuity proof does not match attestation or checkpoint`). See DECISIONS D-041.

**Residual, and it is small:** this exercised `verify()`, not the state-changing `verifyAndEmit()` that `EvidenceVault` calls. Identical behaviour is expected but is inference until Gate 7 part B runs against a deployed vault.

**No code change needed.** `EvidenceVault` keeps its `require`-on-bool, and `test_verifier_revert_also_fails_closed` already proves the vault stores nothing under either behaviour.

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

### K-013 · Dual-package hazard: the SDK's CommonJS types and our ESM types disagree

**Class:** DOCUMENTATION/IMPLEMENTATION MISMATCH (upstream packaging). **Status:** routed around; typecheck clean.

`@gluwa/usc-sdk@0.18.0` ships **CommonJS**, so its `.d.ts` resolves ethers' `lib.commonjs` declarations. This project is **ESM**, so our `import 'ethers'` resolves `lib.esm`. Both files declare `#private` on `JsonRpcApiProvider`, and TypeScript treats each `#private` in a declaration file as a distinct nominal brand — so the two `JsonRpcApiProvider` types are mutually unassignable **despite being the same class at runtime**:

```
error TS2345: Argument of type '...lib.esm/...JsonRpcApiProvider' is not assignable
to parameter of type '...lib.commonjs/...JsonRpcApiProvider'.
  Property '#private' ... refers to a different member
```

This affects the SDK's own documented examples, which pass a `JsonRpcProvider` straight into `PrecompileChainInfoProvider`. Anyone using this SDK from an ESM TypeScript project hits it. Worth reporting upstream alongside K-003/K-004.

**Route-around:** `integration/lib/provider.ts` and `worker/src/provider.ts` each expose one `asSdkProvider()` bridge whose return type is **derived from the SDK's own constructor signature** (`ConstructorParameters<typeof chainInfo.PrecompileChainInfoProvider>[0]`) rather than written out, so it stays correct if the SDK changes what it accepts. The cast is confined to those two functions; if upstream ships ESM types there are exactly two lines to delete.

**Two wrong hypotheses preceded the right one**, and both are recorded because the diagnosis pattern matters: first "duplicate ethers installs" (disproved — `npm ls` showed a single deduped 6.17.0), then "TypeScript 7 changed private-field variance" (disproved — the identical error reproduced on 5.9.3). Only the full error text, which names both resolution paths, revealed the actual cause. The lesson is to read the whole diagnostic before acting on the familiar-looking half of it.

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

### K-014 · Build artifacts were committed and remain tracked

**Class:** BUG (ours, minor). **Status:** gitignored; still tracked.

`frontend/dev.log` and `frontend/tsconfig.tsbuildinfo` were committed before `.gitignore` covered them. Adding ignore rules does not untrack an already-tracked file, so both keep appearing as modified on every run and will keep producing noise diffs.

**Fix (not applied — it stages a deletion, and the human controls the index):**

```
git rm --cached frontend/dev.log frontend/tsconfig.tsbuildinfo
```

The files stay on disk; only the tracking stops. `frontend/.gitignore` now covers `dev.log`, `dev.err.log`, `*.tmp.json` and `*.tsbuildinfo`.

---

### K-015 · The frontend's interactive states are not covered by browser tests

**Class:** UNVERIFIED. **Status:** open, mitigated by logic tests.

The dry-run checklist, the submission lifecycle, and the wallet flows were verified by typecheck, by production build, and by two logic scripts — not by driving a real browser with a connected wallet. No wallet has ever been connected to this app, and `challenge()` has never been submitted from it.

What **is** verified rather than assumed:
- `npm run check:predicate` asserts the eleven-condition mirror against every BUILD.md §13.1 scenario, including the two that must fail.
- `npm run check:verify` runs judge mode's exact viem ABI tuples against a real third-party Sepolia transaction; `verify()` at `0x0FD2` returned true.

What remains untested: `useWriteContract` → wallet → `useWaitForTransactionReceipt` → decoded-revert rendering. That path needs a funded wallet and a deployment, and it is the single most important thing to rehearse before recording the demo.

---

### K-009 · The specified secret-scanning regex will block legitimate commits

**Class:** DOCUMENTATION/IMPLEMENTATION MISMATCH (in BUILD.md's own spec). **Status:** open — due Phase 8.

BUILD.md §8.3 requires a pre-commit hook that greps tracked files for `0x[0-9a-fA-F]{64}`. That pattern matches **any 32-byte hex value**, not just private keys.

Running it across the Phase 0 tree produced 29 matches across 8 files — **every one a false positive**: source-chain transaction hashes, block hashes, Merkle roots, continuity digests, and the ERC-20 `Transfer` topic constant. A hook this literal would block essentially every commit this project needs to make, since recorded transaction hashes are core evidence artifacts (BUILD.md §16 requires six forged-proof tx hashes in the README alone).

**Planned fix:** scope the hook to what actually matters — scan for key material in the shapes it really takes (assignments to `*PRIVATE_KEY*`, `.env`-style files, unprefixed 64-hex adjacent to key-ish identifiers) and allowlist `integration/results/**` and `*.md` evidence tables. The goal is a hook that fires on a real leak, not one that trains people to bypass it with `--no-verify`.

**No key material exists in this repository today** — verified by inspection of all 29 matches, and no private key has been generated yet.

---

### K-008 · "A transaction we sent" — RESOLVED

**Class:** was BLOCKED (external funding). **Status:** resolved 2026-08-22.

BUILD.md's Gate 2 wording is *"`getProof` returns `success: true` for a transaction **we sent**"*. Phase 0 originally proved two *third-party* transactions, which retired the §14 pivot risk but was not the literal requirement.

Now closed. Sepolia funding arrived, and we staged and proved our own transfer:

| | |
|---|---|
| Transaction | `0xd922115fbefd89c7fe43a7ab33768c22d075a829b0fd3de6b53d10d818d6f84d` |
| Block / txIndex | 11538664 / 87 |
| Transfer | treasury → borrower, 0.01 WETH |
| `verify()` at `0x0FD2` | **true** (914 ms) |
| Cross-checks vs source RPC | **11/11 PASS** |

Evidence: `integration/results/gate2-gate3-0xd922115f.json`.

The token is canonical Sepolia WETH — a contract we do not control — so this closes the gate **without** weakening the "we deploy nothing on the source chain" claim. We are an ordinary user of an ordinary token.

Four further transactions were staged the same way for demo scenarios A and B (see `demo/staged/source-transactions.json`), including a genuine circular flow.

---

### K-016 · End-to-end latency — RESOLVED

**Class:** was UNVERIFIED (BUILD.md §1.2). **Status:** resolved 2026-08-22.

BUILD.md listed "end-to-end latency for a fresh tx" as `[U] Must be measured (Phase 0, measure-latency.ts)`. Now measured: **~8–10 minutes broadcast → usable evidence**, of which **97–99% is attestation**. `verify()` at the precompile is **0.8s**.

Full numbers and method in `docs/LATENCY.md`; reasoning in DECISIONS D-044.

Gas remains unmeasured and still requires a deployment.

---

### K-017 · `forge script` cannot execute against Creditcoin

**Class:** DOCUMENTATION/IMPLEMENTATION MISMATCH (tooling vs chain). **Status:** routed around.

`forge script` fails on this chain during both simulation and execution:

```
EVM error; header validation error: `prevrandao` not set
```

Creditcoin's block headers omit the post-merge `prevrandao` field that Foundry's local EVM requires under `evm_version = cancun`. `--skip-simulation` does not help, because the failure is in script *execution*, not simulation.

**Route-around:** deployed with `cast send --create`, then asserted on-chain every post-condition `Deploy.s.sol` would have checked — verifier is the real `0x…0FD2`, Clearbook points at the vault, sink is the burn address, economics read back correctly.

`Deploy.s.sol` and its unit tests remain the specification of a correct deployment and still pass in `forge test`; they simply cannot run against this chain. Worth reporting upstream alongside K-003/K-004.

---

### K-018 · Dedupe-before-verify makes forgery testing subtle

**Class:** not a defect — a property worth documenting. **Status:** understood, tested around.

`EvidenceVault` checks `exists[factId]` *before* calling the precompile. That ordering is correct and deliberate (it makes replay nearly free and the worker restart-safe), but it has a consequence for anyone testing forgery on-chain:

**If a forged bundle happens to compute a `factId` that is already stored, the vault returns early and never calls the precompile.** The submission succeeds, no forgery was tested, and a careless test would record it as "accepted".

Gate 7 part B avoids this by submitting mutations at a `logIndex` that yields an unstored `factId`. Any future forgery test must do the same.

---

### K-019 · Evidence discovery in the challenge console is bounded to a block window

**Class:** limitation, deliberate. **Status:** open, bounded, disclosed in the UI.

There is no indexer on Creditcoin CC3 and `EvidenceVault` keeps no enumerable list of facts, so the challenge console discovers citable evidence by reading `TransferFactStored` logs over a fixed lookback (`VAULT_LOOKBACK_BLOCKS`, currently 20,000 blocks — roughly three days at observed block times).

**Consequence:** a fact ingested before that window will not appear in the list. It remains fully citable by pasting its identifier, and `challenge()` is unaffected — the bound limits *discovery convenience*, never what a challenger is permitted to do or what the contract will accept.

**Measured:** 5,000-block span ≈ 0.85 s; 20,000-block span ≈ 4.5 s against the public RPC. Wider spans were not adopted because the cost grows roughly linearly and the screen would stall.

**Fix, if it mattered:** record the vault's deployment block and page backwards from it, or add an enumerable index to the vault. Neither is worth a redeploy for a demo whose evidence is seeded fresh.

