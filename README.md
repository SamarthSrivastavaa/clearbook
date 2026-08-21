# Clearbook

**Evidence-bound covenant compliance for credit originators, on Creditcoin.**

A private-credit loan book is a self-reported spreadsheet. Nobody can check whether a "repayment" was real third-party money or the fund cycling its own. Clearbook makes a published loan book **refutable**: an originator posts a bond, publishes a covenant, and registers loans whose disbursement and repayment claims must each cite a cryptographically verified source-chain `Transfer`. Anyone may then prove a covenant breach in a single permissionless transaction — and get paid for it.

## Attestcoin integration, in short

Clearbook's `EvidenceVault` calls the Creditcoin **Block Prover precompile at `0x…0FD2`** (`verifyAndEmit`) to prove that a specific Ethereum transaction was included in an attested block, then decodes the returned receipt with the official `EvmV1Decoder`. On top of the reference integration it adds:

- **Runtime `chainKey` discovery** via the ChainInfo precompile `0x…0FD3` — no chain key is hardcoded anywhere.
- **`receiptStatus == 1` asserted by us** — the precompile does *not* check whether the source transaction succeeded.
- **Log-level replay protection** — `keccak(chainKey, blockHeight, txIndex, logIndex)`, deliberately stricter than the reference implementation's transaction-level key, because one transaction routinely carries many relevant `Transfer` logs (we measured 17 and 30 in real transactions).
- **Ordinary third-party ERC-20 logs** — Clearbook deploys **nothing** on the source chain.

Full detail, including a candid "protocol limits we hit" section: [`docs/ATTESTCOIN_INTEGRATION.md`](docs/ATTESTCOIN_INTEGRATION.md).

---

## Build status

> **Mid-build.** Contracts are written, tested and verified against live infrastructure but **not yet deployed** — that needs a funded Creditcoin testnet account. Everything below states what has actually been demonstrated.

| Phase | Gate | Status |
|---|---|---|
| 0 — Protocol verification | Gate 0 · 2 · 3 | **PASS** |
| 1 — Repository bootstrap | Gate 1a | **PASS** |
| 2 — Contracts | Gate 2 (build · fmt · lint) | **PASS** |
| 3 — Tests | Gate 3 (92 tests · 100% line coverage of `src/`) | **PASS** |
| 7 — Batch path | — | built |
| 8 — Worker | Gate 8a | built · DB unverified |
| 9 — Frontend | — | four routes |
| 11 — Forged-proof rejection | **Gate 7 (part A)** | **PASS — 6/6 rejected** |
| 5 · 6 · 10 · 12 — Deploy · challenge · e2e · demo | Gates 4 · 5 · 6 | needs deployment |

**Deployed addresses:** none yet. They will appear here, in this screenful, once Phase 5 deploys them.

### What has been demonstrated live

**The proof path works on transactions nobody staged for us.** Two arbitrary third-party Sepolia transactions — tokens and contracts we do not control — were proven and verified end to end, 11/11 field checks each. That retires the project's largest technical risk: the proof service serves *ordinary* transactions, so Clearbook can deploy nothing on Ethereum.

**And on transactions we did create.** Five staged transfers on canonical WETH, forming the demo's honest and circular scenarios: **5/5 proven and verified, 40/40 cross-checks**.

**Forged proofs are rejected.** A valid proof was mutated six ways — a Merkle sibling hash, a continuity root, the lower endpoint digest, the block height, an `isLeft` flag, and one byte of the encoded transaction. **All six rejected**, with descriptive reasons. This also settled a contradiction in the protocol documentation: the precompile **reverts** rather than returning false.

**Attestation is live and bounded.** Both supported chains advance +30 blocks per 6 minutes, in batches of 10 roughly every 2 minutes. Sepolia's lag sits at 36–44 blocks — consistent with attestors attesting *finalized* blocks.

**Latency is measured, not quoted.** A freshly broadcast transaction becomes usable evidence in **~8–10 minutes**, of which **97–99% is the attestation wait**. The precompile's `verify()` itself returns in **0.8 seconds**. Both numbers matter: the second is the one the protocol advertises, the first is the one a user experiences.

Raw evidence: [`integration/results/`](integration/results/) and [`demo/staged/`](demo/staged/). Reasoning and evidence classes: [`DECISIONS.md`](DECISIONS.md).

---

## Three tiers — read this before reading anything else

Clearbook is careful about the difference between what a blockchain proves and what a human might infer. These tiers are kept visually distinct in the UI and are enforced as a hard requirement in code and copy.

### 1. FACTUAL BLOCKCHAIN EVIDENCE
What the cryptography establishes, and nothing more:
> Inclusion of a transaction in an attested source-chain block was verified by the Creditcoin Block Prover precompile. Its receipt reported success, and log *n* was an ERC-20 `Transfer` of *amount* of token *T* from address *A* to address *B*.

### 2. CLEARBOOK INTERPRETATION
What this application decides on top of that evidence:
> Address *A* was bound to originator *O* by signature at block *N*. Clearbook therefore treats this transfer as the disbursement of loan *L* under the claim the originator registered, and evaluates it against covenant `CIRCULAR_REPAYMENT` with the window the originator published.

### 3. REAL-WORLD CLAIM — **NOT MADE**
What Clearbook does **not** assert, ever:
> That address *A* belongs to any person or company. That an off-chain loan agreement exists. That anyone intended anything. That any law was broken. That the book is complete or clean.

A breach of `CIRCULAR_REPAYMENT` establishes that **two verified transfers occurred in a specific relationship**, and therefore that the originator's own published rule was not met. It establishes nothing else.

---

## Trust model

```
UNTRUSTED  : worker, frontend, RPC providers, proof builder, originator,
             borrower, challenger, all user input
SEMI-TRUST : Attestcoin attestor set (quorum honesty), Creditcoin validators
TRUSTED    : Ethereum consensus (finality), Creditcoin consensus,
             the 0x0FD2 precompile implementation
```

**The worker is orchestration, not authority.** It acquires proof bundles and submits transactions. It cannot make the vault believe anything: a corrupted bundle fails verification and the transaction reverts. Delete the worker and any third party can submit the identical bundle — the on-chain result is unchanged.

**The proof builder is untrusted.** It supplies proof *material*; the precompile is what makes that material meaningful. A malicious proof builder can deny service; it cannot forge a fact.

See [`SECURITY.md`](SECURITY.md) for the full threat model, invariants, and an honest table of which claims are live-verified versus still unproven.

---

## Reproduce it

Requires Node ≥ 24, npm, and Foundry.

```bash
git clone --recurse-submodules <repo-url> && cd clearbook
npm install
cp .env.example .env          # defaults point at public CC3 testnet endpoints

npm run gate0                 # capability discovery (~70s: includes a 60s re-poll)
npm run gate0:lag             # attestation lag observation (~6 min)
npm run gate1                 # discover a real third-party ERC-20 Transfer
npm run gate2                 # prove it, verify it at 0x0FD2, decode, cross-check
npm run gate7                 # mutate a valid proof six ways; all must be rejected

cd contracts && forge build && forge test   # 92 tests
```

No API keys and no funded wallet are needed for any of the above — every endpoint is public and every call is read-only.

`make help` lists the same targets.

---

## Honest limits

The covenant is **bounded, not universal**: an originator that funds a payer from an address it never binds does not breach it. Detection is depth-1 by construction, which is precisely why the rule is framed as *a covenant the originator chose and bonded against*, rather than as fraud detection.

**Absence is unprovable.** Merkle inclusion proofs cannot show a transaction did *not* occur, so Clearbook never certifies a book as clean — it makes specific claims refutable.

Full list, including what is still unverified and what is currently blocked: [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md).

---

## Documentation

| File | Contents |
|---|---|
| [`DECISIONS.md`](DECISIONS.md) | Append-only log: every decision, its evidence class, and what would reverse it |
| [`SECURITY.md`](SECURITY.md) | Trust boundary, provenance discipline, replay design, invariants |
| [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md) | Honest limits, plus open issues found during the build |
| [`TESTING.md`](TESTING.md) | Test strategy, coverage policy, how to run each gate |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | Network config, compiler settings, deployment and verification |
| [`DEMO.md`](DEMO.md) | Demo scenarios and presenter checklist |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Component map, evidence lifecycle, state machine, trust boundary |
| [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) | T1–T26 with the test that proves each mitigation |
| [`docs/LATENCY.md`](docs/LATENCY.md) | Measured end-to-end latency, method, and what it means |

**Evidence classes** used throughout: **[P]** primary doc · **[C]** source-code verified · **[L]** live verified · **[I]** inference · **[U]** unverified · **[B]** blocked. Nothing is marked `[L]` that has not actually been executed.

## License

MIT
