# Clearbook

**Evidence-bound covenant compliance for credit originators, on Creditcoin.**

A private-credit loan book is a self-reported spreadsheet. Nobody can check whether a "repayment" was real third-party money or the fund cycling its own. Clearbook makes a published loan book **refutable**: an originator posts a bond, publishes a covenant, and registers loans whose disbursement and repayment claims must each cite a cryptographically verified source-chain `Transfer`. Anyone may then prove a covenant breach in a single permissionless transaction — and get paid for it.

## Attestcoin integration, in short

Clearbook's `EvidenceVault` calls the Creditcoin **Block Prover precompile at `0x…0FD2`** (`verifyAndEmit`) to prove that a specific Ethereum transaction was included in an attested block, then decodes the returned receipt with the official `EvmV1Decoder`. On top of the reference integration it adds:

- **Runtime `chainKey` discovery** via the ChainInfo precompile `0x…0FD3` — no chain key is hardcoded anywhere.
- **`receiptStatus == 1` asserted by us** — the precompile does *not* check whether the source transaction succeeded.
- **Log-level replay protection** — `keccak(chainKey, blockHeight, txIndex, logIndex)`, deliberately stricter than the reference implementation's transaction-level key, because one transaction routinely carries many relevant `Transfer` logs (we measured 17 and 30 in real transactions).
- **Ordinary third-party ERC-20 logs** — Clearbook deploys **nothing** on the source chain.

Full detail will live in `docs/ATTESTCOIN_INTEGRATION.md` *(not yet written — Phase 13)*.

---

## Build status

> **This project is mid-build.** Phases 0 and 1 are complete and verified against live CC3 testnet. Contracts are not yet written or deployed. Everything below is marked with what has actually been demonstrated.

| Phase | Gate | Status |
|---|---|---|
| 0 — Protocol verification | Gate 0 (capability discovery) | **PASS** |
| 0 — Protocol verification | Gate 2 (proof) · Gate 3 (verify) | **PASS** |
| 1 — Repository bootstrap | Gate 1a (real package paths compile) | **PASS** |
| 2 — Contracts | Gate 2 (build/fmt/lint clean) | not started |
| 3 — Unit tests | Gate 3 (tests + ≥90% coverage) | not started |
| 5 — Evidence pipeline | Gate 4 (on-chain decode matches explorer) | not started |
| 6/7 — Challenge · economics | Gate 5 · Gate 6 | not started |
| 11 — Security hardening | Gate 7 (six forged proofs rejected) | not started |

**Deployed addresses:** none yet. `EVIDENCE_VAULT_ADDRESS` and `CLEARBOOK_ADDRESS` will appear here, in this screenful, once Phase 5/6 deploys them.

### What Phase 0 actually demonstrated

Against live CC3 testnet (`chainId 102031`), two **arbitrary third-party** Sepolia transactions — tokens and contracts we do not control, transactions we did not send — were proven and verified end to end:

| | Transaction A | Transaction B |
|---|---|---|
| txHash | `0xc5e1086751fed6419e37c0e223e911cd4c31ace0e20713ad91ac1e5fa44d84f1` | `0xad4d54d5cc86475462ec59d340ec5e91dcc354d834fca986ea7c2b0922c2657d` |
| block / txIndex | 11529467 / 4 | 11529477 / 1 |
| logs in receipt | 17 | 30 |
| `verify()` at `0x0FD2` | **true** | **true** |
| fields matched vs source-chain RPC | **11/11** | **11/11** |

This matters because it retires the project's single biggest technical risk: the proof service serves **ordinary transactions**, not only ones from registered contracts. That is what lets Clearbook deploy nothing on Ethereum.

Raw evidence: [`integration/results/`](integration/results/). Reasoning and evidence classes: [`DECISIONS.md`](DECISIONS.md).

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

cd contracts && forge build   # Gate 1a
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

**Evidence classes** used throughout: **[P]** primary doc · **[C]** source-code verified · **[L]** live verified · **[I]** inference · **[U]** unverified · **[B]** blocked. Nothing is marked `[L]` that has not actually been executed.

## License

MIT
