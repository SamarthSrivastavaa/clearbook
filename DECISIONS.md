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

### D-016 · Repository is ESM (`"type": "module"`) — [L]

BUILD.md's Phase 0 snippets use top-level `await`. `npm init -y` defaults to `"type": "commonjs"`, under which `import.meta` is unavailable and those snippets do not run.

**Decision:** set `"type": "module"` in `package.json`. Scripts use an explicit `main()` plus a direct-invocation guard rather than top-level await, so importing a gate script never triggers its side effects (see KNOWN_ISSUES K-001).
**Reverses if:** a later dependency requires CommonJS — it would then be isolated rather than converting the repo back.
