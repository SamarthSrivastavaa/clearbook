# SECURITY.md

Status: **Phase 0.** No contract is deployed and no contract code exists yet. This file records the trust model and the invariants that Phase 2+ code must satisfy, plus what Phase 0 actually established. It will grow as the threat model in BUILD.md §6 is implemented and tested.

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

**The proof builder is untrusted.** It supplies proof *material*; the precompile is what makes that material meaningful. A malicious proof builder can deny service; it cannot forge a fact. `[I]` — the "cannot forge" half becomes `[L]` only when Gate 7's six forgery mutations are all rejected.

---

## 2. What Phase 0 established

| Claim | Class | Evidence |
|---|---|---|
| The ChainInfo precompile `0x…0fd3` reports supported chains and live attestation state | **[L]** | `results/gate0-*.json` |
| Chain keys are discoverable at runtime; nothing needs hardcoding | **[L]** | `resolveChainKey()` used by every script |
| Attestation is live and advancing on both supported chains | **[L]** | +30 blocks / 6 min, both chains — `results/gate0-lag-*.json` |
| Attestation lag vs source head is bounded and stable (Sepolia 36–41 blocks) | **[L]** | 7-sample observation |
| The proof builder serves proofs for ordinary third-party transactions | **[L]** | Two unrelated Sepolia txs — DECISIONS D-009 |
| The Block Prover precompile `0x0FD2` verifies a real proof (`verify()` → `true`) | **[L]** | `results/gate2-gate3-*.json` |
| `calculateTxIndex()` agrees with the source chain's own `transactionIndex` | **[L]** | 4 and 1, both matched |
| A verified receipt decodes to the correct token/from/to/amount | **[L]** | 11/11 cross-checks vs source RPC, twice |
| ERC-20 `Transfer` topic0 constant is correct | **[L]** | `cast keccak` — DECISIONS D-011 |
| Transaction-local `logIndex` ≠ block-global `logIndex` in real data | **[L]** | DECISIONS D-012 |
| The precompile's **failure** behaviour (revert vs `false`) | **[U]** | Not exercised — Gate 7 |
| Forged proofs are rejected | **[U]** | Not exercised — Gate 7 |

**The success path is proven; the failure path is not.** No security claim in this document rests on the failure path until Gate 7 passes.

---

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

## 6. Global invariants (to be asserted in fuzz tests, Phase 3)

| | Invariant |
|---|---|
| `I1` | `address(this).balance >= Σ originators[i].bond` |
| `I2` | `bond >= exposure` for every originator |
| `I3` | every `factId` backs at most 1 claim |
| `I4` | terminal states (`BREACHED`, `SETTLED`) never transition |
| `I5` | no stored fact came from a `receiptStatus != 1` transaction |
| `I6` | `exposure == bondPerLoan × count(status ∈ {REGISTERED, REPAYMENT_CLAIMED, DELINQUENT})` |

Status: **not yet implemented** — no contracts exist. Phase 3 gate.

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

## 9. Not yet addressed

Everything in BUILD.md §6 (T1–T26) is **unimplemented and untested** — there is no contract to attack yet. The threat table becomes live in Phase 3 (unit/security tests) and Phase 11 (hardening against the live deployment).

Deliberately accepted for v1, per BUILD.md: **challenge front-running** (T16 — commit–reveal is the production fix), and **reorg after attestation** (T25 — inherited from the attestor set).
