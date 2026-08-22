# DEMO.md

> **Status: fully staged and executed on-chain.** Contracts deployed, all five facts stored in the vault, a real breach proven and slashed, and both negative controls confirmed. The scenarios below have run for real — the transaction hashes are in `README.md` and `integration/results/`.

---

## The structural advantage

**Every source-chain transaction is created hours in advance and is already attested. The only live action is a Creditcoin call, which takes ~15 seconds.** The slow chain is entirely in the past tense.

Phase 0 measured the real numbers behind this: Sepolia attestation lags the chain head by **36–41 blocks (~7–8 minutes)**, granted in batches of 10 roughly every 2 minutes. So seeding must complete **≥ 2 hours** before any demo — comfortably beyond the measured worst case, with room for a retry.

---

## Scenarios (`demo/scenarios.json`)

Four loans, **all staged by us**, all labelled as staged on screen and in the first fifteen seconds of the video.

| # | Scenario | Source-chain transactions | Expected outcome |
|---|---|---|---|
| A | **Legitimate** | `treasury → borrower` (block 11538664); later `borrower → treasury` (block 11538692) | `challenge()` reverts `DisbursementNotFunding` (condition 11). **The honest control — it must be demonstrated.** |
| B | **Prohibited circular flow** | `treasury → payer` (11538687); a **second, distinct** `treasury → payer` (11538688); `payer → treasury` (11538689) | `challenge()` succeeds: `BREACHED`, bond slashed, bounty paid |
| C | **Invalid challenge** | cite an unrelated transfer as the funding leg | reverts `NotTheSamePayer` (condition 5), shown as a pre-flight red X |

**All five source-chain transactions are staged and proven** — 5/5 verified by the precompile, 40/40 cross-checks. Run `npm run demo:run` for the live checklist with explorer links.

> **Corrections against BUILD.md §13.1**, both discovered by building the thing.
>
> **1 · `NoBreach` does not exist.** §5.3 assigns a distinct error to each of the eleven conditions, which makes `NoBreach` unreachable, so it is not declared (DECISIONS D-023). Every failed challenge names the condition that failed.
>
> **2 · Neither negative control fails at condition 6.** Verified on-chain: loan A citing its own disbursement reverts **`DisbursementNotFunding`** (condition 11); citing an unrelated transfer reverts **`NotTheSamePayer`** (condition 5), because condition 5 is evaluated first.
>
> **Scenario A fails at condition 11, not condition 6.** As staged, the borrower is never separately funded in WETH, so the only `treasury → borrower` transfer in existence is the disbursement itself — which condition 11 excludes. The revert is `DisbursementNotFunding` (DECISIONS D-042).
>
> This is the better demonstration. Condition 11 exists precisely to stop an originator citing its own disbursement as the funding leg, and scenario A shows the mechanism refusing exactly that. Narrate the condition, not the error name — A and C fail for genuinely different reasons even where the wording is similar.

Scenario A is the one that proves the mechanism *discriminates*. A detector that always fires detects nothing.

---

## Three-minute script

| Time | Beat |
|---|---|
| **0:00–0:15** | Black. *"This is a private credit fund's loan book on Creditcoin. Every line is backed by a real Ethereum transfer. One line breaks a rule the fund itself published and bonded — and this contract will pay you to prove it."* State that the transactions are staged by us. |
| **0:15–0:40** | The Book: four loans, bond posted, covenant `CIRCULAR_REPAYMENT` and window `W` shown as on-chain immutable parameters. Terminal: `cast code $TOKEN` → bytecode; `cast code $TREASURY` → `0x`. *"We deployed nothing on Ethereum."* |
| **0:40–1:10** | Loan A evidence chain, three tiers. Click a fact → source-chain explorer. Click verification → the Creditcoin transaction containing `TransactionVerified` from `0x0FD2`. *"The precompile proved inclusion. Our contract asserted the receipt succeeded — the precompile does not do that — decoded the transfer, and refused to store it twice."* |
| **1:10–1:50** | **The challenge, performed by the judge.** `/challenge`, loan B, dry-run: eleven conditions green. Submit from the judge's own wallet. One Creditcoin transaction, ~15 s: `CovenantBreached`, bond slashed, bounty paid to *their* address. |
| **1:50–2:15** | **Both negative controls, back to back.** Loan A: same button, reverts `DisbursementNotFunding` — *"condition eleven. The only transfer from this treasury to this borrower is the disbursement itself, and citing that would make every honest loan look circular. So this is not a breach — and we did not have to be trusted for that."* Then a forged proof: one mutated Merkle sibling, rejected on-chain. Show the failed transaction hash. |
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

## The challenge window expires — seed close to the demo

The covenant's challenge window is **1,200 Creditcoin blocks ≈ 5 hours** (measured block time: 15.0 s). Once it closes, `challenge()` refuses with `WindowClosed` *before* it ever evaluates the covenant, so:

- **the breach can no longer be performed**, and
- **the negative controls stop being demonstrable** — an honest loan then refuses with `WindowClosed` rather than the interesting `DisbursementNotFunding`.

This is correct contract behaviour, not a defect, but it makes seeding time-sensitive in both directions:

| | Constraint |
|---|---|
| **No earlier than** | ~5 h before the demo, or the window closes mid-presentation |
| **No later than** | ~2 h before, so attestation (7–8 min, batched) has margin for a retry |

**Seed in that window.** `npm run demo:seed` prints exactly how many minutes remain and writes `blocksRemaining` to `demo/staged/clearbook-state.json`.

The seeding path is re-runnable by design: it reuses the existing originator when the treasury is already bound, and always selects the **newest** proven fact per role, because every earlier round's facts are already consumed and would fail with `FactAlreadyUsed`.

```
npm run demo:stage    # broadcast fresh source-chain transfers
npm run demo:prove    # wait for attestation, fetch and verify proofs
npm run gate4         # submit the facts to the vault
npm run demo:seed     # register loans, claim, leave B challengeable
npm run demo:run      # presenter checklist
```

`npm run demo:reset` redeploys clean if the deployment itself must be replaced. It is a dry run unless given `--confirm`, and it never edits `.env` — repointing the app is a decision, not a side effect.

---

## Pre-demo checklist

- [ ] `npm run demo:seed` run **2–5 h before** — challenge window still open at showtime
- [ ] `npm run demo:stage` and `npm run demo:prove` completed **≥ 2 h** before
- [ ] `npm run demo:run` shows all facts verified and every live check OK
- [ ] all facts `CONFIRMED` in the vault
- [ ] judge wallet funded with CC3 testnet CTC
- [ ] originator bond posted and `exposure` correct
- [ ] loan B breach dry-run green — all eleven conditions
- [ ] loan A dry-run red at condition 11 (`DisbursementNotFunding`)
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
| Wallet fails | pre-funded backup wallet in a second profile; `npm run demo:run` prints the live state |
| CC3 RPC degraded | fall back to the recorded run; **state on camera** that the segment is a recording and link the transaction hashes |
| Everything fails | the recorded 3-minute video is the submission artifact; the live session is a bonus |
