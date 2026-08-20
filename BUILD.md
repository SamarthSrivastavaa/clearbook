# BUILD.md

**Clearbook — Evidence-Bound Covenant Compliance for Credit Originators**
Target: BUIDL CTC 2026 Fall · Track: **RWA** · Deadline: **6 September 2026, 23:59 ET**

> **This document is an execution specification.** A coding agent should be able to run it top-to-bottom from an empty repository. Every phase ends in a gate. Do not skip gates. Do not implement anything marked `UNVERIFIED` until the corresponding gate passes.

---

## 0. PREMISE RE-VALIDATION AND ARCHITECTURE LOCK

### 0.1 Verdict on the prior concept

The prior Clearbook framing — "a loan book where anyone can prove a line is fraudulent" — **is changed in two material ways before locking**:

1. **"Fraud" is replaced with "covenant breach."** On-chain evidence cannot establish intent, control, or an off-chain contractual relationship. It *can* establish that an originator violated a **rule the originator itself published and bonded against**. That is objectively checkable, legally safe, and — in private credit — the real vocabulary (covenants, eligibility criteria, borrowing-base certification). This is a strict upgrade: it removes every unsupportable claim while making the mechanism *more* defensible, not less.
2. **Batch proofs are demoted from the critical path.** The prior design required a circular flow to fit inside the verified `MAX_BATCH_RANGE` of 1000 blocks. That is an unnecessary constraint. The locked design ingests **one proof per transaction into a persistent `EvidenceVault`**, then evaluates rules over *stored, already-verified* facts. Multi-transaction reasoning still happens on-chain over cryptographically verified data — it is simply no longer coupled to a block-window limit. Batch verification remains as an *optimization path* with an explicit range guard.

Everything else survives. The concept is sound and is now locked.

### 0.2 Locked architecture in one paragraph

Two Creditcoin contracts. **`EvidenceVault`** is a permissionless, application-agnostic registry: anyone submits an Attestcoin proof of a source-chain transaction; the vault calls the Block Prover precompile at `0x0FD2`, requires `receiptStatus == 1`, decodes ERC-20 `Transfer` logs from the verified receipt, deduplicates at `(chainKey, blockHeight, txIndex, logIndex)`, and stores an immutable `TransferFact`. **`Clearbook`** consumes fact IDs: an originator binds Ethereum treasury addresses by signature, posts a bond, publishes a covenant set, and registers loans whose disbursement and repayment claims must each cite a verified `TransferFact` matching token, direction, counterparty and amount. Anyone may then call `challenge()` citing two stored facts that together demonstrate a covenant breach; the call is atomic and self-verifying — valid challenges slash the bond and pay a bounty, invalid ones revert. There is no oracle, no governance, no dispute period, no token.

### 0.3 The fifteen product questions, answered by the implementation

| # | Question | Answer (each maps to a named artifact) |
|---|---|---|
| 1 | Who uses this? | Credit originators publishing a portfolio; investors/allocators auditing it; anyone as challenger |
| 2 | What problem? | A private-credit loan book is a self-reported spreadsheet. Nobody can check whether a "repayment" was real third-party money or the fund cycling its own |
| 3 | What claim? | "Loan L was disbursed (amount, token, borrower) and repaid (amount, token, payer), and our portfolio complies with covenant set C" |
| 4 | What evidence? | Real ERC-20 `Transfer` logs inside real source-chain transactions |
| 5 | How verified? | `EvidenceVault.submitTransferFact()` → precompile `0x0FD2` `verifyAndEmit` → `EvmV1Decoder` |
| 6 | Who can challenge? | Anyone. `Clearbook.challenge()` has no access control |
| 7 | Valid challenge? | Two stored `TransferFact`s satisfying a covenant's breach predicate, exactly as encoded in `CovenantLib` |
| 8 | After valid challenge? | Loan → `BREACHED`, bond slashed, bounty to `msg.sender`, `CovenantBreached` emitted. Terminal |
| 9 | After invalid challenge? | The transaction **reverts**. Challenger pays gas only. No bond, no window, no arbitration |
| 10 | Economic incentive? | Bounty = a fixed fraction of the slashed bond. An originator's published book is only worth believing to the extent it is bonded |
| 11 | Why Creditcoin? | It is the settlement and record layer whose founding purpose is credit recording, and the only chain with the precompile |
| 12 | Why Attestcoin? | Without it, the vault's "verified fact" would be a server's assertion. The precompile is what makes a stranger's evidence trustworthy to the contract |
| 13 | Better than an indexer? | An indexer tells the contract what a server believes. Slashing money on a server's word is unacceptable; the precompile removes the server from the trust path |
| 14 | Not a tutorial? | The official `loan-flow/` tutorial has a source-chain `AuxiliaryLoanContract` emitting bespoke events and a one-loan happy path. Clearbook deploys nothing on the source chain, reads ordinary third-party ERC-20 logs, reasons over *relationships between multiple verified transactions*, and has an adversarial path the tutorial does not have |
| 15 | Why care after? | `EvidenceVault` is a reusable public primitive any Creditcoin dApp can consume |

### 0.4 Truthfulness rules — enforced in code, UI and copy

These are **hard requirements**, not style preferences. A violation is a bug.

| Never say | Always say |
|---|---|
| "Fraud proven" | "Prohibited circular flow under covenant `CIRCULAR_REPAYMENT`" |
| "This wallet belongs to the fund" | "This address was bound to the originator by signature at block N" |
| "The loan was repaid" | "A transfer of X token to a bound treasury was verified; Clearbook interprets it as repayment of loan L under the registered claim" |
| "Verified on Ethereum" | "Inclusion of the transaction in an attested source-chain block was verified by the Creditcoin Block Prover precompile" |
| "Detects money laundering" | "Detects the specific, bounded on-chain pattern defined by the covenant" |

Three tiers must be visually distinct in the UI and explicitly separated in `README.md`:
`FACTUAL BLOCKCHAIN EVIDENCE` → `CLEARBOOK INTERPRETATION` → `REAL-WORLD CLAIM (NOT MADE)`.

---

## 1. DEPENDENCY LEDGER — WHAT IS VERIFIED AND WHAT IS NOT

Classification: **[P]** verified by primary source · **[C]** verified by reading shipped source code · **[L]** verified by live execution · **[I]** strong inference · **[U]** unverified · **[B]** blocked.

### 1.1 Hackathon rules

| Item | Value | Class |
|---|---|---|
| Name | BUIDL CTC 2026 Fall — "BUIDL For The Real World" | [P] |
| Window | 13 Aug – 6 Sep 2026, 23:59 ET | [P] |
| Winners announced | 18 Sep 2026 | [P] |
| Award ceremony | CTC Ignition 2026, Seoul, 28 Sep 2026 | [P] |
| Tracks | DeFi, RWA, DePIN, Gaming, AI (**five**; the four-track pages describe the Spring 2026 cycle) | [P] |
| Prizes | $10,000 / $3,000 / $2,000. **No per-track prizes found** | [P] / [I] |
| Only published scoring criterion | "Depth of Attestcoin Protocol utilization will be evaluated as one of the core scoring criteria" | [P] |
| Full rubric, weightings, rounds | — | **[U] Not published** |
| Judges | — | **[U] Not published. Do not target named individuals** |
| Mandatory | Working Attestcoin integration code; technical documentation of the integration; GitHub repo with README; deck or whitepaper PDF; demo video URL; **deployed on a testnet**; original work | [P] |
| Video length/format | — | **[U] None specified.** 3 minutes is our choice |
| Team size | Minimum 1 | [P] |
| Top 3 | CEIP fast-track direct to due diligence | [P] |

**Action:** before Phase 15, re-open `https://dorahacks.io/hackathon/buidl-ctc-2026-fall/detail` **in a browser** and diff against this table. Automated fetches of the BUIDL list return HTTP 405.

### 1.2 Protocol

| Item | Value | Class |
|---|---|---|
| Block Prover precompile | `0x0000000000000000000000000000000000000FD2` | [C] `NativeQueryVerifierLib.PRECOMPILE` |
| ChainInfo precompile | `0x0000000000000000000000000000000000000fd3` | [C] `CHAIN_INFO_PRECOMPILE_ADDRESS` |
| Verifier interface | `verifyAndEmit(uint64,uint64,bytes,MerkleProof,ContinuityProof) returns (bool)`; batch overload; `verify(...) view returns (bool)`; batch view overload; `calculateTxIndex(MerkleProof) view returns (uint64)` | [C] `INativeQueryVerifier.sol` |
| Emitted event | `TransactionVerified(uint64 indexed chainKey, uint64 indexed height, uint64 transactionIndex)` | [C] |
| Receipt struct | `ReceiptFields{uint8 receiptStatus; uint64 receiptGasUsed; LogEntry[] receiptLogs; bytes receiptLogsBloom;}` | [C] `EvmV1Decoder.sol` |
| Log struct | `LogEntry{address address_; bytes32[] topics; bytes data;}` — **ordered; array index is the transaction-local log index** | [C] |
| Decoder API | `getTransactionType`, `isValidTransactionType` (`<=4`), `decodeCommonTxFields`, `decodeReceiptFields`, `getLogsByEventSignature(ReceiptFields,bytes32)` | [C] |
| Receipt decode supports tx types | 0–4 (`receiptIdx = txType <= 2 ? 2 : 3`) | [C] |
| **Precompile does NOT check tx success** | The dApp must assert `receiptStatus == 1`; both reference contracts do | [P] + [C] |
| **Replay protection is the dApp's job** | Reference key is `keccak(chainKey, blockHeight, txIndex)` — **transaction-level only** | [C] `USCBase.sol` |
| Batch limits | `MAX_BATCH_SIZE` 10, `MAX_BATCH_RANGE` 1000 blocks, shared continuity proof | [P] + [C] |
| Gas model | `≈ 2.3e-5 + 2.9e-7 × continuityHashCount` CTC; ~2.6e-5 recent, ~3.1e-4 after 24h | [P] |
| Writability (Creditcoin → other chains) | **Unreleased**, "undergoing 3rd party testing and audits". Clearbook does not use it | [P] |
| Readability semantics | Transaction **inclusion** + receipt. Never contract state, balances, or storage | [P] |
| Attestation gating | Attestors monitor **finalized** source-chain blocks | [P] |
| "~15 seconds" | Refers to **on-chain verification only**, after attestation | [P] |
| End-to-end latency for a fresh tx | — | **[U] Must be measured (Phase 0, `measure-latency.ts`)** |
| Source chains | Docs: CC3 Testnet = Sepolia `chainKey 1`, Ethereum Mainnet `chainKey 3`. The committed example `.env` corroborates Sepolia = 1. The SDK doc-comment example contradicts the numbering | [P] / **[U]** |
| **Chain keys must be resolved at runtime** | `getSupportedChains()`. **Never hardcode** | [P] |
| Historical proof availability | Answerable by `getAttestationGenesisHeight` + `getContinuityBounds(...).isAttested`. **Clearbook does not depend on it** | [C] / [U] |
| ERC-20 `Transfer` topic0 | `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef` | [C] (SDK smoke test) |

### 1.3 Known defects to route around

- **DOCUMENTATION / IMPLEMENTATION MISMATCH.** The official `USCMinter.sol` imports `@gluwa/usc-contracts/contracts/decoding/EvmV1Decoder.sol`. In the published package `@gluwa/usc-contracts@0.2.0` that path **does not exist**; the file ships at `contracts/write-ability/common/EvmV1Decoder.sol`, and the package's `files` field publishes only `contracts/write-ability/**`. *Resolution:* import from the real path and set a forge remapping. Budget half a day. Report it in `#buidl-ctc-qna` — costs nothing, is visible to the right people.
- **DOCUMENTATION / IMPLEMENTATION MISMATCH.** The example repo's local `VerifierInterface.sol` is stale: it omits `verify()` and both batch overloads. *Resolution:* use the package's `INativeQueryVerifier.sol` as the source of truth.
- **DOCUMENTATION / IMPLEMENTATION MISMATCH.** SDK docs state the precompile *reverts* on failed verification; `USCBase` does `require(verified, ...)` on the returned bool. *Resolution:* keep the `require`. Both paths must terminate the transaction. Test both in Phase 11.
- **BLOCKED — CURRENT INFRASTRUCTURE LIMITATION.** No claim in this document is `[L]`. Nothing has been executed against CC3 testnet. Phase 0 exists to convert `[U]` → `[L]`.

---

## 2. SYSTEM ARCHITECTURE

### 2.1 Component map

```mermaid
flowchart TB
  subgraph SRC["SOURCE CHAIN (Sepolia default, Ethereum Mainnet optional)"]
    T["ERC-20 token contract<br/>(third-party — we deploy nothing here)"]
    TX1["tx: treasury --> borrower<br/>(disbursement)"]
    TX2["tx: payer --> treasury<br/>(repayment)"]
    TX3["tx: treasury --> payer<br/>(the funding leg)"]
  end

  subgraph OFF["OFF-CHAIN (orchestration only — NEVER authoritative)"]
    W["Worker<br/>watch, prove, submit, retry"]
    DB[("Postgres<br/>job state + index")]
  end

  subgraph CC["CREDITCOIN CC3 TESTNET"]
    PC["BlockProver precompile 0x0FD2<br/>Merkle + continuity, synchronous"]
    CI["ChainInfo precompile 0x0FD3"]
    EV["EvidenceVault.sol<br/>verify, assert status, decode,<br/>dedupe, store TransferFact"]
    CB["Clearbook.sol<br/>originators, bonds, covenants,<br/>claims, challenge, slashing"]
  end

  UI["Frontend (Next.js)<br/>Book / Loan / Challenge console"]

  TX1 & TX2 & TX3 --> W
  W --> DB
  W -->|"proof bundle"| EV
  EV -->|"verifyAndEmit"| PC
  EV -->|"factId"| CB
  CI -.->|"chainKey discovery"| W
  UI -->|"wallet tx: challenge()"| CB
  UI -->|"read"| EV
  UI -->|"read"| CB
```

### 2.2 The trust boundary, stated once and enforced everywhere

```
UNTRUSTED  : worker, frontend, RPC providers, proof builder, originator, borrower, challenger, all user input
SEMI-TRUST : Attestcoin attestor set (quorum honesty), Creditcoin validators
TRUSTED    : Ethereum consensus (finality), Creditcoin consensus, the 0x0FD2 precompile implementation
```

**The worker is an orchestrator. It acquires proof bundles and submits transactions. It has no privileged role, no signing authority over state, and no ability to make the vault believe anything.** If the worker submits a corrupted bundle, `verifyAndEmit` fails and the transaction reverts. If the worker disappears, anyone else can submit the identical bundle. This must be stated in `README.md` and demonstrated in the demo (Phase 12, beat 5).

The **proof builder is untrusted**: it supplies proof *material*, and the precompile is what makes that material meaningful. A malicious proof builder can deny service; it cannot forge a fact.

---

## 3. EVIDENCE MODEL

### 3.1 `TransferFact` — the only fact type in v1

```solidity
struct TransferFact {
    uint64  chainKey;      // from proof bundle, echoed by the precompile call
    uint64  blockHeight;   // from proof bundle
    uint64  txIndex;       // from VERIFIER.calculateTxIndex(merkleProof) — NOT user input
    uint32  logIndex;      // index within ReceiptFields.receiptLogs (transaction-local)
    address token;         // log.address_        (decoded)
    address from;          // log.topics[1]       (decoded)
    address to;            // log.topics[2]       (decoded)
    uint256 amount;        // abi.decode(log.data,(uint256)) (decoded)
    address submitter;     // msg.sender
    uint64  ccBlock;       // block.number on Creditcoin at ingestion
}
```

**Provenance discipline — this table is the spec, and every deviation is a security bug:**

| Field | Comes from | May the caller influence it? |
|---|---|---|
| `token`, `from`, `to`, `amount` | Decoded from the verified receipt | **No** |
| `receiptStatus` | Decoded; asserted `== 1`, not stored | **No** |
| `txIndex` | Precompile view `calculateTxIndex` | **No** |
| `chainKey`, `blockHeight` | Caller-supplied **but bound by the proof** — a wrong value fails verification | Bounded |
| `logIndex` | Caller-supplied index into the decoded array | Bounded (must be `< receiptLogs.length` and the log must be a `Transfer`) |
| `submitter`, `ccBlock` | Chain context | No |

**Rule: never store, compare against, or display a caller-supplied value that can instead be extracted from the verified receipt.**

### 3.2 Fact identity and replay

```
factId = keccak256(abi.encode(chainKey, blockHeight, txIndex, logIndex))
```

Stronger than the reference implementation's transaction-level key, and **necessarily so**: one transaction may contain several `Transfer` logs relevant to different loans (batch disbursement, multicall). A transaction-level key would let the first ingested log permanently lock out the rest.

`logIndex` is **transaction-local**, not block-global. That is safe because it is combined with `txIndex`. Document this in `SECURITY.md` so no reviewer assumes otherwise.

`factId` is idempotent by design: re-submitting an already-known fact is a **no-op returning the existing id**, not a revert. This is what makes the worker restart-safe.

### 3.3 Freshness and reorgs

- Attestors attest **finalized** source-chain blocks `[P]`. A verified fact therefore refers to a finalized block, and Clearbook applies **no additional confirmation threshold**.
- **Already-verified evidence is never invalidated.** There is no revocation path, and none is needed under the finality assumption.
- Residual assumption, stated in `SECURITY.md`: *if Ethereum finality were reverted, or if the attestor quorum were compromised, a fact could be false. Clearbook inherits that assumption and does not attempt to mitigate it.*
- **No timestamp dependence anywhere.** All timing uses `blockHeight` (source chain) or `block.number` (Creditcoin). `block.timestamp` appears nowhere in consequential logic.

---

## 4. PROTOCOL SPECIFICATION

### 4.1 Covenants

A covenant is a bounded, machine-checkable rule the originator **opts into** at registration. v1 ships exactly one breach-provable covenant plus two enforced-by-construction ones.

| ID | Name | Kind | Statement | Enforcement |
|---|---|---|---|---|
| `0x01` | `CIRCULAR_REPAYMENT` | **Breach-provable** | No repayment claim may cite a transfer whose payer received ≥ the repayment amount, in the same token, from a bound treasury address, within `W` source-chain blocks before the repayment block | `Clearbook.challenge()` |
| `0x02` | `EVIDENCE_UNIQUENESS` | By construction | No `TransferFact` may back more than one claim in the portfolio | `factConsumedBy` mapping |
| `0x03` | `EVIDENCE_FIRST` | By construction | No loan may be marked disbursed or repaid without a verified `TransferFact` matching token, direction, counterparty and amount | claim functions require a `factId` |

`W` is a per-originator parameter chosen at registration, bounded `1 <= W <= 50_000` source-chain blocks. It is **published on-chain and immutable for that originator** — a rule you can change after publishing is not a covenant.

**Precision about what `0x01` does and does not mean** (this text goes in the UI verbatim):
> A breach of `CIRCULAR_REPAYMENT` establishes that two verified transfers occurred in a specific relationship. It does not establish intent, control of either address by any person or entity, the existence of an off-chain loan, or any violation of law. It establishes that the originator's own published rule was not met.

### 4.2 State machine

```mermaid
stateDiagram-v2
    [*] --> REGISTERED: registerLoan(disbursementFactId)
    REGISTERED --> REPAYMENT_CLAIMED: claimRepayment(repaymentFactId)
    REGISTERED --> DELINQUENT: markDelinquent() after maturityBlock
    REPAYMENT_CLAIMED --> BREACHED: challenge() valid
    REPAYMENT_CLAIMED --> SETTLED: finalize() after challengeWindow
    REGISTERED --> BREACHED: challenge() valid
    DELINQUENT --> REPAYMENT_CLAIMED: claimRepayment()
    BREACHED --> [*]
    SETTLED --> [*]
```

**Transition table**

| From | To | Caller | Evidence required | Timing | Economic effect |
|---|---|---|---|---|---|
| — | `REGISTERED` | Originator (bonded) | `disbursementFactId`: `from` ∈ bound treasuries, `to` = borrower, `token` = declared, `amount` = principal | Any | Bond exposure += `bondPerLoan` |
| `REGISTERED` | `REPAYMENT_CLAIMED` | Originator | `repaymentFactId`: `to` ∈ bound treasuries, `token` = declared, `amount` ≥ principal × `repaymentBps / 10000` | Any | none |
| `REGISTERED` | `DELINQUENT` | **Anyone** | none | `block.number > maturityBlock` | none (reputational, on-chain) |
| `DELINQUENT` | `REPAYMENT_CLAIMED` | Originator | as above | Any | none |
| `REGISTERED`/`REPAYMENT_CLAIMED` | `BREACHED` | **Anyone** | Two facts satisfying the covenant predicate | Before `finalize()` | **Slash + bounty** |
| `REPAYMENT_CLAIMED` | `SETTLED` | **Anyone** | none | `block.number > claimBlock + challengeWindow` | Bond exposure -= `bondPerLoan` |

Terminal: `BREACHED`, `SETTLED`. **Forbidden:** any transition out of a terminal state; any transition to `REPAYMENT_CLAIMED` that reuses a consumed fact; `finalize()` before the window.

### 4.3 Challenge model

- **Who:** anyone. No allowlist, no registration, no bond.
- **What they provide:** `loanId`, `fundingFactId`. The repayment fact is read from the loan.
- **Bond:** none. Validity is decided deterministically inside the call; an invalid challenge **reverts** and costs the challenger only gas. This eliminates dispute periods, arbitration, and governance in one stroke.
- **Window:** `challengeWindow` Creditcoin blocks after `claimRepayment`, set per-originator at registration, bounded `>= 1200` blocks (≈5 h at ~15 s) so a challenger has time to acquire proofs.
- **Uniqueness:** a loan can be breached once. `BREACHED` is terminal.
- **Front-running:** a valid challenge sitting in the mempool can be copied. Documented in `KNOWN_ISSUES.md`. Production fix is commit–reveal (`commitChallenge(bytes32)` then `revealChallenge(...)` one block later). **Not built in v1** — it adds a block of latency to the single most important demo beat and buys nothing on a low-MEV testnet.

### 4.4 Economic model

Denominated in native CTC (testnet). Minimal and instantly legible.

| Parameter | Value (default) | Meaning |
|---|---|---|
| `bondPerLoan` | 1 CTC | Locked per open loan |
| `slashBps` | 10000 (100%) | Fraction of that loan's bond slashed on breach |
| `bountyBps` | 5000 (50%) | Fraction of the slash paid to the challenger |
| Remainder | 50% | Sent to `protocolSink` (a burn-like address set at deploy) |
| Bond withdrawal | `bond - exposure`, only after `withdrawCooldown` (default 1200 CC blocks) since the last claim | Prevents bond flight ahead of a challenge |

**Statement of what the economics do and do not achieve:** the bond bounds the cost of publishing a false claim. It does not make the book *true*; it makes lying about the covenant *expensive and profitable to detect*. Say exactly this in the pitch.

---

## 5. CONTRACTS

Two contracts. No proxy, no upgradeability, no libraries beyond the official decoder and one internal covenant library. Justification: the attack surface is the product; a proxy adds an admin key that contradicts the trust model.

Solidity **0.8.28** (the published `INativeQueryVerifier.sol` is `pragma ^0.8.28`).

### 5.1 `EvidenceVault.sol`

Purpose: turn an Attestcoin proof bundle into an immutable, deduplicated, application-agnostic fact. **No knowledge of loans, originators, or bonds.**

Storage:
```solidity
mapping(bytes32 => TransferFact) private _facts;   // factId => fact
mapping(bytes32 => bool)         public  exists;   // factId => ingested
bytes32 public constant ERC20_TRANSFER_TOPIC =
    0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef;
INativeQueryVerifier public immutable VERIFIER;    // 0x…0FD2
```

Errors: `ProofRejected()`, `SourceTxReverted()`, `LogIndexOutOfRange()`, `NotATransferLog()`, `MalformedTransferLog()`, `UnsupportedTxType()`, `UnknownFact()`.

Events:
```solidity
event TransferFactStored(
    bytes32 indexed factId, uint64 indexed chainKey, uint64 blockHeight,
    uint64 txIndex, uint32 logIndex,
    address indexed token, address from, address to, uint256 amount, address submitter
);
```

Functions:

```solidity
function submitTransferFact(
    uint64 chainKey,
    uint64 blockHeight,
    bytes calldata encodedTransaction,
    bytes32 merkleRoot,
    INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
    bytes32 lowerEndpointDigest,
    bytes32[] calldata continuityRoots,
    uint32  logIndex
) external returns (bytes32 factId);
```
- Access: **permissionless**.
- Steps, in this exact order:
  1. Build `MerkleProof` and `ContinuityProof` structs.
  2. `txIndex = VERIFIER.calculateTxIndex(merkleProof)` (view).
  3. `factId = keccak256(abi.encode(chainKey, blockHeight, txIndex, logIndex))`. **If `exists[factId]`, return `factId` immediately — idempotent no-op, no verification, no event.**
  4. `bool ok = VERIFIER.verifyAndEmit(chainKey, blockHeight, encodedTransaction, m, c); if (!ok) revert ProofRejected();`
  5. `uint8 t = EvmV1Decoder.getTransactionType(encodedTransaction); if (!EvmV1Decoder.isValidTransactionType(t)) revert UnsupportedTxType();`
  6. `ReceiptFields memory r = EvmV1Decoder.decodeReceiptFields(encodedTransaction); if (r.receiptStatus != 1) revert SourceTxReverted();`
  7. `if (logIndex >= r.receiptLogs.length) revert LogIndexOutOfRange();`
  8. `LogEntry memory lg = r.receiptLogs[logIndex];`
  9. `if (lg.topics.length != 3 || lg.topics[0] != ERC20_TRANSFER_TOPIC) revert NotATransferLog();`
  10. `if (lg.data.length != 32) revert MalformedTransferLog();`
  11. Decode `from = address(uint160(uint256(lg.topics[1])))`, `to = address(uint160(uint256(lg.topics[2])))`, `amount = abi.decode(lg.data,(uint256))`.
  12. Store, set `exists`, emit.
- Gas note: `verifyAndEmit` dominates (≈2.6e-5 CTC for a recent transaction). The dedupe check precedes it so repeat submissions cost almost nothing.
- Security notes: step 4 before any decoding — never decode unverified bytes into anything consequential. `topics.length != 3` rejects ERC-721 `Transfer` (which has 4 topics and would otherwise be read as an amount). No external calls other than the precompile; no reentrancy surface (the precompile is native and this function makes no callbacks).

```solidity
function getFact(bytes32 factId) external view returns (TransferFact memory);   // reverts UnknownFact
function computeFactId(uint64 chainKey, uint64 blockHeight, uint64 txIndex, uint32 logIndex) external pure returns (bytes32);
function calculateTxIndex(INativeQueryVerifier.MerkleProof calldata p) external view returns (uint64); // passthrough helper for the worker
```

**Optional batch path (SHOULD BUILD, Phase 7):**
```solidity
function submitTransferFactsBatch(
    uint64 chainKey, uint64[] calldata heights, bytes[] calldata encodedTransactions,
    INativeQueryVerifier.MerkleProof[] calldata merkleProofs,
    INativeQueryVerifier.ContinuityProof calldata sharedContinuityProof,
    uint32[] calldata logIndexes
) external returns (bytes32[] memory factIds);
```
Guards, both mandatory and both `[C]`-verified constraints: `heights.length <= 10` (`BatchTooLarge`) and `max(heights) - min(heights) <= 1000` (`BatchRangeExceeded`). Same per-item validation. Present in the demo as the efficiency path with the range guard visible in the code.

### 5.2 `Clearbook.sol`

Purpose: originator identity, bonds, covenants, loans, claims, challenges, slashing.

```solidity
enum LoanStatus { NONE, REGISTERED, REPAYMENT_CLAIMED, DELINQUENT, SETTLED, BREACHED }

struct Originator {
    address     owner;            // Creditcoin account
    string      name;
    uint256     bond;             // CTC deposited
    uint256     exposure;         // bondPerLoan * openLoans
    uint32      circularWindow;   // W, source-chain blocks
    uint32      challengeWindow;  // Creditcoin blocks
    uint64      lastClaimBlock;
    uint16      covenants;        // bitmask
    bool        active;
}

struct Loan {
    uint256 originatorId;
    address token;                 // declared source-chain ERC-20
    address borrower;              // expected `to` of disbursement
    uint256 principal;
    uint64  maturityBlock;         // Creditcoin block
    bytes32 disbursementFactId;
    bytes32 repaymentFactId;
    uint64  claimBlock;            // Creditcoin block of claimRepayment
    LoanStatus status;
}

mapping(uint256 => Originator) public originators;
mapping(uint256 => Loan)       public loans;
mapping(address => uint256)    public treasuryOwner;    // bound ETH address => originatorId
mapping(bytes32 => uint256)    public factConsumedBy;   // factId => loanId (EVIDENCE_UNIQUENESS)
```

Functions:

| Signature | Access | Validation | Events | Errors |
|---|---|---|---|---|
| `registerOriginator(string name, uint32 circularWindow, uint32 challengeWindow, uint16 covenants) payable returns (uint256)` | Anyone | `msg.value >= MIN_BOND`; `1 <= circularWindow <= 50000`; `challengeWindow >= 1200`; `covenants & 0x01 != 0` | `OriginatorRegistered` | `BondTooSmall`, `BadWindow`, `CovenantRequired` |
| `bindTreasury(uint256 originatorId, address ethAddress, bytes signature)` | Originator owner | EIP-712 `TreasuryBinding(uint256 originatorId,address ethAddress,uint256 nonce,uint256 chainId)`; `ECDSA.recover == ethAddress`; `treasuryOwner[ethAddress] == 0` | `TreasuryBound` | `BadSignature`, `AlreadyBound`, `NotOwner` |
| `topUpBond(uint256 originatorId) payable` | Anyone | active | `BondIncreased` | — |
| `withdrawBond(uint256 originatorId, uint256 amount)` | Owner | `bond - exposure >= amount`; `block.number > lastClaimBlock + withdrawCooldown`; **CEI: state first, then `call`** | `BondWithdrawn` | `Overexposed`, `CooldownActive`, `TransferFailed` |
| `registerLoan(uint256 originatorId, address token, address borrower, uint256 principal, uint64 maturityBlock, bytes32 disbursementFactId) returns (uint256)` | Owner | fact exists; `f.token == token`; `treasuryOwner[f.from] == originatorId`; `f.to == borrower`; `f.amount == principal`; `factConsumedBy[fid] == 0`; `bond - exposure >= bondPerLoan`; `maturityBlock > block.number` | `LoanRegistered` | `FactMismatch`, `TreasuryNotBound`, `FactAlreadyUsed`, `InsufficientBond` |
| `claimRepayment(uint256 loanId, bytes32 repaymentFactId)` | Owner | status ∈ {REGISTERED, DELINQUENT}; fact exists; `f.token == loan.token`; `treasuryOwner[f.to] == loan.originatorId`; `f.amount >= principal * repaymentBps / 10000`; `factConsumedBy == 0` | `RepaymentClaimed` | `WrongStatus`, `FactMismatch`, `AmountTooLow`, `FactAlreadyUsed` |
| `markDelinquent(uint256 loanId)` | **Anyone** | status == REGISTERED; `block.number > maturityBlock` | `LoanDelinquent` | `NotYetMature` |
| `challenge(uint256 loanId, bytes32 fundingFactId) returns (uint256 bounty)` | **Anyone** | see 5.3 | `CovenantBreached`, `BountyPaid` | `NoBreach`, `WindowClosed`, `WrongStatus` |
| `finalize(uint256 loanId)` | **Anyone** | status == REPAYMENT_CLAIMED; `block.number > claimBlock + challengeWindow` | `LoanSettled` | `WindowOpen` |

### 5.3 `challenge()` — the predicate, exactly

```
Given loan L (status REPAYMENT_CLAIMED or REGISTERED with a claimed repayment),
      R = vault.getFact(L.repaymentFactId)
      F = vault.getFact(fundingFactId)
      O = originators[L.originatorId]

REQUIRE all of:
  1. L.status == REPAYMENT_CLAIMED
  2. block.number <= L.claimBlock + O.challengeWindow          -> WindowClosed
  3. F.chainKey == R.chainKey                                   -> ChainMismatch
  4. F.token    == R.token                                      -> TokenMismatch
  5. F.to       == R.from                                       -> NotTheSamePayer
  6. treasuryOwner[F.from] == L.originatorId                    -> FundingNotFromBoundTreasury
  7. F.amount   >= R.amount                                     -> FundingBelowRepayment
  8. F.blockHeight <= R.blockHeight                             -> FundingNotBefore
  9. R.blockHeight - F.blockHeight <= O.circularWindow          -> OutsideWindow
 10. fundingFactId != L.repaymentFactId                         -> SameFact
 11. fundingFactId != L.disbursementFactId                      -> DisbursementNotFunding

THEN:
  L.status = BREACHED
  slash    = min(O.bond, bondPerLoan * slashBps / 10000)
  bounty   = slash * bountyBps / 10000
  O.bond  -= slash;  O.exposure -= bondPerLoan
  emit CovenantBreached(loanId, 0x01, fundingFactId, L.repaymentFactId, msg.sender)
  pay bounty to msg.sender, remainder to protocolSink   // CEI: all state written first
```

Condition 11 closes the obvious originator gambit: citing the *disbursement itself* as the funding leg. A genuine loan is `treasury → borrower … borrower → treasury`; a circular one is `treasury → payer` where the payer is the same address that then repays. Requiring `F.to == R.from` and excluding the disbursement fact makes the two distinguishable **only** when the borrower repays from an address the treasury did not just fund. That is exactly the covenant, and its limits are stated in §9.

---

## 6. THREAT MODEL

Assume adversaries control the originator, the borrower, challengers, source-chain transaction contents and ordering, malicious ERC-20s, RPC responses, frontend input and proof submissions.

| # | Attack | Precondition | Exploit path | Mitigation | Invariant | Test |
|---|---|---|---|---|---|---|
| T1 | **Replay of a fact** | Any valid proof | Submit the same bundle repeatedly to inflate claims | `factId` dedupe; idempotent no-op | `exists[factId]` monotonic; one `TransferFactStored` per `factId` | `t_replay_is_noop` |
| T2 | **Multi-log replay** (tx-level key) | Tx with several `Transfer` logs | Under a tx-level key, one log blocks the rest, or one log is reused for many claims | `factId` includes `logIndex`; `factConsumedBy` binds one fact to one loan | Distinct `logIndex` ⇒ distinct `factId` | `t_multi_log_distinct_facts` |
| T3 | **Proof substitution** | Attacker crafts a bundle | Swap `encodedTransaction` for a different transaction while keeping the proof | Precompile binds bytes to the Merkle leaf; mutation fails | `verifyAndEmit == true` ⇒ bytes are the proven transaction | `t_forged_bytes_rejected` |
| T4 | **Reverted source tx** | A reverted transfer is included in a block | Claim a repayment that never moved value | `receiptStatus == 1` asserted **by us** — the precompile does not | No stored fact has `receiptStatus != 1` | `t_reverted_tx_rejected` |
| T5 | **Cross-chain confusion** | Two chains supported | Prove a Sepolia transfer, present it as mainnet | `chainKey` in `factId`; `challenge()` requires `F.chainKey == R.chainKey` | Facts in one predicate share a `chainKey` | `t_cross_chain_rejected` |
| T6 | **Token spoofing** | Anyone can deploy an ERC-20 | Emit a `Transfer` from a worthless clone | `token` from `log.address_`, matched to the loan's declared token | `fact.token == loan.token` always | `t_wrong_token_rejected` |
| T7 | **ERC-721 confusion** | NFT `Transfer` shares the topic0 | 4-topic log read as an amount | `topics.length != 3` rejected | Stored facts always have exactly 3 topics | `t_erc721_rejected` |
| T8 | **Log-index out of range** | Caller picks the index | Read past the array | Bounds check before access | `logIndex < receiptLogs.length` | `t_log_index_oob` |
| T9 | **Address spoofing** | Anyone can claim a treasury | Bind a treasury the originator doesn't control | EIP-712 signature by the Ethereum key; one-to-one binding | `treasuryOwner[a] != 0` ⇒ signature verified | `t_bind_requires_signature` |
| T10 | **Binding replay across originators** | Signature reuse | Reuse a signature for a second originator | `originatorId` + `nonce` + `chainId` inside the signed struct; `AlreadyBound` | An address binds to at most one originator | `t_binding_replay` |
| T11 | **Evidence reuse across loans** | One real repayment | Mark several loans repaid with one transfer | `factConsumedBy` | Each `factId` backs ≤ 1 claim | `t_fact_reuse_rejected` |
| T12 | **Bond flight** | Challenge pending | Withdraw the bond before the challenge lands | `exposure` accounting + `withdrawCooldown` | `bond >= exposure` always | `t_cannot_withdraw_exposed` |
| T13 | **Double slash** | Loan already breached | Challenge twice | `BREACHED` terminal; status checked first | A loan is slashed at most once | `t_double_slash` |
| T14 | **Double bounty** | Reentrancy on payout | Re-enter `challenge()` during the bounty transfer | CEI: all state written before any `call`; `ReentrancyGuard` on `challenge`, `withdrawBond` | `address(this).balance >= Σ bonds` | `t_reentrancy_bounty` |
| T15 | **Griefing by invalid challenges** | None | Spam `challenge()` | Invalid challenges revert; attacker pays gas; no state written | Failed challenge leaves state bit-identical | `t_invalid_challenge_reverts` |
| T16 | **Challenge front-running** | Public mempool | Copy a mempool challenge | **Accepted risk in v1**, documented; commit–reveal is the production fix | — | documented only |
| T17 | **Originator evades via undeclared address** | Uses a treasury it never binds | Fund the payer from an unbound address | Cannot be prevented — see §9. But an unbound address cannot be cited in a disbursement or repayment claim either | Covenant is bounded, not universal | `t_unbound_funding_not_a_breach` |
| T18 | **Stale proof** | Old attested block | Submit an ancient transfer as a fresh repayment | Facts carry `blockHeight`; the demo book displays it; ordering constraints in the predicate | `F.blockHeight <= R.blockHeight` enforced | `t_ordering_enforced` |
| T19 | **Overpayment / partial payment** | Amounts differ | Under- or over-pay to dodge matching | Disbursement requires exact equality; repayment requires `>= principal * repaymentBps / 10000` | Documented, deterministic | `t_amount_boundaries` |
| T20 | **Same-block transactions** | Funding and repayment in one block | `F.blockHeight == R.blockHeight` | `<=` comparison admits it; `factId` differs by `txIndex`/`logIndex` | Same-block is a valid breach | `t_same_block_breach` |
| T21 | **Malicious RPC** | Worker's provider lies | Feed the worker fabricated transactions | Worker output is only a proof bundle; the precompile rejects fabrications | No fact exists without precompile approval | `t_bad_bundle_rejected` |
| T22 | **Integer overflow / precision** | Large amounts | Overflow in `principal * repaymentBps` | Solidity 0.8 checked arithmetic; `bps` bounded ≤ 10000; multiply-before-divide | No unchecked blocks in consequential math | fuzz `f_amount_math` |
| T23 | **Unsafe external call** | Bounty payout | Payee reverts, bricking `challenge()` | `call{value:}` with return checked; state already final; failure reverts the whole call and the loan stays challengeable | No `transfer()`/`send()` | `t_payout_to_reverting_contract` |
| T24 | **Approval/allowance issues** | — | — | **Clearbook never moves ERC-20s.** It only reads verified logs. No `approve`, no `transferFrom`, no token custody anywhere | Contract holds only native CTC | n/a |
| T25 | **Reorg after attestation** | Ethereum finality reverted | A finalized block disappears | Out of scope; inherited from the attestor set; stated in `SECURITY.md` | — | documented only |
| T26 | **DoS via huge receipts** | Pathological transaction | Decode cost explodes | Documented max decode workload ≈0.0375 CTC; the worker pre-checks with the free `verify()` view and skips outliers | Submission cost bounded | `t_large_receipt` |

**Global invariants** (asserted in fuzz tests):
`I1` `address(this).balance >= Σ originators[i].bond` · `I2` `bond >= exposure` for every originator · `I3` every `factId` backs ≤ 1 claim · `I4` terminal states never transition · `I5` no stored fact came from a `receiptStatus != 1` transaction · `I6` `exposure == bondPerLoan × count(status ∈ {REGISTERED, REPAYMENT_CLAIMED, DELINQUENT})`.

---

## 7. SOURCE-CHAIN SIDE

| Component | Classification | Notes |
|---|---|---|
| ERC-20 token | **CORE PROTOCOL — third-party** | Clearbook reads ordinary `Transfer` logs from a token it does not control. **Nothing of ours is deployed on the source chain.** This is the central architectural claim and it is demonstrable in four seconds with `cast code $TOKEN` and `cast code $TREASURY` |
| Treasury / borrower / payer wallets | **DEMO FIXTURE** | Ordinary EOAs we generate. `cast code` returns `0x` |
| `MockUSD.sol` ERC-20 | **DEMO FIXTURE — fallback only** | Deploy **only** if no suitable pre-existing ERC-20 is available on the chosen source chain. If deployed, `DEMO.md` must label it a fixture and the pitch must not claim third-party provenance |
| Any Clearbook-specific source-chain contract | **DO NOT BUILD** | Deploying one would reproduce the official `loan-flow/` tutorial and destroy the differentiator |

**Never invent a token address.** `SOURCE_TOKEN_ADDRESS` is discovered during Phase 0 and recorded in `DECISIONS.md` with the block explorer link that proves it exists.

---

## 8. OFF-CHAIN SERVICES

One worker process, one database. No microservices.

### 8.1 `worker/` responsibilities

| Module | Input | Output | Failure behaviour |
|---|---|---|---|
| `discover.ts` | CC3 RPC | `{chainKey, chainId, chainName}[]` via `PrecompileChainInfoProvider.getSupportedChains()` | Fatal at startup; never falls back to a hardcoded key |
| `watch.ts` | source RPC, token address, watched address set | candidate `(txHash, logIndex)` | Resumes from `scan_cursor`; at-least-once |
| `prove.ts` | `txHash` | proof bundle | `waitUntilHeightAttested(chainKey, height, 15000, 2_700_000)` then `getProof`; exponential backoff; classifies `NOT_ATTESTED` / `NOT_FOUND` / `SERVICE_ERROR` |
| `precheck.ts` | bundle | bool | Free `verifySingle()` view **before** spending gas. Skips submission on false and records the reason |
| `submit.ts` | bundle | CC3 tx hash | Calls `EvidenceVault.submitTransferFact`; idempotent because re-submission is a vault no-op; nonce-managed single signer |
| `index.ts` | vault + Clearbook events | read model for the UI | Pure projection; the UI may also read the chain directly |

**Explicit statement for `README.md` and the pitch:** *the worker acquires and submits evidence. It never decides whether evidence is true. Delete the worker and any third party can submit the identical bundle; the on-chain result is unchanged.*

### 8.2 Persistence

```sql
CREATE TABLE facts (
  id BIGSERIAL PRIMARY KEY,
  chain_key BIGINT NOT NULL, block_height BIGINT NOT NULL,
  tx_hash TEXT NOT NULL, tx_index BIGINT, log_index INT NOT NULL,
  token TEXT, sender TEXT, recipient TEXT, amount NUMERIC(78,0),
  fact_id TEXT UNIQUE, state TEXT NOT NULL, attempts INT DEFAULT 0,
  last_error TEXT, cc_tx_hash TEXT, correlation_id TEXT NOT NULL,
  UNIQUE (chain_key, block_height, tx_index, log_index)
);
CREATE TABLE scan_cursor (chain_key BIGINT PRIMARY KEY, last_block BIGINT NOT NULL);
CREATE TABLE latency_samples (
  id BIGSERIAL PRIMARY KEY, tx_hash TEXT, t_broadcast TIMESTAMPTZ, t_included TIMESTAMPTZ,
  t_finalized TIMESTAMPTZ, t_attested TIMESTAMPTZ, t_proved TIMESTAMPTZ, t_cc_confirmed TIMESTAMPTZ
);
```
`state ∈ {DISCOVERED, WAITING_ATTESTATION, PROVED, PRECHECK_FAILED, SUBMITTED, CONFIRMED, FAILED}`. The DB unique constraint mirrors the on-chain `factId` exactly so the two can never disagree.

**Restart safety:** the vault is idempotent, the DB key is unique, and the cursor is persisted. Crash at any point ⇒ replay is a no-op. No evidence lost, no double challenge, no double bounty, no double slash.

### 8.3 Observability

Structured JSON logs, one line per state transition, with `correlationId` (per fact), `proofRequestId`, `txHash`, `ccTxHash`, `state`, `attempt`, `latencyMs`. Metrics: `facts_submitted_total`, `facts_precheck_failed_total`, `proof_latency_ms` (histogram), `attestation_wait_ms`, `challenge_attempts_total`, `errors_total{class}`. `GET /health` returns worker state, latest attested height per chain, cursor lag. **Never log private keys, seed phrases or `.env` contents**; a pre-commit hook greps for `0x[0-9a-fA-F]{64}` in tracked files.

---

## 9. HONEST LIMITS (goes verbatim into `KNOWN_ISSUES.md`)

1. **The covenant is bounded, not universal.** An originator that funds a payer from an address it never binds does not breach `CIRCULAR_REPAYMENT`. Depth-1 detection only. This is inherent to a rule that must be machine-checkable, and it is why the rule is framed as a *covenant the originator chose*, not as fraud detection.
2. **Address ≠ entity.** A bound treasury is an address that produced a signature. Nothing more.
3. **Absence is unprovable.** Merkle inclusion proofs cannot show that a transaction did *not* occur. Clearbook therefore never certifies a book as clean; it makes specific claims refutable. This is a deliberate consequence of the cryptography, and saying so is a strength.
4. **On-chain evidence says nothing about off-chain agreements.** A verified transfer is not a loan.
5. **Ethereum only.** Sepolia and (per docs) Ethereum Mainnet are the supported source chains today.
6. **Writability is unreleased**; Clearbook makes no cross-chain writes.
7. **Front-running of challenges is unmitigated in v1.**
8. **Testnet economics.** Bonds are testnet CTC.

---

## 10. REPOSITORY LAYOUT

```
clearbook/
├─ contracts/
│  ├─ src/{EvidenceVault.sol,Clearbook.sol,libraries/CovenantLib.sol,interfaces/IEvidenceVault.sol}
│  ├─ src/fixtures/MockUSD.sol            # DEMO FIXTURE — fallback only
│  ├─ test/{EvidenceVault.t.sol,Clearbook.t.sol,Security.t.sol,Invariants.t.sol,mocks/MockVerifier.sol}
│  ├─ script/{Deploy.s.sol,SeedDemo.s.sol}
│  ├─ foundry.toml, remappings.txt
├─ worker/src/{discover,watch,prove,precheck,submit,index,db,log,health}.ts
├─ integration/{gate0-capabilities.ts,gate1-evidence.ts,gate2-proof.ts,gate3-verify.ts,
│               gate4-decode.ts,gate7-forged.ts,measure-latency.ts,e2e-full.ts}
├─ frontend/  (Next.js app router)
├─ demo/{seed.ts,reset.ts,run.ts,DEMO.md,scenarios.json}
├─ docs/{ARCHITECTURE.md,ATTESTCOIN_INTEGRATION.md,THREAT_MODEL.md,LATENCY.md}
├─ .env.example, README.md, DECISIONS.md, KNOWN_ISSUES.md, SECURITY.md,
   DEMO.md, TESTING.md, DEPLOYMENT.md, Makefile
```

`DECISIONS.md` is an append-only log: every architectural choice, its date, its evidence class, and what would reverse it. Judges read this file and it costs nothing.

### `.env.example`

```bash
# ---- Creditcoin (values below are from the official committed example .env) ----
CREDITCOIN_RPC_URL="https://rpc.cc3-testnet.creditcoin.network"
PROOF_BUILDER_URL="https://prover.cc3-testnet.creditcoin.network"
# Resolved at runtime via getSupportedChains(). NEVER hardcode. Recorded here after Gate 0.
SOURCE_CHAIN_KEY=""
SOURCE_CHAIN_NAME=""
CREDITCOIN_CHAIN_ID=""            # discovered via eth_chainId

# ---- Source chain ----
SOURCE_CHAIN_RPC_URL=""           # archive-capable
SOURCE_TOKEN_ADDRESS=""           # DISCOVERED in Gate 1. Never invent. Record explorer link in DECISIONS.md

# ---- Deployed (filled by Deploy.s.sol) ----
EVIDENCE_VAULT_ADDRESS=""
CLEARBOOK_ADDRESS=""
PROTOCOL_SINK_ADDRESS=""

# ---- Keys: use throwaway wallets only ----
CC_DEPLOYER_PRIVATE_KEY=""
CC_WORKER_PRIVATE_KEY=""
DEMO_TREASURY_PRIVATE_KEY=""
DEMO_BORROWER_PRIVATE_KEY=""
DEMO_PAYER_PRIVATE_KEY=""

# ---- Off-chain ----
DATABASE_URL="postgres://clearbook:clearbook@localhost:5432/clearbook"
LOG_LEVEL="info"
PROOF_POLL_INTERVAL_MS=15000
PROOF_WAIT_TIMEOUT_MS=2700000     # 45 min; SDK default is 900000
```

Pinned dependencies: `@gluwa/usc-sdk@0.18.0`, `@gluwa/usc-contracts@0.2.0`, `ethers@^6`, `solc 0.8.28`. `remappings.txt`:
```
@gluwa/usc-contracts/=node_modules/@gluwa/usc-contracts/
forge-std/=lib/forge-std/src/
```

---

## 11. EXECUTION PHASES

Each phase ends in a gate. **On gate failure: diagnose, classify (`UNVERIFIED` / `BLOCKED` / `MISMATCH`), propose the smallest correction, and stop. Never silently continue.**

### PHASE 0 — Protocol verification (do this before writing product code)

```bash
mkdir clearbook && cd clearbook && git init
npm init -y
npm i -E @gluwa/usc-sdk@0.18.0 @gluwa/usc-contracts@0.2.0 ethers@6 dotenv
npm i -D -E typescript tsx @types/node
npx tsc --init
```

`integration/gate0-capabilities.ts`
```ts
import { JsonRpcProvider } from 'ethers';
import { chainInfo } from '@gluwa/usc-sdk';
const cc = new JsonRpcProvider(process.env.CREDITCOIN_RPC_URL!);
const info = new chainInfo.PrecompileChainInfoProvider(cc);
const chains = await info.getSupportedChains();          // [{chainKey, chainId, chainName, chainEncoding}]
for (const c of chains) {
  const h = await info.getLatestAttestedHeightAndHash(c.chainKey);
  const g = await info.getAttestationGenesisHeight(c.chainKey);
  console.log(c.chainKey, c.chainName, 'attested:', h.exists, h.height, 'genesis:', g);
}
```

**GATE 0 — pass criteria:** the call returns a non-empty list; at least one chain reports `exists: true`; and the reported height **advances** on a second run 60 seconds later (proving attestors are live *now*, not merely configured).
**On failure:** post in `#buidl-ctc-qna` with the output. `BLOCKED` until answered. Do not proceed.
**Record in `DECISIONS.md`:** the exact `chainKey` chosen, `getAttestationGenesisHeight`, and whether Ethereum Mainnet appears (this resolves the `[U]` in §1.2).

### PHASE 1 — Repository bootstrap

```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup
forge init --no-git contracts && cd contracts && forge install foundry-rs/forge-std
# write remappings.txt, set solc = "0.8.28" and evm_version in foundry.toml
forge build
```
Compile a throwaway file importing both `@gluwa/usc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol` and `.../EvmV1Decoder.sol`.
**GATE 1a:** `forge build` succeeds against the real package paths. If it fails, this is the known `DOCUMENTATION / IMPLEMENTATION MISMATCH` — fix the remapping, record it in `DECISIONS.md`, and file it upstream.

Then scaffold `README.md`, `DECISIONS.md`, `KNOWN_ISSUES.md`, `SECURITY.md`, `TESTING.md`, `DEPLOYMENT.md`, `DEMO.md`, `.env.example`, `Makefile`.

### PHASE 2 — Minimal contracts

Implement `EvidenceVault.sol` exactly as §5.1 and `Clearbook.sol` exactly as §5.2/§5.3. No extra functions. No admin. No proxy.
**GATE 2:** `forge build` clean; `forge fmt --check` clean; `solhint` clean.

### PHASE 3 — Unit tests (mock verifier)

`test/mocks/MockVerifier.sol` implements `INativeQueryVerifier` with a settable return value and a settable `calculateTxIndex`. Deploy the vault with an injectable verifier address **in tests only** (constructor parameter defaulting to `0x0FD2` in production deployment — record this in `DECISIONS.md` as a deliberate testability decision, and assert in `Deploy.s.sol` that production uses `0x0FD2`).

Required tests — each with explicit setup / action / expected / assertion:
`t_replay_is_noop`, `t_multi_log_distinct_facts`, `t_forged_bytes_rejected`, `t_reverted_tx_rejected`, `t_cross_chain_rejected`, `t_wrong_token_rejected`, `t_erc721_rejected`, `t_log_index_oob`, `t_bind_requires_signature`, `t_binding_replay`, `t_fact_reuse_rejected`, `t_cannot_withdraw_exposed`, `t_double_slash`, `t_reentrancy_bounty`, `t_invalid_challenge_reverts`, `t_unbound_funding_not_a_breach`, `t_ordering_enforced`, `t_amount_boundaries`, `t_same_block_breach`, `t_payout_to_reverting_contract`, `t_large_receipt`, plus the happy paths `t_register_claim_finalize` and `t_circular_flow_breach`.

Invariant tests (`Invariants.t.sol`) assert `I1`–`I6` under a fuzzing handler that randomly registers, claims, challenges, finalizes and withdraws.
**GATE 3:** all tests pass; `forge coverage` ≥ **90% of lines in `src/`**, with any exclusion justified in `TESTING.md`.

### PHASE 4 — Real Attestcoin integration

`integration/gate2-proof.ts` + `gate3-verify.ts`:
```ts
const pb = new proofProvider.service.ProofBuilder(chainKey, process.env.PROOF_BUILDER_URL!);
await pb.waitUntilHeightAttested(chainKey, blockNumber, 15000, 2_700_000);
const res = await pb.getProof(txHash);                    // {headerNumber, txIndex, txBytes, merkleProof, continuityProof}
const prover = new blockProver.PrecompileBlockProver(cc);
const ok = await prover.verifySingle(res.data.chainKey, res.data.headerNumber,
                                     res.data.txBytes, res.data.merkleProof, res.data.continuityProof);
```
**GATE 2 (proof):** `getProof` returns `success: true` for a transaction **we sent** on the chosen source chain.
**GATE 3 (verify):** `verifySingle` returns `true`.
**On failure:** if `getProof` fails on a transaction that demonstrably exists, classify as `UNVERIFIED — prover may index only registered contracts`, post in `#buidl-ctc-qna`, and apply the pivot in §14.

### PHASE 5 — Evidence pipeline

Deploy `EvidenceVault` to CC3 testnet. `integration/gate4-decode.ts` submits a real bundle and asserts the emitted `TransferFactStored` fields **match the source-chain explorer byte-for-byte**.
**GATE 4:** decoded `token`, `from`, `to`, `amount` match the explorer exactly, and a `TransactionVerified` event from `0x0FD2` is present in the same Creditcoin receipt.

### PHASE 6 — Challenge mechanism · PHASE 7 — Economics

Deploy `Clearbook`. Run the full covenant flow against real facts. Add the batch path (§5.1) with both guards.
**GATE 5:** a real circular flow triggers `challenge()` successfully; a non-circular one reverts with `NoBreach`.
**GATE 6:** bond decreases by exactly `slash`, challenger balance increases by exactly `bounty`, `protocolSink` receives the remainder, `exposure` decrements, and `I1`/`I2` hold on-chain.

### PHASE 8 — Worker · PHASE 9 — Frontend

Build per §8 and §12. **GATE 8a:** kill the worker mid-flight at each state; on restart no duplicate on-chain submission occurs and no fact is lost.

### PHASE 10 — End-to-end · PHASE 11 — Security hardening

`integration/e2e-full.ts`: fresh source-chain transfer → attestation → proof → vault → claim → challenge → slash, with assertions at every step. `integration/gate7-forged.ts` runs six mutations — one Merkle sibling hash, one continuity root, `lowerEndpointDigest`, `blockHeight`, an `isLeft` flag, and one byte of `encodedTransaction` — and asserts **all six** fail. Capture the six failing Creditcoin transaction hashes; they go in the video and the README.
**GATE 7:** all six mutations rejected; all Phase 3 security tests still green against the live deployment.
Record in `DECISIONS.md` whether the precompile **reverted** or **returned false**, resolving the documented mismatch. Either outcome is a publishable finding.

### PHASE 12 — Demo environment (§13) · PHASE 13 — Deployment · PHASE 14 — Final audit · PHASE 15 — Submission (§16)

---

## 12. FRONTEND

Next.js (app router) + wagmi/viem + Tailwind. Four routes. **Not a dashboard — a document with an audit trail.**

| Route | Purpose | Key states |
|---|---|---|
| `/` **The Book** | The originator's portfolio: one row per loan — borrower, principal, token, status badge, bond exposure. A banner states which transactions are staged by us | loading · empty · loaded · rpc-error |
| `/loan/[id]` **Evidence chain** | Three tiers, visually separated: **FACTUAL EVIDENCE** (each fact: chainKey, block, txIndex, logIndex, token, from, to, amount, source-chain explorer link, Creditcoin verification tx link, `TransactionVerified` log) → **CLEARBOOK INTERPRETATION** (which claim it backs and under which rule) → **NOT CLAIMED** (an explicit list of what this evidence does *not* establish) | evidence-pending · verified · claim-matched · breached |
| `/challenge` **Challenge console** | Paste or pick a `fundingFactId`; a client-side dry-run evaluates the 11 predicate conditions and shows each as pass/fail **before** the wallet opens; then submit | idle · dry-run-pass · dry-run-fail(condition N) · wallet-pending · tx-pending · success(bounty) · reverted(error name) |
| `/verify` **Judge mode** | Paste any source-chain tx hash → the app fetches it, shows attestation status via `getContinuityBounds(...).isAttested`, generates a proof, and submits it to the vault live | not-attested-yet · proving · verifying · stored · prover-unavailable |

Every consequential action follows one lifecycle: `idle → validating → wallet-request → wallet-rejected | tx-submitted → tx-pending(hash shown) → confirmed | reverted(decoded custom error name)`. Custom errors are decoded to human text via the ABI — a judge must never see a raw revert blob.

**The single most important UI element:** on `/loan/[id]`, every number is one click from either a source-chain explorer or a Creditcoin explorer. No unsourced figure appears anywhere in the application.

---

## 13. DEMO

### 13.1 Deterministic scenarios (`demo/scenarios.json`)

Four loans, all staged by us on the source chain, all labelled as staged:

| # | Scenario | Source-chain transactions | Expected outcome |
|---|---|---|---|
| A | **Legitimate** | `treasury → borrowerA` (disbursement); later `borrowerA → treasury` (repayment), where `borrowerA` was funded from an unrelated faucet address | `challenge()` reverts `NoBreach`. **This is the honest control and it must be demonstrated.** |
| B | **Prohibited circular flow** | `treasury → borrowerB`; `treasury → payerB`; `payerB → treasury` within `W` | `challenge()` succeeds: `BREACHED`, bond slashed, bounty paid |
| C | **Invalid challenge** | Cite an unrelated transfer as the funding leg | Reverts `FundingNotFromBoundTreasury` — shown as a pre-flight red X in the console |
| D | **Delinquent** | Disbursement only, `maturityBlock` passed | Anyone calls `markDelinquent()` |

`demo/seed.ts` executes the source-chain transfers, waits for attestation, generates proofs, submits facts, registers the originator, binds the treasury, and registers all four loans. `demo/reset.ts` redeploys clean. `demo/run.ts` prints the presenter's checklist with all pre-warmed hashes.

**The demo's structural advantage: every source-chain transaction is created hours in advance and is already attested. The only live action is a Creditcoin call, which is ~15 seconds. The slow chain is entirely in the past tense.**

### 13.2 Three-minute script

| Time | Beat |
|---|---|
| **0:00–0:15** | Black. One line: *"This is a private credit fund's loan book on Creditcoin. Every line is backed by a real Ethereum transfer. One line breaks a rule the fund itself published and bonded — and this contract will pay you to prove it."* WHAT / WHY / WHY CREDITCOIN in a single sentence |
| **0:15–0:40** | The Book. Four loans, bond posted, covenant `CIRCULAR_REPAYMENT` with window `W` shown as on-chain, immutable parameters. Terminal: `cast code $TOKEN` → bytecode (a token we do not control); `cast code $TREASURY` → `0x`. *"We deployed nothing on Ethereum."* |
| **0:40–1:10** | Open loan A. Walk the three tiers. Click a fact → source-chain explorer. Click the verification link → the Creditcoin transaction containing `TransactionVerified` from `0x0FD2`. *"The precompile proved inclusion. Our contract asserted the receipt succeeded — the precompile does not do that — decoded the transfer, and refused to store it twice."* |
| **1:10–1:50** | **The challenge, performed by the judge.** Open `/challenge`, pick loan B, run the dry-run: eleven conditions, all green. Submit from the judge's own wallet. One Creditcoin transaction, ~15 s: `CovenantBreached`, bond slashed, bounty paid to *their* address. The book updates to `BREACHED` |
| **1:50–2:15** | **Both negative controls, back to back.** Loan A: same button, reverts `NoBreach` — *"an honest loan is not breachable, and we did not have to be trusted for that."* Then a forged proof: one mutated Merkle sibling, submitted to the vault, rejected on-chain. Show the failed transaction hash |
| **2:15–2:40** | Kill the worker. Submit the same bundle from a plain script as any third party would. Identical result. *"The worker is orchestration. It is not a trusted source. Delete it and nothing about the outcome changes."* |
| **2:40–3:00** | Measured gas against the published formula; measured attestation latency P50/P90 from `docs/LATENCY.md`; then the limits slide — Ethereum only, readability only, Writability unreleased, absence unprovable, depth-1 covenant. *"This does not prove fraud. It proves a rule the fund published was not met."* Close on the contract address |

**Rules:** the challenge sequence is one unbroken take. If any time compression appears elsewhere, an elapsed counter runs continuously and the uncut recording is linked in the README. Label the staged transactions on screen and in the first fifteen seconds.

### 13.3 Fallbacks

| Failure | Fallback |
|---|---|
| Proof generation delayed | All demo facts are pre-warmed; `/verify` judge mode is optional and skipped if the prover is slow |
| Prover unavailable | Facts are already in the vault. The challenge is a pure Creditcoin call and is unaffected |
| Source-chain RPC slow | Only the explorer links are affected; the app reads from the vault, not the source chain |
| Wallet fails | A pre-funded backup wallet is loaded in a second browser profile; `demo/run.ts` prints both addresses |
| CC3 RPC degraded | Fall back to the recorded run; state on camera that the live segment is a recording and link the transaction hashes |
| Everything fails | The recorded 3-minute video is the submission artifact; the live session is a bonus |

### 13.4 Pre-demo checklist

`[ ]` `make demo-reset && make demo-seed` completed ≥ 2 h before · `[ ]` all facts `CONFIRMED` in the vault · `[ ]` judge wallet funded with CC3 testnet CTC · `[ ]` originator bond posted and `exposure` correct · `[ ]` loan B breach dry-run green · `[ ]` loan A dry-run red with `NoBreach` · `[ ]` forged-proof script ready with a pre-generated mutation · `[ ]` explorer tabs pre-opened · `[ ]` `docs/LATENCY.md` numbers current · `[ ]` backup wallet loaded · `[ ]` recorded video accessible offline.

---

## 14. GATE FAILURE PLAYBOOK

| Gate | Failure | Classification | Smallest correction |
|---|---|---|---|
| 0 | No chain attesting | `BLOCKED` | Post in `#buidl-ctc-qna` with output. **Do not build until resolved.** |
| 0 | Mainnet absent | `UNVERIFIED → resolved negative` | Use Sepolia. Architecture unchanged; delete every mainnet reference from the pitch |
| 1a | Import path fails | `MISMATCH` (expected) | Fix remapping to `contracts/write-ability/common/`; log in `DECISIONS.md`; report upstream |
| 2 | `getProof` fails on a transaction that exists | `UNVERIFIED` | Retry with a fresh transaction and a longer wait. If it persists, the prover may index only registered contracts → **pivot: deploy `demo/EvidenceEmitter.sol` on the source chain emitting a bespoke `EvidenceRecorded` event, adjust the decoder topic, and update the pitch to lead on the covenant mechanism rather than on "no source-chain contract."** The covenant, the challenge and the economics all survive intact; only one sentence of the pitch changes |
| 3 | `verifySingle` false, `getProof` succeeded | `MISMATCH` | Try `verifyAndEmitSingle` from a contract; the view and state-changing paths may differ. Time-box 2 h, then ask |
| 4 | Decoded fields wrong | `UNVERIFIED` | Fall back to `getLogsByEventSignature` + topic matching instead of positional indexing. If still wrong, dump `encodedTransaction` and compare chunk layout against `_decodeReceiptChunk` |
| 7 | A forged proof is **accepted** | **Critical protocol finding** | Stop. Report to the Creditcoin team immediately. Reporting it is worth more than anything else you could build that day |
| 8 | Latency P90 > 20 min | Expected | Nothing changes — the demo is already past-tense on the source chain. Publish the number |

---

## 15. MVP BOUNDARY

**MUST BUILD:** `EvidenceVault` (single-fact path) · `Clearbook` (originator, bond, treasury binding, register, claim, challenge, finalize) · covenant `0x01` · unit + invariant + security tests · Gate 0–7 integration scripts · worker (watch/prove/precheck/submit) · four frontend routes · four demo scenarios · forged-proof script · `README.md` + `docs/ATTESTCOIN_INTEGRATION.md` + `SECURITY.md` + `KNOWN_ISSUES.md` + `DECISIONS.md` · deck PDF · 3-minute video.

**SHOULD BUILD:** batch submission with both range guards · `markDelinquent` · `/verify` judge mode · `measure-latency.ts` + `docs/LATENCY.md` · `/health`.

**NICE TO HAVE:** a second covenant · a second reference consumer of `EvidenceVault` proving reusability · Mermaid diagrams rendered in the README.

**DO NOT BUILD:** any token · tokenomics · DAO or governance · proxy/upgradeability · admin keys beyond deployment · a second source chain · lending pool · interest-rate model · AI anything · mobile · microservices · a source-chain Clearbook contract · challenger bonds · dispute arbitration · a generic explorer.

Every feature must improve judge score, technical depth, sponsor alignment, product value, demo impact, or security. If it improves none, delete it.

---

## 16. SUBMISSION PACKAGE

`[ ]` `EvidenceVault` and `Clearbook` deployed on CC3 testnet, addresses in the README's first screenful
`[ ]` Contracts verified on the Creditcoin explorer (or, if unavailable, source + exact compiler settings + a `forge verify` command that reproduces the bytecode)
`[ ]` Public GitHub repo with README covering: what it is, the Attestcoin integration summary in the first 20 lines, deployed addresses, one-command reproduction, and the three-tier truthfulness statement
`[ ]` `docs/ATTESTCOIN_INTEGRATION.md` — the depth checklist: direct `0x0FD2` `verifyAndEmit`, runtime `chainKey` discovery via `0x0FD3`, third-party token logs (no source-chain contract), `receiptStatus == 1` assertion, **log-level** replay key hardened beyond the reference implementation, batch guards against the verified 10/1000 limits, measured gas vs the published formula, measured latency, and a candid "protocol limits we hit" section
`[ ]` `SECURITY.md` (threat model + invariants) · `KNOWN_ISSUES.md` (§9 verbatim) · `DECISIONS.md` · `TESTING.md` · `DEPLOYMENT.md` · `DEMO.md`
`[ ]` Architecture, sequence and state diagrams matching the implementation
`[ ]` 3-minute demo video + link to the uncut recording
`[ ]` Screenshots: The Book, evidence chain, breach confirmation, forged-proof rejection
`[ ]` Live demo URL
`[ ]` `forge test` green, `forge coverage` ≥ 90%, integration gate outputs committed under `integration/results/`
`[ ]` Six forged-proof rejection transaction hashes
`[ ]` Deck/whitepaper PDF
`[ ]` DoraHacks submission: name, sector **RWA**, description, Attestcoin integration summary, repo URL, deck URL, video URL, team details
`[ ]` **Submit by 5 September** — one day of margin. Last cycle's deadline extension is not a promise
`[ ]` Request DoraHacks project verification / poster / demo session
`[ ]` Post the build thread in the Creditcoin Discord and tag the project in `#buidl-ctc-qna`

---

## 17. JUDGE Q&A

**Why Creditcoin?** The precompile only exists here, and credit recording is what this chain was built for.
**Why Attestcoin?** Without it, "verified fact" means "our server said so." We slash money on these facts; a server's word is not an acceptable basis.
**Why not Ethereum alone?** The book, the bond and the covenant live on Creditcoin. Nothing of ours is deployed on Ethereum — that is the point.
**Why not an indexer?** An indexer is a trusted third party. Replace the precompile with an indexer and the challenge mechanism becomes "trust our backend," which is the thing we are eliminating.
**Why not a centralized oracle?** Same answer, plus it is the exact architecture Creditcoin's own positioning rejects.
**Why not a bridge?** Nothing moves. No assets cross. This is verified evidence, not value transfer.
**Why is this RWA?** Private credit is the largest RWA category by value, and its core defect is that portfolio reporting is self-attested. This makes portfolio claims evidence-bound.
**Why isn't this the tutorial?** The tutorial deploys a source-chain contract emitting bespoke events for a one-loan happy path. We deploy nothing on the source chain, read ordinary third-party ERC-20 logs, reason over relationships between multiple independently verified transactions, and have an adversarial path with economic consequences that the tutorial does not have.
**What is novel?** Multi-transaction covenant evaluation over cryptographically verified cross-chain evidence, with atomic self-verifying permissionless challenges and no dispute layer.
**What does Attestcoin verify?** That a specific transaction was included in an attested source-chain block, and it hands us the transaction's receipt.
**What does Clearbook determine?** Everything else: that the receipt succeeded, which log matters, what the log means, whether it matches a claim, and whether the covenant was breached.
**What remains trusted?** Ethereum finality, the Attestcoin attestor quorum, Creditcoin consensus, and the precompile implementation. Nothing else — explicitly not our worker, our frontend, our RPC, or the proof builder.
**Proof generation fails?** Nothing is mis-accepted; the system fails closed. Facts stay unsubmitted and any third party can submit them later.
**Ethereum reorg?** Attestors attest finalized blocks only. Beyond that we inherit Ethereum's finality assumption and we say so rather than claiming more.
**Replay?** `keccak(chainKey, blockHeight, txIndex, logIndex)` — log-level, deliberately stricter than the reference implementation's transaction-level key, because one transaction can carry several relevant logs.
**Malicious challenger?** An invalid challenge reverts. There is no bond to steal, no window to grief, no arbitrator to corrupt.
**Malicious originator?** It can evade by funding through an address it never binds — depth-1 detection is the honest limit, stated in `KNOWN_ISSUES.md`. It cannot forge evidence, reuse evidence, cite a reverted transaction, or withdraw its bond while exposed.
**False accusations?** Impossible by construction: a challenge either satisfies eleven on-chain conditions over verified facts or it reverts. And it never says "fraud" — it says a published rule was not met.
**Who pays?** In production, originators pay to publish a bonded, auditable book because it is what lets allocators underwrite them; challengers are paid by the bounty.
**Roadmap?** More evidence types (multi-hop funding, disbursement-side covenants), more source chains as Attestcoin adds them, and `EvidenceVault` as a shared public primitive for other Creditcoin dApps.

---

## 18. POST-HACKATHON

**Customers:** private-credit originators that already settle in stablecoins, and the allocators underwriting them. **First production use case:** a bonded, evidence-backed borrowing-base certification published continuously instead of monthly by PDF. **Monetization:** per-originator subscription for publishing plus a fee on audited claims; bounties self-fund the challenger side. **Why Creditcoin stays relevant:** the evidence layer is the precompile, and the credit-record layer is the chain's founding purpose. **Additional evidence types:** multi-hop funding graphs, disbursement covenants, concentration limits computable from verified transfers, and — when Writability ships — enforcement actions pushed back to the source chain. **Security work needed:** a real audit (the CertiK credits are the natural home), commit–reveal challenges, and formal verification of the covenant predicate. **Legal work needed:** counsel review of covenant language, jurisdictional analysis of bonding, and disclosure that on-chain evidence is not a legal finding.
**What we cannot claim today:** any market size (we have no defensible figure and will not invent one), that any originator has committed to use this, that circular flow proves wrongdoing, or that a bonded book is a clean book.

---

## 19. FINAL AUDIT (Phase 14 — run before submitting)

`[ ]` Every claim in the README maps to code that exists — grep the README for capability words and verify each
`[ ]` No invented addresses; every address is either discovered at runtime, deployed by us, or verified against an official source
`[ ]` No `[U]` item from §1 is implemented as if verified; `KNOWN_ISSUES.md` lists all of them
`[ ]` No occurrence of "fraud", "proven fraud", "money laundering" or "criminal" anywhere in code, UI, docs, deck or video
`[ ]` The three-tier truthfulness separation appears in the UI, the README and the video
`[ ]` `receiptStatus == 1`, the log-level replay key, and the treasury signature binding are each visible in the first screenful of the integration doc
`[ ]` The demo's staged transactions are labelled as staged in the first fifteen seconds
`[ ]` `forge test` green from a clean clone; `make e2e` green against the live deployment
`[ ]` Worker killed mid-flight and restarted with no duplicate submission
`[ ]` Six forged-proof rejections recorded with transaction hashes
`[ ]` Gas and latency numbers are measured, not quoted
`[ ]` `DECISIONS.md` records whether the precompile reverts or returns false on a bad proof
`[ ]` DoraHacks rules re-read **in a browser** and diffed against §1.1
