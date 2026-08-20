# DEMO.md

> **Status: Phase 1 scaffold.** The demo cannot be staged until contracts exist (Phase 2/3), are deployed (Phase 5/6), and demo transactions are seeded (Phase 12). This file records the plan and the presenter checklist now so the demo is designed rather than improvised. Nothing here has been rehearsed yet.

---

## The structural advantage

**Every source-chain transaction is created hours in advance and is already attested. The only live action is a Creditcoin call, which takes ~15 seconds.** The slow chain is entirely in the past tense.

Phase 0 measured the real numbers behind this: Sepolia attestation lags the chain head by **36–41 blocks (~7–8 minutes)**, granted in batches of 10 roughly every 2 minutes. So seeding must complete **≥ 2 hours** before any demo — comfortably beyond the measured worst case, with room for a retry.

---

## Scenarios (`demo/scenarios.json`)

Four loans, **all staged by us**, all labelled as staged on screen and in the first fifteen seconds of the video.

| # | Scenario | Source-chain transactions | Expected outcome |
|---|---|---|---|
| A | **Legitimate** | `treasury → borrowerA`; later `borrowerA → treasury`, where `borrowerA` was funded from an unrelated faucet address | `challenge()` reverts `FundingNotFromBoundTreasury` (condition 6). **The honest control — it must be demonstrated.** |
| B | **Prohibited circular flow** | `treasury → borrowerB`; `treasury → payerB`; `payerB → treasury` within `W` | `challenge()` succeeds: `BREACHED`, bond slashed, bounty paid |
| C | **Invalid challenge** | cite an unrelated transfer as the funding leg | reverts `FundingNotFromBoundTreasury` (condition 6), shown as a pre-flight red X |

> **Correction against BUILD.md §13.1.** That table says scenario A reverts `NoBreach`. It does not: `NoBreach` does not exist as an error. §5.3 assigns a distinct error to each of the eleven conditions, and `NoBreach` would be unreachable, so it is not declared (DECISIONS D-023). Scenario A fails at **condition 6**, because the faucet that funded `borrowerA` is not a bound treasury.
>
> This is a better beat than the original: the contract names the precise reason the honest loan cannot be breached, rather than just refusing.
>
> Note that A and C therefore revert with the **same** error. They remain different scenarios — A cites a genuine unrelated funding source, C cites an unrelated transfer — but do **not** narrate the error name as the thing that distinguishes them.
| D | **Delinquent** | disbursement only, `maturityBlock` passed | anyone calls `markDelinquent()` |

Scenario A is the one that proves the mechanism *discriminates*. A detector that always fires detects nothing.

---

## Three-minute script

| Time | Beat |
|---|---|
| **0:00–0:15** | Black. *"This is a private credit fund's loan book on Creditcoin. Every line is backed by a real Ethereum transfer. One line breaks a rule the fund itself published and bonded — and this contract will pay you to prove it."* State that the transactions are staged by us. |
| **0:15–0:40** | The Book: four loans, bond posted, covenant `CIRCULAR_REPAYMENT` and window `W` shown as on-chain immutable parameters. Terminal: `cast code $TOKEN` → bytecode; `cast code $TREASURY` → `0x`. *"We deployed nothing on Ethereum."* |
| **0:40–1:10** | Loan A evidence chain, three tiers. Click a fact → source-chain explorer. Click verification → the Creditcoin transaction containing `TransactionVerified` from `0x0FD2`. *"The precompile proved inclusion. Our contract asserted the receipt succeeded — the precompile does not do that — decoded the transfer, and refused to store it twice."* |
| **1:10–1:50** | **The challenge, performed by the judge.** `/challenge`, loan B, dry-run: eleven conditions green. Submit from the judge's own wallet. One Creditcoin transaction, ~15 s: `CovenantBreached`, bond slashed, bounty paid to *their* address. |
| **1:50–2:15** | **Both negative controls, back to back.** Loan A: same button, reverts `FundingNotFromBoundTreasury` — *"condition six. The address that funded this borrower was never bound by the originator, so this is not a breach — and we did not have to be trusted for that."* Then a forged proof: one mutated Merkle sibling, rejected on-chain. Show the failed transaction hash. |
| **2:15–2:40** | Kill the worker. Submit the same bundle from a plain script as any third party would. Identical result. *"The worker is orchestration. Delete it and nothing about the outcome changes."* |
| **2:40–3:00** | Measured gas against the published formula; measured attestation latency P50/P90; then the limits — Ethereum only, readability only, Writability unreleased, absence unprovable, depth-1 covenant. *"This does not prove fraud. It proves a rule the fund published was not met."* Close on the contract address. |

**Rules.** The challenge sequence is one unbroken take. If time is compressed anywhere else, an elapsed counter runs continuously and the uncut recording is linked in the README.

---

## Language discipline — non-negotiable

BUILD.md §0.4 makes these hard requirements. A violation is a bug, not a style note.

| Never say | Always say |
|---|---|
| "Fraud proven" | "Prohibited circular flow under covenant `CIRCULAR_REPAYMENT`" |
| "This wallet belongs to the fund" | "This address was bound to the originator by signature at block N" |
| "The loan was repaid" | "A transfer of X token to a bound treasury was verified; Clearbook interprets it as repayment of loan L under the registered claim" |
| "Verified on Ethereum" | "Inclusion of the transaction in an attested source-chain block was verified by the Creditcoin Block Prover precompile" |
| "Detects money laundering" | "Detects the specific, bounded on-chain pattern defined by the covenant" |

The words *fraud*, *proven fraud*, *money laundering* and *criminal* must appear nowhere in code, UI, docs, deck or video (BUILD.md §19).

---

## Pre-demo checklist

- [ ] `make demo-reset && make demo-seed` completed **≥ 2 h** before
- [ ] all facts `CONFIRMED` in the vault
- [ ] judge wallet funded with CC3 testnet CTC
- [ ] originator bond posted and `exposure` correct
- [ ] loan B breach dry-run green
- [ ] loan A dry-run red with `NoBreach`
- [ ] forged-proof script ready with a pre-generated mutation
- [ ] explorer tabs pre-opened
- [ ] `docs/LATENCY.md` numbers current
- [ ] backup wallet loaded in a second browser profile
- [ ] recorded video accessible offline

## Fallbacks

| Failure | Fallback |
|---|---|
| Proof generation delayed | all demo facts are pre-warmed; `/verify` judge mode is optional and skipped |
| Prover unavailable | facts are already in the vault; the challenge is a pure Creditcoin call and is unaffected |
| Source-chain RPC slow | only explorer links are affected; the app reads from the vault |
| Wallet fails | pre-funded backup wallet in a second profile; `demo/run.ts` prints both addresses |
| CC3 RPC degraded | fall back to the recorded run; **state on camera** that the segment is a recording and link the transaction hashes |
| Everything fails | the recorded 3-minute video is the submission artifact; the live session is a bonus |
