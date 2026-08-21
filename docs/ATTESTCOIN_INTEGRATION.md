# Attestcoin Integration

How Clearbook uses the Creditcoin Block Prover precompile, what it verifies, and what it deliberately does not.

**Evidence classes:** **[P]** primary doc · **[C]** verified by reading shipped source · **[L]** verified by live execution · **[I]** inference · **[U]** unverified.

---

## The three things that matter most

**1. `receiptStatus == 1` is asserted by us, not by the precompile.** The precompile proves *inclusion*. It does not tell you whether the transaction succeeded. A reverted ERC-20 transfer is included in a block exactly like a successful one, and a system that skipped this check would happily accept a transfer that moved no value as evidence of repayment. `EvidenceVault` decodes the receipt and rejects `receiptStatus != 1` with `SourceTxReverted` `[C]` `[L]`.

**2. The replay key is log-level, deliberately stricter than the reference implementation.**

```
factId = keccak256(abi.encode(chainKey, blockHeight, txIndex, logIndex))
```

The reference `USCBase` keys at transaction level — `keccak(chainKey, blockHeight, txIndex)` `[C]`. That is insufficient here: one transaction routinely carries several `Transfer` logs relevant to different loans, and a transaction-level key would let the first log ingested permanently lock out the rest. This is not hypothetical — the two transactions we proved live carried **17 and 30 logs** `[L]`.

`logIndex` is **transaction-local** (an index into `ReceiptFields.receiptLogs`), not the block-global index `eth_getLogs` returns. Live Sepolia data confirms they differ routinely `[L]`:

| txHash | transaction-local | block-global |
|---|---|---|
| `0xc5e10867…` | 1 | 3 |
| `0xb38e285f…` | 0 | 19 |
| `0x62112a75…` | 1 | 21 |

Conflating them would compute `factId` over the wrong value. This is safe only because `logIndex` is combined with `txIndex`.

**3. Treasury addresses are bound by EIP-712 signature.** An originator cannot claim an address it does not control. `bindTreasury` recovers the signature over `TreasuryBinding(uint256 originatorId,address ethAddress,uint256 nonce,uint256 chainId)` and requires it to match. One address binds to at most one originator, ever. This proves control of a key — **and nothing more**. It does not establish that the address belongs to any person or company.

---

## Depth checklist

### Direct `0x0FD2` `verifyAndEmit` — [C] [L]

`EvidenceVault.submitTransferFact` calls the Block Prover precompile at `0x0000000000000000000000000000000000000FD2` directly. No wrapper, no indexer, no relayer.

```solidity
bool ok = VERIFIER.verifyAndEmit(chainKey, blockHeight, encodedTransaction, merkleProof, continuityProof);
if (!ok) revert ProofRejected();
```

The step order is a security invariant: **dedupe → verify → decode**. Nothing unverified is ever decoded into anything consequential. Live: `verify()` returned `true` for two independent Sepolia transactions in 1168 ms and 1091 ms `[L]`.

> **The precompile is imported from `contracts/write-ability/common/INativeQueryVerifier.sol`, and that path is load-bearing.** The package ships a *second*, materially different file of the same name at `contracts/write-ability/INativeQueryVerifier.sol` — a lean vendored copy with **no `verifyAndEmit`, no batch overloads and no `calculateTxIndex`**. Importing it compiles cleanly and silently removes the functionality this design depends on. See KNOWN_ISSUES K-003.

### Runtime `chainKey` discovery via `0x0FD3` — [C] [L]

**No chain key is hardcoded anywhere in this repository.** Every script and the worker resolve it at runtime from the ChainInfo precompile:

```ts
const chains = await info.getSupportedChains();
const match = chains.find((c) => c.chainId === chainId);
```

Live result on CC3 testnet (`chainId 102031`) `[L]`:

| chainKey | chainId | Chain | Attesting |
|---|---|---|---|
| 1 | 11155111 | Ethereum Sepolia | yes |
| 3 | 1 | Ethereum Mainnet | yes |

This resolves an ambiguity in the published documentation: the docs' numbering is **confirmed correct**, and the SDK's contradicting doc-comment example (`chainKey: 1, chainId: 1, 'Ethereum Mainnet'`) is wrong.

Resolution keys off the numeric `chainId`, never `chainName`, because the SDK's name decoding is broken upstream — its own source says so: *"TODO: Name decoding seems to be failing, investigate (you get all zeros currently)"* `[C]`, confirmed live `[L]`. See K-005.

Because the key is a runtime parameter, the same code path works against Ethereum Mainnet with no change. We use Sepolia so demo transactions can be staged for free.

### Third-party token logs — no source-chain contract — [L]

**Clearbook deploys nothing on the source chain.** It reads ordinary ERC-20 `Transfer` logs from contracts it does not control.

This was the project's single largest technical risk. If the proof service only indexed registered contracts, we would have been forced to deploy an event-emitting contract on Sepolia — reproducing the official tutorial and destroying the central claim. **It does not.** Two arbitrary third-party Sepolia transactions, involving tokens and contracts we do not control and did not create, were proven and verified end to end with **11/11 field checks** against independent source-chain RPC evidence `[L]`:

| | Transaction A | Transaction B |
|---|---|---|
| txHash | `0xc5e1086751fed6419e37c0e223e911cd4c31ace0e20713ad91ac1e5fa44d84f1` | `0xad4d54d5cc86475462ec59d340ec5e91dcc354d834fca986ea7c2b0922c2657d` |
| block / txIndex | 11529467 / 4 | 11529477 / 1 |
| logs in receipt | 17 | 30 |
| `verify()` at `0x0FD2` | **true** | **true** |
| field checks | 11/11 | 11/11 |

The demo token is canonical Sepolia **WETH** (`0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9`), verified live as `Wrapped Ether`, 18 decimals, with `deposit()` in its bytecode `[L]`. It is a third-party contract we cannot modify, and faucet ETH wraps into it — so no fixture token is deployed and no provenance claim is stretched.

Verifiable in four seconds: `cast code $TOKEN` returns bytecode; `cast code $TREASURY` returns `0x`.

### `txIndex` comes from the precompile — [C]

`txIndex` is never taken from the caller. It is resolved by the precompile's own view:

```solidity
uint64 txIndex = VERIFIER.calculateTxIndex(merkleProof);
```

Live, this agreed with the source chain's own `transactionIndex` in both test transactions (4 and 1) `[L]`.

Provenance discipline for every stored field:

| Field | Source | Caller-influenceable? |
|---|---|---|
| `token`, `from`, `to`, `amount` | decoded from the verified receipt | **No** |
| `receiptStatus` | decoded; asserted `== 1`; not stored | **No** |
| `txIndex` | precompile view | **No** |
| `chainKey`, `blockHeight` | caller-supplied, **bound by the proof** — a wrong value fails verification | Bounded |
| `logIndex` | caller-supplied index, bounds-checked and shape-checked | Bounded |
| `submitter`, `ccBlock` | chain context | **No** |

### ERC-721 rejection — [C]

ERC-721 `Transfer` shares topic0 with ERC-20 but carries **four** topics, the fourth being an indexed `tokenId`. Read naively, that `tokenId` would be interpreted as an amount. `EvidenceVault` requires exactly three topics and a 32-byte data field:

```solidity
if (lg.topics.length != 3 || lg.topics[0] != ERC20_TRANSFER_TOPIC) revert NotATransferLog();
if (lg.data.length != 32) revert MalformedTransferLog();
```

The topic constant was re-derived rather than copied: `cast keccak "Transfer(address,address,uint256)"` `[L]`.

### Batch guards against the verified 10/1000 limits — [C]

`submitTransferFactsBatch` uses the precompile's batch overload with one shared continuity proof, and enforces both protocol limits **before** the precompile call so an oversized batch fails cheaply:

```solidity
if (n > MAX_BATCH_SIZE) revert BatchTooLarge();        // 10
if (maxHeight - minHeight > MAX_BATCH_RANGE) revert BatchRangeExceeded();  // 1000 blocks
```

The span check is order-independent — it computes true min and max rather than assuming sorted input.

One honest asymmetry: **dedupe cannot precede verification in the batch path.** The precompile verifies the batch as a unit, so filtering already-known items would change what is being proven. Known items are re-verified and skipped at storage time. The single path remains the efficient choice for repeat traffic.

### Forged proofs are rejected, and the failure mode is now known — [L]

BUILD.md §1.3 recorded a contradiction we could not resolve from documentation: the SDK says the precompile *reverts* on failed verification, while the reference `USCBase` does `require(verified, ...)` on a returned bool.

Settled by experiment. `integration/gate7-forged.ts` takes a real verifying proof and mutates it six ways. A control run confirms the unmutated bundle verifies first, so the rejections below are meaningful rather than an artifact of a broken bundle.

| # | Mutation | Result | Precompile message |
|---|---|---|---|
| 1 | one Merkle sibling hash | REJECTED | `Merkle proof validation failed` |
| 2 | one continuity root | REJECTED | `Merkle root mismatch` |
| 3 | lower endpoint digest | REJECTED | `Continuity proof does not match attestation or checkpoint` |
| 4 | block height + 1 | REJECTED | `Continuity proof does not match attestation or checkpoint` |
| 5 | a Merkle `isLeft` flag | REJECTED | `Merkle proof validation failed` |
| 6 | one byte of `encodedTransaction` | REJECTED | `Merkle proof validation failed` |

**It reverts — 6 out of 6.** The documentation is right and the reference implementation's bool check is defensive against a path these failure modes do not take.

**Precisely scoped:** this exercised the read-only `verify()` overload, which needs no wallet. `verifyAndEmit()` is what `EvidenceVault` calls and is expected to behave identically, but that remains inference until the same mutations are submitted on-chain against a deployed vault — which is also what produces the six failing Creditcoin transaction hashes BUILD.md §16 asks for.

`EvidenceVault` keeps its `require`-on-bool regardless. It costs nothing and is the only thing standing between us and a future change that returns false instead. `test_verifier_revert_also_fails_closed` asserts the vault stores nothing under **either** behaviour, so the design was never dependent on the answer.

### Measured gas — [U] pending deployment

Not yet measured on-chain. What is known:

- Published model: `≈ 2.3e-5 + 2.9e-7 × continuityHashCount` CTC `[P]`
- Measured CC3 gas price: **0.5 gwei** `[L]`
- Measured deployment cost of both contracts: **~0.0015 CTC** (~3M gas) `[L]`

Per-submission gas against the real precompile will be recorded here after Gate 4. It must be measured under `via_ir = true`, since that setting changes code generation.

### Measured latency — [L], partial

| Metric | Measured |
|---|---|
| Attestation cadence | batches of **10 blocks, roughly every 2 minutes** |
| Sepolia attestation lag | **36–41 blocks (~7–8 min)**, stable, not growing |
| Attestation advance over 6 min | **+30 blocks** on both supported chains |
| `getProof` | 881 ms (cached) |
| `verify()` at `0x0FD2` | 1091–1168 ms |

The lag is consistent with the documented claim that attestors attest **finalized** blocks — Ethereum finality is ~64 blocks / ~12.8 min `[P]` + `[L]`.

End-to-end latency for a *freshly broadcast* transaction is still `[U]`; it needs `measure-latency.ts` and a funded wallet.

---

## Protocol limits we hit

Candid list. Each of these cost real time.

**1. The documented decoder import path does not exist.** Official examples import `@gluwa/usc-contracts/contracts/decoding/EvmV1Decoder.sol`. That directory is absent from the published package, and the `files` field (`contracts/write-ability/**/*.sol`) makes it unpublishable. Real path: `contracts/write-ability/common/EvmV1Decoder.sol`. (K-004)

**2. Two different `INativeQueryVerifier.sol` ship in one package.** Same filename, different contents, different pragmas. The shorter one lacks `verifyAndEmit`, the batch overloads and `calculateTxIndex`, yet compiles fine. A wrong import silently removes the core functionality. (K-003)

**3. The official decoder cannot compile without `via_ir`.** Its nested dynamic structs (`ReceiptFields` → `LogEntry[]` → `bytes32[]`/`bytes`) overflow the legacy code generator: *"Stack too deep… Variable headStart is 3 slot(s) too deep"*. `via_ir = true` is mandatory, which in turn means gas must be measured under that profile and `forge coverage` needs `--ir-minimum`.

**4. `getSupportedChains()` returns unusable chain names.** Upstream TODO, confirmed live. Any integration must key off `chainId`. (K-005)

**5. Dual-package hazard against ESM consumers.** The SDK ships CommonJS, so its `.d.ts` resolves ethers' CommonJS declarations while an ESM project resolves the ESM ones. Both declare `#private`, which TypeScript brands nominally, so the *same runtime class* becomes two mutually-unassignable types. This breaks the SDK's own documented examples under ESM. (K-013)

**6. Attestation is batched, which makes short liveness checks unreliable.** A 60-second sample can legitimately observe zero advance on a perfectly healthy chain — it happened to us on the first run and would have wrongly condemned Sepolia. Liveness needs a window longer than the batch cadence. (K-002)

---

## What Attestcoin verifies, and what Clearbook decides

The division is the point of the design.

**Attestcoin verifies:** that a specific transaction was included in an attested source-chain block, and hands us that transaction's receipt.

**Clearbook decides everything else:** that the receipt succeeded, which log matters, what the log means, whether it matches a registered claim, and whether a published covenant was breached.

**What remains trusted:** Ethereum finality, the Attestcoin attestor quorum, Creditcoin consensus, and the precompile implementation. Explicitly **not** trusted: our worker, our frontend, our RPC providers, or the proof builder. The proof builder supplies proof *material*; the precompile is what makes that material meaningful. A malicious builder can deny service — it cannot forge a fact.

**Why not an indexer?** An indexer tells the contract what a server believes. This system slashes money on these facts, and a server's word is not an acceptable basis for that. Replace the precompile with an indexer and the challenge mechanism becomes "trust our backend" — which is precisely the thing being eliminated.

---

## Reproduce the integration evidence

No API key and no funded wallet are needed — every call below is read-only against public endpoints.

```bash
npm install
cp .env.example .env

npm run gate0      # chain discovery + attestation liveness  (~70s)
npm run gate0:lag  # attestation lag over 6 minutes
npm run gate1      # find a real third-party ERC-20 Transfer
npm run gate2      # prove it, verify at 0x0FD2, decode, cross-check
```

Machine-readable outputs are committed under [`integration/results/`](../integration/results/). Every `[L]` claim in this document traces to one of those files.
