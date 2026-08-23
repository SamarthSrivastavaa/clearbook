# Clearbook — what exists today

A precise inventory of the built product, refreshed 2026-08-23. Everything below
is implemented and executed unless explicitly marked otherwise.

For the narrative account — what Clearbook is, in plain language first — see
[OVERVIEW.md](OVERVIEW.md).

---

## 1. What it is

A private-credit loan book is a self-reported spreadsheet. Nobody outside the
fund can check whether a "repayment" was real third-party money or the fund
cycling its own capital back to itself.

Clearbook makes a published loan book **refutable**. An originator posts a bond,
publishes a covenant, and registers loans whose disbursement and repayment claims
must each cite a **cryptographically verified source-chain ERC-20 transfer**.
Anyone may then prove a covenant breach in a single permissionless transaction
and be paid half the slashed bond for doing so.

The differentiator: **Clearbook deploys nothing on the source chain.** Evidence
is ordinary third-party ERC-20 transfers on tokens we do not control — including
a real Ethereum mainnet USDC transfer between two addresses we hold no key for.

Evidence is a single global namespace: a verified fact backs **at most one claim,
across every originator**. Two originators are registered on the deployed book.

## 2. The mechanism

```
Source-chain transfer (Ethereum Sepolia)
        ↓
Attestcoin attests the finalized block          (~8–10 min)
        ↓
Block Prover precompile 0x…0FD2 verifies inclusion   (on Creditcoin, 0.8s)
        ↓
EvmV1Decoder decodes the receipt; receiptStatus == 1 asserted by us
        ↓
EvidenceVault stores an immutable TransferFact
        ↓
Clearbook evaluates 11 covenant conditions
        ↓
challenge() slashes the bond, pays the challenger
```

## 3. Deployed

| Item | Value |
|---|---|
| Network | Creditcoin CC3 testnet, chainId **102031** |
| `EvidenceVault` | `0x5b6048C74165237fF4A8A3cfe1d38E6fE7b547Af` |
| `Clearbook` | `0xCA02D51722947d7a93EDBe398498667bab368315` |
| Protocol sink | `0x000000000000000000000000000000000000dEaD` (burn) |
| Block Prover precompile | `0x0000000000000000000000000000000000000FD2` |
| ChainInfo precompile | `0x0000000000000000000000000000000000000FD3` |
| Source chains | Ethereum Sepolia (chain key 1) and Ethereum Mainnet (chain key 3), resolved at runtime and never hardcoded |
| Source token | Canonical Sepolia WETH `0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9` |
| Live frontend | https://clearbook-sable.vercel.app |

Deployed with `cast send --create` rather than `forge script` — Creditcoin
headers omit `prevrandao`, which Foundry's local EVM requires (KNOWN_ISSUES
K-017). Every post-condition `Deploy.s.sol` would have asserted was verified
on-chain afterwards.

## 4. Smart contracts

Solidity 0.8.28, `via_ir = true` (mandatory — the official decoder triggers
"stack too deep" otherwise), `evm_version = cancun`.

| File | Lines | Role |
|---|---|---|
| `src/Clearbook.sol` | 383 | Originators, bonds, loans, claims, challenge |
| `src/EvidenceVault.sol` | 233 | Permissionless fact registry |
| `src/libraries/CovenantLib.sol` | 75 | Covenant conditions as a pure predicate |
| `src/interfaces/IEvidenceVault.sol` | 84 | Vault interface + events |
| `script/Deploy.s.sol` | 69 | Deployment with production guards |

### EvidenceVault

Permissionless — anyone may submit a fact. Step order is security-critical:

```
dedupe → verify → decode
```

`factId = keccak256(abi.encode(chainKey, blockHeight, txIndex, logIndex))`

This replay key is **log-level**, deliberately stricter than the reference
implementation's transaction-level key: one transaction routinely carries many
relevant `Transfer` logs (17 and 30 observed in real Sepolia transactions).
`logIndex` is **transaction-local** — an index into the receipt's own log array,
not the block-global index `eth_getLogs` returns.

Re-submitting a known fact returns the existing id without re-verifying and
without emitting. A batch path exists, split into `_validateBatch` / `_ingestOne`
(the split is load-bearing for `forge coverage --ir-minimum`).

### Clearbook

External functions: `registerOriginator`, `bindTreasury`, `topUpBond`,
`withdrawBond`, `registerLoan`, `claimRepayment`, `markDelinquent`, `finalize`,
`challenge`.

| Constant | Value |
|---|---|
| `MIN_BOND` | 1 ether |
| `BOND_PER_LOAN` | 1 ether |
| `SLASH_BPS` | 10,000 (100%) |
| `BOUNTY_BPS` | 5,000 (50% to challenger, 50% burned) |
| `REPAYMENT_BPS` | 10,000 |
| `WITHDRAW_COOLDOWN` | 1,200 blocks |

Treasury addresses are bound by **EIP-712 signature** over
`TreasuryBinding(uint256 originatorId, address ethAddress, uint256 nonce, uint256 chainId)`.
One address binds to at most one originator, ever. This proves control of a key
and **nothing more** — not that the address belongs to any person or company.

### The covenant: `CIRCULAR_REPAYMENT`

Declared by the originator at registration, published on-chain, **immutable
thereafter**. A rule you can change after publishing is not a covenant.

> No repayment may come from an address the originator's own treasury funded for
> at least the repayment amount, in the same token, within *N* source-chain
> blocks.

### The eleven conditions

Evaluated by `challenge()`; each has its own named error, so a failed challenge
says precisely which condition refused it.

| # | Condition | Error |
|---|---|---|
| 1 | The loan has a claimed repayment | `WrongStatus` |
| 2 | The challenge window is still open | `WindowClosed` |
| 3 | Both transfers are on the same source chain | `ChainMismatch` |
| 4 | Both transfers are of the same token | `TokenMismatch` |
| 5 | The address the treasury funded is the address that repaid | `NotTheSamePayer` |
| 6 | The funding came from a treasury this originator bound | `FundingNotFromBoundTreasury` |
| 7 | The payer received at least what it repaid | `FundingBelowRepayment` |
| 8 | The funding did not come after the repayment | `FundingNotBefore` |
| 9 | The two transfers fall inside the published window | `OutsideWindow` |
| 10 | The funding leg is not the repayment itself | `SameFact` |
| 11 | The funding leg is not the loan's own disbursement | `DisbursementNotFunding` |

Conditions 3–9 live in `CovenantLib` as a pure predicate; 1, 2, 10, 11 are
enforced in `Clearbook.challenge()`.

## 5. Frontend

Next.js 16 (app router), wagmi 3, viem 2, Tailwind 4, TypeScript 5.9.3 (ESM).
IBM Plex Sans / IBM Plex Mono. **No backend, no database** — every figure is a
direct chain read in the browser.

### Routes

| Route | Purpose |
|---|---|
| `/` | Landing page |
| `/book` | The shared book — claims across all originators |
| `/registry` | Evidence registry — what is verified, and what consumed it |
| `/loan/[id]` | Claim detail: covenant, evidence, result |
| `/challenge` | Challenge console — the investigation |
| `/verify` | Verify any Sepolia or mainnet transaction, read-only |
| `/docs` | Product and protocol documentation, 24 pages |
| `/api/prover` | CORS proxy to the Attestcoin proof builder (holds no secrets) |
| `/opengraph-image`, `/icon` | Rendered in code by `ImageResponse` |

### Components

`Chrome` (nav + permanent contract identity bar), `Evidence` (the evidence rail),
`Artifacts` (real UI fragments quoted on the landing page), `ProvenanceChain`
(hero artifact, animated), `LiveSignal` (live chain state), `Plate` (photographic
plates with CSS fallback), `ScenarioGuide`, `States`, `ui`.

### Design system

Warm paper `#fbfaf8`, near-black ink `#17160f`, deep `#14130f`, one accent
`#0e4b4b`. Semantic colour is reserved for protocol state only: verified
`#1f6f43`, breach `#a3301c`, pending `#87680f`.

**The motif is the provenance rail** — a 1px vertical rule with square nodes,
used wherever one thing causes the next: the hero chain, the evidence sequence,
the challenge stages, the verification path.

### The three registers

Kept visually and structurally distinct everywhere:

1. **Source-chain fact** — what the cryptography establishes
2. **Clearbook interpretation** — what this application decides on top of it
3. **Not claimed** — what is never asserted

## 6. Worker

A daemon (`while (!stopping)` + tick + interval, SIGINT/SIGTERM graceful
shutdown, health server). **Orchestration only — never authoritative.**

```
DISCOVERED → WAITING_ATTESTATION → PROVED → SUBMITTED → CONFIRMED
             (PRECHECK_FAILED / FAILED are terminal side-exits)
```

Files: `main`, `db`, `watch`, `discover`, `prove`, `precheck`, `submit`,
`health`, `log`, `provider`, `index` (event projection).

Postgres holds the scan cursor, the fact state machine, and latency samples. The
`UNIQUE (chain_key, block_height, tx_index, log_index)` constraint mirrors the
on-chain `factId` exactly. **The database is bookkeeping, never truth** — the
frontend has zero dependency on it, and nothing in it can make the vault accept
anything.

If the worker submits a corrupted bundle, `verifyAndEmit` fails and the
transaction reverts. If it disappears, anyone can submit the identical bundle.

## 7. Gates — all pass

| Gate | Proves | Result |
|---|---|---|
| 0 | Chain discovery, attestation live and advancing | PASS |
| 1a | Real package paths compile, verifier interface resolves | PASS |
| 2 | Contracts build, `forge fmt`, `solhint` clean | PASS |
| 3 | 95 tests, 100% line coverage of `src/` | PASS |
| 2/3 | Proof obtained, precompile `verify()` returns true | PASS |
| 4 | On-chain decode matches the source chain — 120/120 checks over 10 facts | PASS |
| 5 | Circular flow breaches; honest loan reverts | PASS |
| 6 | Bond slashed, bounty paid, sink credited — all exact | PASS |
| 7 | Six forged proofs rejected on-chain | PASS |
| 8a | Worker crash recovery: no fact lost, no duplicate submission | PASS |

### The executed breach

Loan 2 — a genuine circular flow staged on Sepolia — was challenged by a third
party and slashed: bond **−1.0 tCTC**, challenger **+0.5**, sink **+0.5**,
exposure released, invariants I1/I2 held.
Challenge tx `0x3a22a0fffd9d78ed6547658406f641fb337fe9e4638ac9e35eaa9c9020e93d47`.

### The six forged-proof rejections

A valid proof mutated six ways — a Merkle sibling, a continuity root, the lower
endpoint digest, the block height, an `isLeft` flag, one byte of the transaction.
All six reverted on-chain:

```
0x160fb3332eba2c20645a3a4d17393e3b5903d06ac34ffcae5bf209264ab1af10
0x55f1ca630dc215fd1cece2ccee74f82776564cf378d609ea065423bf03fc5efd
0x52924b602830c8ff6c28a7a3bd3df0f88fa1d2d11d6d59a2d172e7a9827b5588
0xc535729c4b9d078207977bed2f2c77d7acd4dda17cb77e5eaecd767770374a54
0x8ac73141b462c811b183a4b0d15588e1c83fe8be5a63e54c0e6b127a5b73606e
0xf0943102eaf4187a4b238609a6a26dbbd90974a09d795b1db3adc1ab49501d6c
```

### Gate 8a found a real defect

`tick()` only claimed `DISCOVERED` rows, and the in-process catch block that
resets state never runs on SIGKILL. A hard kill left rows stranded in
`WAITING_ATTESTATION` / `PROVED` / `SUBMITTED` **permanently — the fact was
silently lost.** Proven empirically before being fixed. `Db.requeueStranded()`
now runs at startup. The "no duplicate" half always held: every factId remained
stored exactly once across all four crash scenarios, verified by counting
on-chain `TransferFactStored` logs.

### Measured, not quoted

| Metric | Value |
|---|---|
| Broadcast → usable evidence | ~8–10 min (97–99% is the attestation wait) |
| `verify()` at the precompile | 0.8 s |
| Deploy both contracts | 0.0018 tCTC |
| `submitTransferFact` | ~226,000 gas / 0.000113 tCTC |
| `challenge()` (successful) | ~180,000 gas |

## 8. Demo system

`npm run demo:stage` → `demo:prove` → `demo:seed` → `demo:run`, plus
`demo:reset` and `recheck`. Ten transfers staged on Sepolia across two rounds;
state in `demo/staged/`.

Three scenarios: **clean claim**, **covenant breach**, **invalid challenge**.
The UI labels demo mode permanently in the chrome bar. **Seed 2–5 hours before
presenting** — the challenge window is 1,200 Creditcoin blocks (~5 h).

## 9. Testing

- **92 Foundry tests**, 6 suites, 0 failures
- **100% line coverage** of `src/` (151/151); branch coverage 75.61%, recorded not hidden
- **5 invariants** at 4,096 calls each, plus `test_handler_reaches_a_breach` — a
  permanent guard added after the invariant suite was found to be vacuously
  passing without ever reaching `challenge()`
- Client-side logic guards: `check:predicate` (the 11-condition mirror),
  `check:verify` (the judge-mode path)

## 10. Documentation

`README` · `DECISIONS` (49 entries) · `KNOWN_ISSUES` (21) · `SECURITY` ·
`TESTING` · `DEPLOYMENT` · `DEMO` · `PLATES` · `docs/ARCHITECTURE` ·
`docs/ATTESTCOIN_INTEGRATION` · `docs/THREAT_MODEL` (T1–T26) · `docs/LATENCY`.

Evidence classes used throughout: **[P]** primary doc · **[C]** source-verified ·
**[L]** live-verified · **[I]** inference · **[U]** unverified · **[B]** blocked.
Nothing is marked `[L]` that has not actually been executed.

## 11. Honest limits

- **The covenant is bounded, not universal.** An originator funding a payer from
  an address it never binds does not breach it. Detection is depth-1 by
  construction — which is why this is framed as a covenant the originator chose,
  not as fraud detection.
- **Absence is unprovable.** Merkle inclusion proofs cannot show a transaction
  did *not* occur. Clearbook never certifies a book as clean.
- **An address is not an entity.** A bound treasury is an address that produced a
  signature. Nothing more.
- **Ethereum only.** Sepolia and Mainnet are what the attestor set supports.
- **K-021:** the startup requeue assumes a single worker instance. Two instances
  would duplicate *work*, never *evidence*.
- **K-019:** challenge-console evidence discovery is bounded to a 20,000-block
  lookback. Older facts remain citable by identifier.

## 12. Outstanding

**Not built:** `integration/e2e-full.ts` and a `make e2e` target — the only
unticked code line in the §19 audit. It largely re-treads Gates 2/4/5/6, which
are separately recorded with transaction hashes.

**Not code:** deck PDF, 3-minute video, screenshots, DoraHacks submission, and
re-reading the DoraHacks rules in a browser against §1.1.

**Assets pending:** three photographic plates (`ledger`, `archive`, `seal`) —
briefs in `PLATES.md`. Each renders a deliberate CSS ruled-paper field until its
file lands, so the page is never in a broken state.

**Housekeeping:** `frontend/dev.log` and `frontend/tsconfig.tsbuildinfo` are
tracked despite being gitignored — they predate the ignore rule.
