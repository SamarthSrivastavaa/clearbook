# DECISIONS.md

Append-only log of architectural decisions and resolved assumptions.
Evidence classes (BUILD.md §1): **[P]** primary doc · **[C]** source-code verified · **[L]** live verified · **[I]** inference · **[U]** unverified · **[B]** blocked.

Every entry records: the decision, its evidence, and what would reverse it.

---

## Phase 0 — 2026-08-20

### D-001 · Toolchain versions in use — [L]

| Tool | Version |
|---|---|
| Node | v24.15.0 |
| npm | 11.12.1 |
| git | 2.49.0.windows.1 |
| forge / cast | 1.2.3-stable (`a813a2c`, 2025-06-08) |

Foundry is installed and available; Phase 1 does not need to bootstrap it.
**Reverses if:** a dependency requires a Node/forge version this toolchain cannot satisfy.

---

### D-002 · Pinned dependency versions exist and are the latest published — [L]

`npm view` on 2026-08-20 returned:

- `@gluwa/usc-sdk`: latest published is **0.18.0** — the version BUILD.md pins.
- `@gluwa/usc-contracts`: latest published is **0.2.0** — the version BUILD.md pins.

Installed exactly (`npm i -E`): `@gluwa/usc-sdk@0.18.0`, `@gluwa/usc-contracts@0.2.0`, `ethers@6.17.0`, `dotenv@17.4.2`, `tsx@4.23.12`, `typescript@7.0.2`, `@types/node@26.2.0`.

There is no version drift between BUILD.md's pins and the registry.
**Reverses if:** upstream publishes a newer version with breaking changes we need.

---

### D-003 · GATE 0 PASSED — source chain keys resolved from live chain state — [L]

Run: `npm run gate0` → `integration/results/gate0-2026-08-20T14-01-21-122Z.json`

Creditcoin CC3 testnet, `eth_chainId` = **102031**, block 5343127.
`PrecompileChainInfoProvider.getSupportedChains()` against the ChainInfo precompile
`0x0000000000000000000000000000000000000fd3` returned exactly two chains:

| chainKey | chainId | Chain (per EIP-155 registry) | genesis height | attesting |
|---|---|---|---|---|
| **1** | 11155111 | Ethereum Sepolia | 0 | yes |
| **3** | 1 | Ethereum Mainnet | 0 | yes |

**This resolves the `[U]` in BUILD.md §1.2.** The documentation's numbering (CC3 Testnet = Sepolia `chainKey 1`, Ethereum Mainnet `chainKey 3`) is **confirmed correct against live chain state**. The contradicting SDK doc-comment example (which shows `chainKey: 1, chainId: 1, chainName: 'Ethereum Mainnet'`) is **wrong** and is illustrative only.

**Ethereum Mainnet IS present.** The BUILD.md §14 fallback "Mainnet absent → use Sepolia, delete every mainnet reference from the pitch" **does not apply**.

Chain keys are resolved at runtime in every script via `resolveChainKey(info, chainId)`. **No chain key is hardcoded anywhere.**
**Reverses if:** the attestor set reconfigures its supported chains.

---

### D-004 · Resolve chains by `chainId`, never by `chainName` — [C]

`@gluwa/usc-sdk@0.18.0` `src/chain-info/index.ts:175` carries an upstream defect, in its own words:

```
chainName: chainEntry[2], // TODO: Name decoding seems to be failing, investigate (you get all zeros currently)
```

Confirmed live: `chainName` came back unusable in Gate 0.

**Decision:** all chain resolution keys off the numeric `chainId` (an EIP-155 value), never `chainName`. Human-readable names are attached from the public EIP-155 registry for display only, and the raw on-chain value is always reported alongside so nothing is hidden.
**Reverses if:** upstream fixes name decoding — even then, `chainId` remains the more robust key.

---

### D-005 · Gate 0's 60-second advance test is necessary but not sufficient — methodology correction — [L]

BUILD.md's Gate 0 criterion 3 asks that the attested height advance on a second run 60 seconds later.

On the first run, **Sepolia (`chainKey 1`) appeared STALLED**: `11529470 → 11529470`, delta 0, while Mainnet advanced +10. Taken at face value this would have condemned the project's chosen source chain.

It was a **sampling artifact**, not a stall. A 7-sample / 6-minute observation
(`integration/gate0-lag.ts` → `results/gate0-lag-2026-08-20T14-11-37-200Z.json`) shows:

| chainKey | chainId | attested over 6 min | advance | lag vs source head |
|---|---|---|---|---|
| 1 | 11155111 (Sepolia) | 11529490 → 11529520 | **+30** | 36–41 blocks, stable |
| 3 | 1 (Mainnet) | 25796770 → 25796800 | **+30** | not measured |

**Attestation is granted in batches of exactly 10 blocks, roughly every 2 minutes.** A 60-second window can therefore legitimately observe zero advance on a perfectly healthy chain.

Sepolia's lag oscillates between 36 and 41 blocks (~7–8 minutes) and is **not growing** — consistent with BUILD.md §1.2's `[P]` claim that attestors attest *finalized* blocks (Ethereum finality ≈ 64 blocks / ~12.8 min).

**Decision:** Gate 0's 60s check is retained as a fast smoke test, but a non-advancing result must be escalated to the longer `gate0-lag.ts` observation before any chain is declared stalled. Both chains PASS criterion 3 under correct measurement.
**Reverses if:** the observed lag begins growing monotonically, which would indicate a genuine attestor stall.

---

### D-006 · Source chain for Clearbook is Ethereum Sepolia (`chainKey 1`) — [L]

Both supported chains are live and attesting, so this is a genuine choice rather than a forced one.

**Chosen: Sepolia.** Reasons:
1. BUILD.md §7 and §13 require us to *stage our own* source-chain transactions from throwaway wallets. On Mainnet that costs real ETH; on Sepolia it is free.
2. The hackathon mandates a testnet deployment (BUILD.md §1.1).
3. Attestation lag is stable and short (36–41 blocks), so staged transactions become provable within ~8 minutes.

Mainnet (`chainKey 3`) remains available and is a legitimate, honest talking point: the same `EvidenceVault` code path works against it with **no change**, because the chain key is a runtime parameter. We will not claim to have used it unless we actually do.
**Reverses if:** Sepolia attestation degrades, or a demo requirement makes mainnet evidence necessary.

---

### D-007 · `@gluwa/usc-contracts` decoder import path — MISMATCH CONFIRMED — [C]

BUILD.md §1.3 predicted this and it is confirmed by reading the installed package.

- The official `USCMinter.sol` imports `@gluwa/usc-contracts/contracts/decoding/EvmV1Decoder.sol`.
- In `@gluwa/usc-contracts@0.2.0` **`contracts/decoding/` does not exist.**
- The file actually ships at **`contracts/write-ability/common/EvmV1Decoder.sol`**.
- The package's `files` field publishes only `contracts/write-ability/**/*.sol`, so no other path can ever resolve.

**Decision:** import from the real path and set the forge remapping BUILD.md specifies. Report upstream in `#buidl-ctc-qna`.
**Reverses if:** upstream republishes with the documented path.

---

### D-008 · TWO different `INativeQueryVerifier.sol` ship in one package — use `common/` — [C]

Not recorded in BUILD.md; discovered by inspection. `@gluwa/usc-contracts@0.2.0` contains two files with the same name and **materially different contents** (SHA-256 differs):

| Path | pragma | Contents |
|---|---|---|
| `contracts/write-ability/INativeQueryVerifier.sol` | `^0.8.20` | **Lean vendored copy.** Structs + the single-query view `verify` only. Its own docstring: *"only the structs and the single-query view `verify` used by the write-ability AcknowledgmentValidator"*. **No `verifyAndEmit`, no batch overloads, no `calculateTxIndex`, no `TransactionVerified` event.** |
| `contracts/write-ability/common/INativeQueryVerifier.sol` | `^0.8.28` | **Full interface.** `verifyAndEmit` (single + batch), `verify` (single + batch), `calculateTxIndex`, the `TransactionVerified` event, and `NativeQueryVerifierLib`. |

This is a live footgun: importing the shorter path compiles fine and silently deprives `EvidenceVault` of `verifyAndEmit` and `calculateTxIndex` — the two calls the whole design depends on.

**Decision:** `EvidenceVault` imports **`contracts/write-ability/common/INativeQueryVerifier.sol`** and nothing else. This matches BUILD.md Phase 1's instruction; the reason is now evidenced rather than assumed. Add a Phase 2 build assertion that `verifyAndEmit` and `calculateTxIndex` resolve.

Every `[C]` claim in BUILD.md §1.2 about the verifier interface was checked against this file and is **correct as written**.
**Reverses if:** upstream deduplicates the two files.

---

### D-009 · GATES 2 + 3 PASSED — the prover serves ordinary third-party transactions — [L]

This is the finding that de-risks the project most, and it resolves BUILD.md §14's Gate-2 pivot risk **negatively — no pivot is needed.**

BUILD.md §14 warned: if `getProof` fails on a transaction that demonstrably exists, *"the prover may index only registered contracts"*, forcing a pivot to deploying `EvidenceEmitter.sol` on the source chain — which would have destroyed the central differentiator ("we deploy nothing on the source chain").

**It does not.** Two arbitrary third-party Sepolia transactions — neither created by us, involving tokens and contracts we do not control — were proven and verified end-to-end:

| | Transaction A | Transaction B |
|---|---|---|
| txHash | `0xc5e1086751fed6419e37c0e223e911cd4c31ace0e20713ad91ac1e5fa44d84f1` | `0xad4d54d5cc86475462ec59d340ec5e91dcc354d834fca986ea7c2b0922c2657d` |
| block | 11529467 | 11529477 |
| txIndex (from precompile) | 4 | 1 |
| tx type | 2 | 2 |
| logs in receipt | 17 | 30 |
| `getProof` | success (881 ms) | success |
| `verify()` @ `0x0FD2` | **true** (1168 ms) | **true** (1091 ms) |
| cross-checks vs source RPC | **11/11 PASS** | **11/11 PASS** |

Full records: `integration/results/gate2-gate3-0xc5e10867.json`, `gate2-gate3-0xad4d54d5.json`.

**Decision:** the architecture stands as specified in BUILD.md. Clearbook deploys nothing on the source chain.
**Reverses if:** the prover later refuses transactions for tokens we do not control — retest before relying on this.

---

### D-010 · The off-chain receipt decoder is a cross-check only, never a trust path — [C]

`integration/lib/decode-receipt.ts` reimplements `EvmV1Decoder.decodeReceiptFields` in TypeScript so Phase 0 can cross-check decoded values before any contract is deployed.

Its layout was derived by reading **both sides** of the protocol, not by guessing:
- encoder — `@gluwa/usc-sdk/src/encoding/abi/v1.ts`: `abi.encode(['uint8','bytes[]'], [txType, chunks])`
- decoder — `EvmV1Decoder.sol` `_decodeReceiptChunk`: `receiptIdx = (txType <= 2) ? 2 : 3`
- receipt chunk types: `['uint8','uint64','tuple(address,bytes32[],bytes)[]','bytes']`

BUILD.md §1.2's `[C]` claim that receipt decode supports tx types 0–4 with `receiptIdx = txType <= 2 ? 2 : 3` is **confirmed** by reading the source.

**Decision:** this file is explicitly non-authoritative and is banned from the production trust path. The authoritative decode is the Solidity one inside `EvidenceVault` (Gate 4). The file carries a header saying so.
**Reverses if:** never — if the two ever disagree, the Solidity decoder is right by definition.

---

### D-011 · ERC-20 `Transfer` topic0 independently verified — [L]

BUILD.md §1.2 lists `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef` as `[C]` (from an SDK smoke test). Verified independently rather than copied:

```
$ cast keccak "Transfer(address,address,uint256)"
0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
```

Matches. Promoted `[C]` → `[L]`.

---

### D-012 · Transaction-local vs block-global `logIndex` — confirmed distinct in live data — [L]

BUILD.md §3.1/§3.2 requires `logIndex` to be the index within `ReceiptFields.receiptLogs` (**transaction-local**), not the block-global index that `eth_getLogs` returns. If these were conflated, `factId` would be computed over the wrong value.

Live Sepolia data confirms they differ routinely — from `results/gate1-candidates.json`:

| txHash | transaction-local logIndex | block-global logIndex |
|---|---|---|
| `0xc5e10867…` | 1 | 3 |
| `0xb38e285f…` | 0 | 19 |
| `0x62112a75…` | 1 | 21 |
| `0x03f47dfa…` | 0 | 23 |

`gate1-evidence.ts` derives the transaction-local index by locating the log's position inside the receipt's own log array. The proven Transaction A receipt carried **17 logs** and Transaction B **30** — real multi-log transactions, which is exactly the case that makes BUILD.md §3.2's log-level replay key (rather than the reference implementation's transaction-level key) necessary.

---

### D-013 · Source-chain RPC endpoint — discovered, not invented — [C]

BUILD.md §7 forbids inventing addresses and endpoints. `SOURCE_CHAIN_RPC_URL` is set to
**`https://sepolia-proxy-rpc.creditcoin.network`**, taken from `@gluwa/usc-sdk@0.18.0`
`tests/smoke/query.builder.test.ts` — a Creditcoin-operated Sepolia RPC used by the SDK's own smoke tests.

Verified live: `cast chain-id` → `11155111`, `cast block-number` → 11529520.

Likewise `CREDITCOIN_RPC_URL` (`https://rpc.cc3-testnet.creditcoin.network`) comes from the SDK's `tests/globalSetup.ts`, and `PROOF_BUILDER_URL` (`https://prover.cc3-testnet.creditcoin.network`) from the SDK's `ProofBuilder`/`PrecompileBlockProver` doc examples. All three match BUILD.md §10.

**No `SOURCE_TOKEN_ADDRESS` has been committed yet** — the Phase 0 experiment used tokens discovered live per transaction. A demo token will be chosen and recorded with an explorer link before Phase 12.

---

### D-014 · Environment variable naming differs from the official SDK examples — [C]

The SDK's own `examples/*.ts` read **`CREDITCOIN_PROOF_BUILDER_URL`**; BUILD.md §10 specifies **`PROOF_BUILDER_URL`**.

**Decision:** follow BUILD.md, which is the source of truth for this repository. Noted so that anyone copying an official example knows why the name differs.

---

### D-015 · `verifyAndEmit` revert-vs-return-false is still UNRESOLVED — [U]

BUILD.md §1.3 records a documentation/implementation mismatch: SDK docs say the precompile *reverts* on failed verification, while `USCBase` does `require(verified, ...)` on a returned bool. The lean vendored interface (D-008) also states *"Reverts on failure, returns true on success"*.

Phase 0 only ever observed the **success** path (`verify()` → `true`). **The failure path has not been exercised.** This remains `[U]` and is deliberately not resolved here — BUILD.md assigns it to Phase 11 / Gate 7 (`gate7-forged.ts`, six mutations).

**Decision:** `EvidenceVault` keeps the `require(ok)` on the returned bool regardless of the answer, so that both possible behaviours terminate the transaction. Fail-closed either way.

---

### D-017 · `evm_version = "cancun"` — determined from live chain behaviour — [L]

BUILD.md Phase 1 says to "set `solc = 0.8.28` and `evm_version` in foundry.toml" but does not say **which** EVM version. Guessing is a deploy-time failure waiting to happen: contracts compile locally and revert on deployment if the chain lacks an opcode.

Resolved empirically with `integration/gate1a-evm-capabilities.ts`, which executes candidate opcodes via `eth_call` with no `to` address (the node runs the payload as creation code). Costs nothing and needs no funded account. A control probe (`STOP`) runs first, so a failure can never be misread as "the node rejects creation-code calls".

Result on CC3 testnet (`chainId 102031`):

| Opcode | Introduced | Result |
|---|---|---|
| `PUSH0` (0x5f) | Shanghai | SUPPORTED |
| `MCOPY` (0x5e) | Cancun | SUPPORTED |
| `TSTORE` (0x5d) | Cancun | SUPPORTED |
| `TLOAD` (0x5c) | Cancun | SUPPORTED |

**Decision:** `evm_version = "cancun"` — which is also solc 0.8.28's default, so the setting is explicit rather than load-bearing. Recording it means a future solc default change cannot silently move us.
**Reverses if:** CC3 downgrades its EVM, or a mainnet deployment targets a chain with narrower support — rerun the probe against that chain.

---

### D-018 · `via_ir = true` is REQUIRED by the official decoder, not a preference — [L]

Not anticipated by BUILD.md. The first `forge build` of the Gate 1a probe **failed**:

```
Error: Compiler error: Stack too deep. Try compiling with `--via-ir` ...
When compiling inline assembly: Variable headStart is 3 slot(s) too deep inside the stack.
```

Cause: `EvmV1Decoder`'s nested dynamic structs (`ReceiptFields` → `LogEntry[]` → `bytes32[]` / `bytes`) overflow the legacy code generator's stack when ABI-encoded. The library's own header comment says its chunked layout exists "to avoid stack too deep issues" — chunking mitigates it but does not eliminate it at the ABI boundary.

**Decision:** `via_ir = true` in `foundry.toml`, the fix the compiler itself recommends. With it, the build succeeds. This is a **hard requirement for any contract that decodes receipts**, so it applies to `EvidenceVault` in Phase 2, not just the probe.

Consequences to carry forward:
- Compilation is slower; acceptable.
- `via_ir` changes codegen, so gas figures must be measured under this exact setting (BUILD.md §16 requires measured, not quoted, gas).
- Bytecode verification on the explorer must use identical settings — recorded in `DEPLOYMENT.md`.

**Reverses if:** upstream restructures the decoder to stay within legacy stack limits.

---

### D-019 · `forge-std` pinned to v1.16.2 as a git submodule — [L]

`forge init --no-git contracts` vendored forge-std as **plain files with its `.git` stripped** — no version pin, no submodule, ~70 files of third-party code unpinned in our tree. `git -C contracts/lib/forge-std rev-parse HEAD` returned *our* repo's HEAD, confirming it was not a repository at all.

That violates BUILD.md's reproducibility rule (18) and pinning rule (19).

**Decision:** removed the vendored copy and reinstalled with `forge install foundry-rs/forge-std@v1.16.2` from inside `contracts/`, which registers a proper submodule pinned to that tag and creates `.gitmodules`. Version chosen by reading the vendored copy's `package.json` (1.16.2), so the pin matches what forge selected rather than an arbitrary newer tag.

**Clean-clone note:** `git clone --recurse-submodules` (or `git submodule update --init`) is now required before `forge build`. Recorded in `DEPLOYMENT.md`.
**Reverses if:** the project moves to Foundry's dependency manager (`soldeer`) instead of submodules.

---

### D-020 · Remapping needs `../` — BUILD.md's path assumes a different layout — [C]

BUILD.md §10 specifies:

```
@gluwa/usc-contracts/=node_modules/@gluwa/usc-contracts/
```

That resolves only if `node_modules` sits **inside** the Foundry project. In this repository `node_modules` is at the **repo root** and the Foundry project is `contracts/`, one level down. Foundry resolves remappings relative to the project root, so the documented path cannot resolve.

**Decision:** `contracts/remappings.txt` uses `../node_modules/@gluwa/usc-contracts/`, plus `allow_paths = ["../node_modules"]` in `foundry.toml` so solc may read outside the project root. Verified by a successful build.

The alternative — a second `npm install` inside `contracts/` — was rejected: it would duplicate the dependency and create two versions that can drift, defeating D-002's pinning.
**Reverses if:** the repository is restructured so the Foundry project is the root.

---

### D-021 · GATE 1a PASSED — full protocol API verified at compile time — [L]

`contracts/src/Gate1aProbe.sol` is a throwaway that imports both real package paths and **references every API BUILD.md depends on**, so the gate is an interface contract test rather than a bare import check. `forge build` → *Compiler run successful*; artifact carries all six functions and 4 KB of deployed bytecode.

Proven by successful compilation:
- `NativeQueryVerifierLib.PRECOMPILE` exists and the probe asserts it equals `0x…0FD2`.
- **`INativeQueryVerifier.calculateTxIndex.selector` compiles** — this is the decisive one. It resolves only against `common/INativeQueryVerifier.sol`; had the remapping picked up the lean copy (D-008), this line would fail. Both `verifyAndEmit` overloads and both `verify` overloads are likewise referenced.
- Struct shapes `MerkleProof` / `MerkleProofEntry` / `ContinuityProof` construct exactly as BUILD.md §5.1 builds them.
- Decoder entry points `getTransactionType`, `isValidTransactionType`, `decodeReceiptFields`, `decodeCommonTxFields`, `getLogsByEventSignature` all resolve, and `ReceiptFields` / `LogEntry` have the fields BUILD.md §1.2 claims.

Every `[C]` claim in BUILD.md §1.2 about the verifier and decoder APIs is now additionally confirmed by compilation.

**Still unproven here:** that the decoder produces *correct values on real data*. Gate 1a is compile-time only. The Solidity decode path is validated against real `txBytes` at Gate 4; Phase 0's `[L]` decode evidence came from the TypeScript mirror (D-010), which is not the same code.
**Reverses if:** upstream changes any of these signatures — the build breaks loudly here, which is the point.

---

### D-022 · `challenge()` requires `REPAYMENT_CLAIMED` — resolving a contradiction inside BUILD.md — [P]

**BUILD.md contradicts itself** about which loan states are challengeable.

| Source | Says |
|---|---|
| §4.2 state diagram | `REGISTERED --> BREACHED: challenge() valid` |
| §4.2 transition table | `REGISTERED`/`REPAYMENT_CLAIMED` → `BREACHED` |
| §5.3 "the predicate, exactly", condition 1 | `L.status == REPAYMENT_CLAIMED` |

**Resolved in favour of §5.3**, for a reason stronger than it being the more specific text: the predicate is *structurally impossible* on a `REGISTERED` loan. It begins `R = vault.getFact(L.repaymentFactId)`, and a `REGISTERED` loan has `repaymentFactId == bytes32(0)`, so the vault reverts `UnknownFact`. A covenant about repayment cannot be evaluated before a repayment is claimed.

So `challenge()` reverts `WrongStatus` unless the loan is `REPAYMENT_CLAIMED`. §4.2's diagram and table are loose summaries; §5.3 is the specification.

**Recommended BUILD.md correction:** delete the `REGISTERED --> BREACHED` edge from the §4.2 diagram and drop `REGISTERED` from that transition table row.
**Reverses if:** a future covenant is defined over disbursement evidence alone — that would be a *new* covenant with its own predicate, not a change to `0x01`.

---

### D-023 · The eleven conditions revert with named errors, not a single `NoBreach` — [P]

Second contradiction. §5.2's function table lists `challenge()`'s errors as `NoBreach`, `WindowClosed`, `WrongStatus`. But §5.3 assigns a **distinct named error to each of conditions 3–11** (`ChainMismatch`, `TokenMismatch`, `NotTheSamePayer`, `FundingNotFromBoundTreasury`, `FundingBelowRepayment`, `FundingNotBefore`, `OutsideWindow`, `SameFact`, `DisbursementNotFunding`).

**Resolved in favour of §5.3's granular errors**, and `NoBreach` is deliberately **not declared** — it would be unreachable, and BUILD.md §5 forbids extra surface. Three reasons:

1. §5.3 is labelled "the predicate, exactly".
2. §12 requires the challenge console to show **each of the eleven conditions as pass/fail before the wallet opens**. A single opaque `NoBreach` cannot drive that UI; the granular errors map one-to-one onto it.
3. §12 also requires that "a judge must never see a raw revert blob" — a named condition is exactly the human-readable outcome that demands.

**Consequence for the demo, and it is a real one:** §13.1 says scenario A (the honest loan) "reverts `NoBreach`". It will now revert **`FundingNotFromBoundTreasury`** — because scenario A's borrower was funded from an unrelated faucet, so condition 6 is what actually fails. That is a *better* demo beat, since it names the precise reason the honest loan is unbreachable rather than saying "no". `DEMO.md` must be updated to match before recording; it currently still quotes `NoBreach`.

Note this makes §13.1's scenarios A and C revert with the *same* error. They remain distinct scenarios — A cites a genuine unrelated funding source, C cites an unrelated transfer — but the demo narration should not present the error name as what distinguishes them.

---

### D-024 · Two economic parameters BUILD.md never specifies — chosen and flagged — [I]

`REPAYMENT_BPS` is referenced by §4.2, §5.2 and threat T19 (`amount >= principal * repaymentBps / 10000`) but **given no value anywhere** — §4.4's parameter table omits it. `MIN_BOND` is likewise referenced by `registerOriginator`'s validation with no value.

Chosen, and marked `[I]` because they are inference rather than specification:

| Constant | Value | Reasoning |
|---|---|---|
| `REPAYMENT_BPS` | `10_000` (100%) | A "repayment" that does not at least cover principal should not settle a loan. Any lower value silently permits partial repayment to close a loan, which would weaken the claim being made. 100% is the conservative reading. |
| `MIN_BOND` | `1 ether` (= `BOND_PER_LOAN`) | Below one `BOND_PER_LOAN` an originator could register while unable to back a single loan. Equality is the smallest coherent floor. |

Both are `public constant`, so they are readable on-chain and cannot be changed by anyone — consistent with the no-admin design.
**Reverses if:** BUILD.md is amended with explicit values, or partial repayment becomes a product requirement (which would need its own covenant, since it changes what a claim asserts).

---

### D-025 · OpenZeppelin 5.1.0 used for ECDSA / EIP-712 / ReentrancyGuard — [C]

§5 says "no libraries beyond the official decoder and one internal covenant library". Taken literally that forbids OpenZeppelin — but the same document *requires* what only OpenZeppelin safely provides: §5.2 specifies EIP-712 `TreasuryBinding` with `ECDSA.recover`, and §6 T14 mandates `ReentrancyGuard` on `challenge` and `withdrawBond`.

**Decision: use OpenZeppelin**, reading §5's sentence as a prohibition on *architectural* dependencies (proxies, upgradeability, admin frameworks) rather than on standard cryptographic primitives it elsewhere names by their OpenZeppelin identifiers.

Hand-rolling ECDSA recovery would mean hand-rolling signature-malleability rejection (EIP-2098 / low-s enforcement) in a function that binds a treasury address — the single place where a signature flaw would be most damaging. Writing that ourselves to satisfy a style rule would be trading real security for nominal compliance, which BUILD.md's own security rule forbids.

Pinned to **5.1.0 exactly** — the version `@gluwa/usc-contracts@0.2.0` already depends on — and added as a **direct** dependency so we do not rely on a transitive one that could vanish. npm dedupes to a single copy, so there is no risk of two OZ versions in the tree.

Used: `utils/cryptography/ECDSA.sol`, `utils/cryptography/EIP712.sol`, `utils/ReentrancyGuard.sol`. Nothing else. No `Ownable`, no `AccessControl`, no proxy — those would contradict the trust model.

---

### D-026 · Struct field order follows the spec, not the gas linter — [P]

solhint's `gas-struct-packing` flags `Loan` as inefficiently packed. It is right: reordering would save a slot.

**Kept as specified.** BUILD.md §3.1 and §5.2 give exact field orders, and `TransferFact`'s layout is part of the evidence model that `SECURITY.md`'s provenance table documents field-by-field. Silent reordering would desynchronise the code from the specification and from the security documentation for a marginal gas saving on a testnet.

Rule disabled in `.solhint.json` with this reasoning rather than left as recurring noise. Revisit only if a gas measurement (Phase 12) shows it matters.

---

### D-027 · Toolchain configuration: `line_length = 118`, and which lint rules are off — [L]

**Formatter/linter conflict.** At `line_length = 120`, `forge fmt` emitted a 121-character line that `solhint`'s `max-line-length` (120) then rejected — the two tools count slightly differently, so a "formatted" file failed lint. Setting `forge fmt` to **118** makes both agree, so the two tools can never fight.

**Disabled solhint rules, each deliberate:**

| Rule | Why off |
|---|---|
| `use-natspec` | Demands `@author` on every contract and `@notice` on every constant and parameter — ~100 warnings of ceremony. We document with `@notice`/`@dev` where it carries meaning. |
| `gas-struct-packing` | See D-026 — spec fidelity wins. |
| `gas-strict-inequalities` | The `>=` / `<=` operators mirror §5.3's predicate wording exactly. Rewriting them to save gas invites off-by-one errors in financial comparisons. |
| `gas-indexed-events`, `gas-small-strings`, `gas-increment-by-one`, `gas-length-in-loops`, `gas-multitoken1155`, `gas-calldata-parameters` | Micro-gas suggestions; the EIP-712 typehash string in particular must stay byte-exact. |
| `avoid-low-level-calls` | `call{value:}` with a checked return is the *required* pattern here — T23 explicitly forbids `transfer()`/`send()`. |
| `ordering`, `one-contract-per-file` | Layout preferences. |

**Kept on, and passing:** `reentrancy`, `avoid-tx-origin`, `check-send-result`, `gas-custom-errors`, `compiler-version` (pinned `0.8.28`), `max-line-length`, `func-visibility`, `no-empty-blocks`, `use-forbidden-name`.

`use-forbidden-name` caught something worth fixing rather than silencing: locals named `l` and `o`. In financial state transitions, `l.status` versus `loan.status` is a real readability difference, so they were renamed to `loan`, `orig` and `fact`.

**Gate 2 result:** `forge build` clean, `forge fmt --check` clean, `solhint` **exit 0 with zero problems**.

---

### D-028 · GATE 3 PASSED — 100% line coverage of `src/`, and `forge coverage` needs `--ir-minimum` — [L]

**Gate 3 result:** 73 tests pass, and line coverage of `src/` is **100%**, against the required ≥90%.

| File | Lines | Statements | Branches | Funcs |
|---|---|---|---|---|
| `src/Clearbook.sol` | **100.00% (110/110)** | 94.38% | 75.61% | 100.00% |
| `src/EvidenceVault.sol` | **100.00% (33/33)** | 100.00% | 100.00% | 100.00% |
| `src/libraries/CovenantLib.sol` | **100.00% (8/8)** | 100.00% | 100.00% | 100.00% |

`src/interfaces/IEvidenceVault.sol` has no executable lines. The tool's 39.34% *total* is dominated by untouched OpenZeppelin and gluwa dependency code, which the gate explicitly does not cover ("90% of lines in `src/`").

**Tooling consequence, and it is not optional.** `forge coverage` disables `via_ir` to keep source mappings accurate — which reintroduces exactly the "Stack too deep" failure D-018 documents, this time at `EvidenceVault.sol:72`. Plain `forge coverage` therefore **cannot compile this project**. The command is:

```
forge coverage --ir-minimum --report summary
```

Recorded in `Makefile`, `TESTING.md` and `DEPLOYMENT.md` so nobody rediscovers it under deadline. Note forge's own caveat that `--ir-minimum` can produce less accurate source mappings; the 100% line result should be read with that in mind, which is why the named behavioural tests, not the percentage, are the real evidence.

**Branch coverage of `Clearbook.sol` is 75.61%**, below line coverage. The uncovered branches are predominantly compound-condition short-circuits already exercised from one side. Recorded in `TESTING.md` rather than papered over; Gate 3's criterion is lines.

---

### D-029 · Invariant suites can pass vacuously — a reachability test now guards against it — [L]

This nearly shipped as a silent hole, and the process that caught it is worth recording.

The five invariants passed immediately: 64 runs × 64 calls, **zero reverts**. That looked good and was misleading. Zero reverts across 4096 calls is suspicious in a system with this many guards, so I added a temporary "canary" invariant asserting the *opposite* of what should be true — if the canary fails, the handler is genuinely building state.

The canary revealed the fuzzer was **never reaching `challenge()`**. Loans were registered and repayments claimed, but `actChallenge` picked a loan at random and almost never landed on one in `REPAYMENT_CLAIMED`. **I1 and I2 — the invariants that protect bond accounting under slashing — were holding over state where no slashing ever occurred.** They were true, and they proved nothing.

Two fixes:
1. `actChallenge` now **scans** for a challengeable loan instead of relying on a random pick.
2. A permanent test, `test_handler_reaches_a_breach`, drives the handler through register → loan → claim → challenge and asserts a slash actually happened. If the handler ever loses the ability to reach the mechanism, that test fails loudly instead of the invariants passing quietly.

**A methodological note for the remaining phases:** during this diagnosis several PowerShell `.Replace()` edits silently no-matched because of CRLF/LF differences, so ghost counters were never incremented and three rounds of measurements were meaningless. Structured file edits are used for Solidity from here on; shell string substitution is not reliable for this.

---

### D-030 · Demo token is canonical Sepolia WETH — the `MockUSD` fallback is NOT needed — [L]

BUILD.md §7 permits deploying `MockUSD.sol` **only** if no suitable pre-existing ERC-20 is available, and warns that if deployed, "the pitch must not claim third-party provenance". That would have cost the project its central architectural claim.

It is not needed. `0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9` on Sepolia, which appeared organically in our own Gate 1 scan of third-party transfers, verified live:

| Property | Value |
|---|---|
| `name()` | `Wrapped Ether` |
| `symbol()` | `WETH` |
| `decimals()` | 18 |
| `deposit()` selector `0xd0e30db0` | present in deployed bytecode |

Why this is the right choice:
1. **We deploy nothing on the source chain.** WETH9 is a canonical third-party contract we do not control and cannot modify — exactly the claim §0.3 Q14 and §13.2 rest on.
2. **We can obtain it for free.** `deposit()` wraps faucet ETH into WETH, so staging demo transfers needs no token faucet and no minting privileges.
3. **It emits a standard ERC-20 `Transfer`** with three topics and a 32-byte data field — the shape `EvidenceVault` requires.
4. It is already in real use on Sepolia, so the demo's staged transactions sit among genuine third-party traffic.

Recorded in `.env` as `SOURCE_TOKEN_ADDRESS`. Explorer: `https://sepolia.etherscan.io/address/0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9`.

**`contracts/src/fixtures/MockUSD.sol` will not be built.**
**Reverses if:** WETH's wrap path becomes unusable, in which case §7's fixture fallback applies and the pitch must be corrected accordingly.

---

### D-031 · `protocolSink` is the standard burn address — [P]

BUILD.md §4.4 specifies the non-bounty half of a slash goes to "`protocolSink` (a burn-like address set at deploy)". Set to `0x000000000000000000000000000000000000dEaD`, the conventional Ethereum burn sink: no known private key, so the value is provably unrecoverable by anyone including us.

This matters for the trust model. Routing the remainder to an address we control would make Clearbook look like it profits from slashing, which invites exactly the "who benefits?" objection the no-admin design exists to pre-empt. `Deploy.s.sol` refuses to deploy with an unset (zero) sink.

---

### D-032 · Deployment guards are unit-tested, not merely written — [L]

BUILD.md Phase 3 requires `Deploy.s.sol` to assert production uses `0x…0FD2`. A guard that only executes during a live broadcast is a guard nobody has ever verified, so the checks live in `DeployLib` — a library — and `test/Deploy.t.sol` exercises them:

- accepts the real precompile on all three Creditcoin chain ids (102030/102031/102032)
- **rejects a mock verifier** — the testability seam from D-003 must never reach production
- rejects Ethereum mainnet, Sepolia, and an arbitrary chain id
- rejects a zero `protocolSink`

`vm.expectRevert` needs the revert one call deeper than the cheatcode, and `internal` library functions inline into their caller, so the tests go through a small external `GuardHarness`. Worth noting because the first version of these tests failed with "call didn't revert at a lower depth than cheatcode call depth" — a passing-looking test that was actually testing nothing would have been the worse outcome.

`run()` additionally reads the deployed contracts back and asserts the vault, sink and verifier wiring, so a successful broadcast is self-verifying.

---

### D-033 · TypeScript pinned to 5.9.3 — but not for the reason I first thought — [L]

Downgraded from 7.0.2 to **5.9.3** while diagnosing K-013, on the hypothesis that TypeScript 7 had changed private-field variance checking. **That hypothesis was wrong** — the identical error reproduced on 5.9.3, and the real cause was the SDK's dual-package hazard.

Keeping 5.9.3 anyway, on a correct rationale rather than the original one: it matches `@gluwa/usc-sdk`'s own `devDependencies` (`typescript ^5.9.2`), so we typecheck against the same major the SDK is authored and built with. TypeScript 7 is a recent rewrite; matching upstream's toolchain is the conservative choice for a project whose main risk is integration mismatch.

**Reverses if:** a dependency needs TS 7 features, or the SDK moves to 7.x.

---

### D-034 · Worker built (Phase 8), Postgres via Docker on port 5433 — [L]

Worker implemented per BUILD.md §8: `discover` · `watch` · `prove` · `precheck` · `submit` · `db` · `log` · `health`, plus `main.ts` as the orchestrator. §8.1 defines `index.ts` as the *event projection* for the UI, so the entry point needed a separate name.

Two environment decisions:

**Postgres runs in Docker on port 5433, not 5432.** This machine already has a `postgresql-x64-17` service running on the default port whose credentials we do not have, and guessing at them is not an option. `docker-compose.yml` brings up a disposable `postgres:17-alpine` with the exact §8.2 schema, on a port that cannot collide with an existing install. `DATABASE_URL` in `.env` points at 5433.

**Docker Desktop must be running.** The CLI is installed but the engine was not up during this phase, so the schema has not yet been applied against a live database. The migration SQL is §8.2 verbatim and `db.ts` is written against it, but **the persistence layer is `[U]` until it runs**. It is not claimed as verified.

The design decision worth recording: the DB's `UNIQUE (chain_key, block_height, tx_index, log_index)` mirrors the on-chain `factId` exactly. That is what makes Gate 8a's restart safety a property rather than a hope — the vault is idempotent, this key is unique, and the cursor is persisted, so a crash at any point replays as a no-op.

`precheck.ts` carries an explicit warning that it is an **economy, not a security control**: it spends no gas to skip bundles that would revert, but the vault re-verifies through `verifyAndEmit` regardless. Deleting it would cost gas, not safety.

---

### D-035 · Batch path built with both protocol guards; stack pressure forced a refactor — [L]

`submitTransferFactsBatch` implemented per BUILD.md §5.1, with the two mandatory guards checked **before** the precompile call so an oversized batch fails cheaply:

- `heights.length <= MAX_BATCH_SIZE` (10) → `BatchTooLarge`
- `max(heights) - min(heights) <= MAX_BATCH_RANGE` (1000) → `BatchRangeExceeded`

Plus two guards BUILD.md does not name but which the signature makes reachable: `EmptyBatch` (a zero-length batch would make the min/max computation meaningless) and `BatchLengthMismatch` (four parallel arrays that must agree).

**Dedupe cannot precede verification in the batch path**, unlike the single path. The precompile verifies the batch as one unit, so filtering already-known items would change what is being proven. Known items are therefore re-verified and skipped at storage time — correct, marginally less efficient, and the reason the single path remains the right choice for repeat traffic. Documented in the function's own comment so nobody "optimises" it later.

**The refactor is load-bearing, not cosmetic.** The first implementation kept validation and the ingestion loop inline. That compiled fine under the production profile (`via_ir` with full optimization) and **broke `forge coverage`**:

```
Error: Yul exception: Variable _12 is 1 too deep in the stack
```

`forge coverage --ir-minimum` compiles with *minimum* optimization, and with six calldata parameters plus loop temporaries in one frame the IR pipeline ran out of stack. Splitting `_validateBatch` and `_ingestOne` into private functions cut the live-variable count and restored coverage.

This is a second-order consequence of D-018: because this project *must* use `via_ir`, the coverage path is a genuinely different compilation profile, and code can pass `forge build` while making `forge coverage` impossible. Worth watching whenever a function with many calldata parameters is added.

**Result:** `EvidenceVault.sol` reaches **100% lines (57/57), 100% branches (15/15), 100% functions (9/9)**; 92 tests pass overall. Coverage of `src/` is unchanged at 100% lines.

---

### D-036 · Frontend stack and design language — [L]

Next.js 16 (app router) + wagmi 3 / viem 2 + Tailwind 4, per BUILD.md §12. Scaffolded by hand with pinned versions rather than `create-next-app`, so nothing arrives that we did not choose.

**Only an injected wallet connector.** WalletConnect would add a large dependency and a relay hop; the demo runs in a desktop browser with an extension, and fewer moving parts is worth more than more wallet options.

**The design language is a ledger, not a dashboard.** Concretely: hairline rules instead of cards, near-zero radii, IBM Plex Sans/Mono instead of the framework default, and a warm paper/ink palette rather than the cold slate every template lands on. Status is rendered as a rule and a word, never a pill. Colour is reserved strictly for protocol meaning — `verified`, `breach`, `pending`, `inert` — and is never decorative. Tabular lining numerals everywhere, because every figure in this product exists to be compared with another figure.

The chrome is a thin instrument bar rather than a sidebar. A sidebar reads as an admin template; a status bar keeps the chain, the block height and both contract addresses permanently in view, which is the product's whole claim.

**Reverses if:** BUILD.md's frontend requirements change, or a second wallet becomes necessary for judging.

---

### D-037 · Preview fixtures, and the disclosure rules around them — [I]

The contracts are written and tested but not deployed, so three of the four screens could not be designed or reviewed against an empty chain. BUILD.md §13 permits demo fixtures; the brief requires they be explicit, labelled, deterministic, and clear about origin.

`NEXT_PUBLIC_PREVIEW=true` renders `lib/fixtures.ts`. What is real in it: canonical Sepolia WETH, the actual throwaway wallet addresses generated for this project, and fact identifiers computed with the same `keccak256(abi.encode(...))` the vault uses, so they are internally consistent. What is not real: the transfers. No proof was submitted, no bond posted, no loan exists.

Three rules enforced in code:
1. An undismissable banner on every screen using fixtures says exactly that.
2. **Submission is disabled, never simulated.** The challenge button is inert without a deployment, and the UI says so rather than faking a success state.
3. The economic consequence is labelled **projected** and computed from the contract's own parameters — arithmetic, not a result.

`lib/data.ts` is the single seam between chain and fixture, so pages never branch on preview themselves and there is exactly one place where illustrative data can enter.

**Reverses if:** the demo is seeded (BUILD.md §13.1), at which point preview mode is switched off permanently and the scenarios become genuine staged transactions.

---

### D-038 · The proof builder needs a server-side proxy — [L]

The Attestcoin proof builder sends no CORS headers, so a browser cannot call it directly. Judge mode would have failed at demo time with an opaque network error.

`app/api/prover/route.ts` forwards exactly two read-only endpoints, mirroring the SDK's own `ApiClient` paths: `/api/v1/attested-height/{chainKey}` and `/api/v1/proof-by-tx/{chainKey}/{txHash}`. It holds no secrets, signs nothing, and adds no trust — the proof it returns is meaningless until the precompile verifies it. It also gives us a real timeout and a distinguishable `prover_unreachable` / `prover_timeout` failure, which the UI reports honestly instead of spinning.

The SDK itself is deliberately **not** a frontend dependency: the two REST paths are stable and known from reading its source, and adding a CommonJS SDK to an ESM app would reintroduce the K-013 dual-package hazard.

---

### D-039 · Unknown token decimals show a raw integer, never a guess — [P]

Decimals cannot be read from a `Transfer` log. Assuming 18 would print a confidently wrong number for any token that is not 18.

`lib/token.ts` holds a registry of tokens we have actually verified on-chain (currently only WETH). A known token renders as `2.5 WETH`; an unknown one renders the raw integer. In a product whose entire claim is that its figures are verified, a raw integer is honest and a wrongly-scaled decimal is not.

Caught during visual review: the loan table was printing `2500000000000000000`. The registry fixed it in both places at once.

---

### D-040 · The client-side dry run is a preview, never an authority — [L]

`lib/predicate.ts` mirrors the eleven conditions so a challenger sees pass/fail **before** a wallet opens. The contract re-evaluates all eleven on-chain regardless; if the two ever disagree, the chain is right and the mirror is a bug.

`frontend/scripts/check-predicate.ts` asserts the mirror against the BUILD.md §13.1 scenarios and **found a real defect**: `applyTreasuryBinding` recomputed `wouldSucceed` but left `projectedBounty` stale, so the console would have announced "all eleven conditions satisfied" and then shown no economic consequence. Condition 6 is unknown until that function runs, so the earlier projection is stale by construction. Fixed with a single `projectBounty` definition both call sites share.

`frontend/scripts/check-verify.ts` covers the other risk: judge mode calls the precompile through hand-written viem ABI tuples, which fail opaquely if shaped wrong. It runs the identical code against the third-party transaction from Phase 0 — `verify()` returned **true**, block 11529467, 7 Merkle siblings, 34 continuity roots. Both run from the repo root via `npm run check:predicate` and `npm run check:verify`.

---

### D-041 · GATE 7 (part A) PASSED — forged proofs rejected, and K-007 resolved: the precompile REVERTS — [L]

Run: `npx tsx integration/gate7-forged.ts` → `integration/results/gate7-forged-0xaaed6c4c.json`

A real verifying proof was mutated six ways and every mutation was rejected by the Block Prover precompile. The control — the unmutated bundle — verified first, so the rejections are meaningful rather than an artifact of a broken bundle.

| # | Mutation | Outcome | Precompile message |
|---|---|---|---|
| 1 | one Merkle sibling hash | REJECTED | `Merkle proof validation failed` |
| 2 | one continuity root | REJECTED | `Merkle root mismatch` |
| 3 | lower endpoint digest | REJECTED | `Continuity proof does not match attestation or checkpoint` |
| 4 | block height + 1 | REJECTED | `Continuity proof does not match attestation or checkpoint` |
| 5 | a Merkle `isLeft` flag | REJECTED | `Merkle proof validation failed` |
| 6 | one byte of `encodedTransaction` | REJECTED | `Merkle proof validation failed` |

**This resolves the documented mismatch in BUILD.md §1.3 and supersedes D-015.** The SDK documentation says the precompile *reverts* on failed verification; the reference `USCBase` instead does `require(verified, ...)` on a returned bool, implying it returns false. Observed live: **it reverts, 6 times out of 6, with a descriptive reason string.** The documentation is right; the reference implementation's bool check is defensive against a path these failure modes do not take.

**Scope of the claim, stated precisely.** This exercised the read-only `verify()` overload, because that needs no wallet and no deployment. `verifyAndEmit()` is the state-changing overload `EvidenceVault` actually calls, and it is *expected* to behave identically — but that is inference until part B runs against a deployed vault. The distinction is recorded rather than glossed.

**Implication for `EvidenceVault`.** Since the precompile reverts, our `if (!ok) revert ProofRejected();` will not fire for these mutation classes — the transaction dies inside the precompile call carrying the precompile's own message. The check stays: it costs nothing, and it is the only thing standing between us and a future firmware change that returns false instead. Fail-closed under both behaviours, which is exactly what `test_verifier_revert_also_fails_closed` asserts.

**Consequence for the UI:** a rejected proof surfaces the precompile's reason string rather than a Clearbook custom error. `decodeRevert` already handles that path via `reverted.reason`.

**Still outstanding for part B:** BUILD.md §16 requires six *failing Creditcoin transaction hashes* in the README. Those need a funded deployment; the security assertion itself is done.

---

### D-042 · Demo evidence staged and proven on Sepolia — K-008 closed — [L]

Sepolia funding arrived (Creditcoin did not — see D-043), which was enough to close the last open Phase 0 item and pre-warm the entire demo evidence set.

**Five transactions we created**, all ERC-20 `Transfer` events on canonical Sepolia WETH:

| Scenario | Role | Block | Transaction |
|---|---|---|---|
| A | disbursement | 11538664 | `0xd922115f…` |
| A | repayment | 11538692 | `0x8edc2d76…` |
| B | disbursement | 11538687 | `0x5329c4b5…` |
| B | **funding leg** | 11538688 | `0xca43a588…` |
| B | repayment | 11538689 | `0xcc02d3fe…` |

**5/5 proven and verified. 40/40 cross-checks passed.** Each was proven by the Attestcoin proof builder, verified by the precompile's `verify()`, decoded from the *proven* bytes, and cross-checked field by field against the source chain independently. Evidence: `demo/staged/proven-facts.json`.

This closes **K-008** without weakening anything: the token is a contract we do not control and cannot modify, so "we deploy nothing on the source chain" survives intact. We are an ordinary user of an ordinary token.

**Why scenario A is shaped as it is.** BUILD.md §13.1 describes A's borrower as funded by an unrelated faucet. We achieved the same property more economically: the borrower is *never separately funded in WETH at all*, so the only `treasury → borrower` transfer in existence is the disbursement itself — which condition 11 excludes. A challenge against A therefore reverts `DisbursementNotFunding` rather than `FundingNotFromBoundTreasury`. Both demonstrate the same thing (an honest loan is unbreachable) and both are honest failures; `DEMO.md` should name the actual error rather than the one §13.1 predicted.

**Staging is deliberately separate from proving.** `demo/stage-source.ts` broadcasts and records; `demo/prove-staged.ts` proves and verifies. Attestation lags ~8 minutes, and BUILD.md §13's structural advantage depends on all source-chain work being in the past tense before any demo begins.

**Note this required no Creditcoin tokens.** Proof fetching and `verify()` are both read-only. Only *submitting* these as facts to `EvidenceVault` needs tCTC.

---

### D-043 · Creditcoin funding is blocked; every faucet route is closed — [B]

**Status: BLOCKED, and it is now the only thing gating the remaining gates.**

Attempts:
- **thirdweb web faucet** — was the recommended no-Discord route; now behind a paid plan ("Faucet is not available on Free plan").
- **Discord `token-faucet`** — the official route, and the more generous one. Blocked at Discord account verification: the phone number is already registered to another Discord account.

Consequence: `EvidenceVault` and `Clearbook` cannot be deployed, so **Gate 4** (on-chain decode), **Gate 5** (live challenge), **Gate 6** (economics) and **Gate 7 part B** (six failing Creditcoin transaction hashes) all remain open.

The cost is genuinely small — deployment is **~0.0015 tCTC** at the measured 0.5 gwei — so a single 0.01 claim would cover deployment plus a scaled bond. The likeliest unblock is logging into the Discord account that already owns that phone number.

**Contingency if funding never arrives:** the submission would carry contracts, 92 tests, live proof/verification evidence including forged-proof rejection, and a frontend — but no deployed addresses. BUILD.md §1.1 lists "deployed on a testnet" as *mandatory*, so this is not a limitation we can document our way out of.

---

### D-044 · End-to-end latency measured — resolves the last §1.2 `[U]` — [L]

BUILD.md §1.2 listed "end-to-end latency for a fresh tx" as **UNVERIFIED — must be measured**. Measured with `integration/measure-latency.ts`, which broadcasts a real Sepolia transfer and times every stage through to the precompile ruling on it.

| Stage | Sample 1 | Sample 2 |
|---|---|---|
| broadcast → included | 8.5s | 3.8s |
| **included → attested** | **564.8s** | **481.9s** |
| proof fetch | 3.1s | 0.8s |
| `verify()` | 0.8s | 0.7s |
| **total** | **578.3s** | **488.7s** |

**A fresh transaction becomes usable evidence in roughly 8–10 minutes, and attestation is 97–99% of that.** Everything else totals under four seconds.

Two conclusions worth stating precisely:

1. **The published "~15 seconds" is about on-chain verification only.** Our `verify()` is faster still at 0.8s. But quoting it as the user-facing latency would mislead, so both numbers go in any claim we make.
2. **Attestation dominating is the security property working, not a defect.** Attestors attest *finalized* blocks; the measured 40–44 block lag sits inside Ethereum's ~64-block finality. Faster attestation would mean attesting blocks that could still reorg.

**BUILD.md §14's Gate 8 contingency does not trigger** — it anticipated P90 above 20 minutes, and measured P90 is 9.6. The worker's 45-minute `PROOF_WAIT_TIMEOUT_MS` has ~4.7× headroom over the measured worst case.

Two samples is a small n. The percentiles are reported for completeness rather than statistical weight; the shape of the result — attestation dominating everything else by two orders of magnitude — is not in doubt.

Written up in `docs/LATENCY.md`. Gas remains unmeasured pending deployment.

---

### D-016 · Repository is ESM (`"type": "module"`) — [L]

BUILD.md's Phase 0 snippets use top-level `await`. `npm init -y` defaults to `"type": "commonjs"`, under which `import.meta` is unavailable and those snippets do not run.

**Decision:** set `"type": "module"` in `package.json`. Scripts use an explicit `main()` plus a direct-invocation guard rather than top-level await, so importing a gate script never triggers its side effects (see KNOWN_ISSUES K-001).
**Reverses if:** a later dependency requires CommonJS — it would then be isolated rather than converting the repo back.
