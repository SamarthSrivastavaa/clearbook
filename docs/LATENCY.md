# Latency

Measured, not quoted. BUILD.md §1.2 lists end-to-end latency for a fresh transaction as `[U]`; this closes it.

Every figure below comes from `integration/measure-latency.ts`, which broadcasts a real Sepolia transfer and times each stage through to the precompile ruling on it. Raw samples: [`integration/results/latency-samples.json`](../integration/results/latency-samples.json).

---

## The number that matters

**A freshly broadcast transaction becomes usable evidence in roughly 8 to 10 minutes**, and essentially all of that is waiting for attestation.

| Stage | Sample 1 | Sample 2 |
|---|---|---|
| broadcast → included | 8.5s | 3.8s |
| **included → attested** | **564.8s** | **481.9s** |
| proof fetch | 3.1s | 0.8s |
| `verify()` at `0x0FD2` | 0.8s | 0.7s |
| **total** | **578.3s** | **488.7s** |

| Metric | p50 | p90 |
|---|---|---|
| broadcast → verified | 578.3s (9.6 min) | 578.3s |
| attestation wait | 564.8s | 564.8s |
| `verify()` call | 0.8s | 0.8s |

Two samples is a small n, and the p50/p90 are reported for completeness rather than statistical weight. The shape of the result is not in doubt: **attestation is 97–99% of the total**, and everything else is under four seconds.

---

## Reading it correctly

The published "~15 seconds" figure refers to **on-chain verification only, after attestation**. Our measurement agrees and then some — `verify()` returns in **0.8 seconds**.

But that is not the number a user experiences. The honest end-to-end figure is ~8–10 minutes, and quoting the 15-second number alone would be misleading. Both belong in any claim we make.

**Why attestation dominates, and why that is correct.** Attestors attest *finalized* source-chain blocks. Ethereum finality is roughly 64 blocks (~12.8 minutes at 12s blocks), and the measured attestation lag sits at **40–44 blocks** — comfortably inside it. This is not slowness to engineer away; it is the security property that makes a verified fact meaningful. A faster attestation would mean attesting blocks that could still reorg.

Independently, `integration/gate0-lag.ts` measured attestation advancing in **batches of 10 blocks roughly every 2 minutes**, with the lag oscillating in a stable 36–41 block band rather than growing. The 40–44 blocks observed here is the same behaviour under load.

---

## Consequences for the design

**The demo is unaffected, by construction.** BUILD.md §13's structural advantage is that every source-chain transaction is created and proven hours in advance, so the only live action is a single Creditcoin call. That call is the 0.8-second one. All five demo transactions were staged and proven well ahead of time (`demo/staged/proven-facts.json`).

**BUILD.md §14's Gate 8 contingency does not trigger.** It anticipated a P90 above 20 minutes and concluded "nothing changes — publish the number." Measured P90 is **9.6 minutes**, less than half that.

**The worker's timeouts are correctly sized.** `PROOF_WAIT_TIMEOUT_MS` defaults to 45 minutes against a measured worst case of 9.6 — roughly 4.7× headroom, which is appropriate for a value that only matters when something has gone wrong.

**Nothing in the protocol depends on timing.** All windows are counted in blocks, never seconds: `circularWindow` in source-chain blocks, `challengeWindow` and `withdrawCooldown` in Creditcoin blocks. `block.timestamp` appears nowhere in consequential logic (BUILD.md §3.3). These latency figures inform operations and expectations; they do not feed the contracts.

---

## Method

```
npm run latency          # one sample
npx tsx integration/measure-latency.ts 5   # five
```

Each sample broadcasts a 0.0001 WETH transfer from the demo treasury, then times:

1. **broadcast → included** — until the transaction has a receipt
2. **included → attested** — polling the proof builder until it reports the block attested *and* present in its cache
3. **proof fetch** — `getProof`
4. **verify** — `verify()` at the Block Prover precompile

Samples accumulate across runs, so the percentiles improve as more are taken.

Verification uses the **read-only** `verify()` view, so measurement costs no Creditcoin tokens. It does spend a little Sepolia gas to create each subject transaction.

---

## What is not measured yet

**Gas.** BUILD.md §16 requires measured gas against the published formula (`≈ 2.3e-5 + 2.9e-7 × continuityHashCount` CTC). What is known so far: CC3 gas price is **0.5 gwei**, and deploying both contracts costs **~0.0015 tCTC** (~3M gas). Per-submission gas for `submitTransferFact` needs a deployed vault, and must be measured under `via_ir = true`, since that setting changes code generation (DECISIONS D-018).

**`verifyAndEmit` latency.** Only the read-only `verify()` has been timed. The state-changing overload additionally pays for a Creditcoin transaction — expected to be one block, but unmeasured.
