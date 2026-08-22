# Clearbook

**Evidence-bound covenant compliance for credit originators, on Creditcoin.**

A private-credit loan book is a self-reported spreadsheet. Nobody can check whether a "repayment" was real third-party money or the fund cycling its own. Clearbook makes a published loan book **refutable**: an originator posts a bond, publishes a covenant, and registers loans whose disbursement and repayment claims must each cite a cryptographically verified source-chain `Transfer`. Anyone may then prove a covenant breach in a single permissionless transaction — and get paid for it.

**Live: [clearbook-sable.vercel.app](https://clearbook-sable.vercel.app)** — reads Creditcoin CC3 directly in the browser. No backend, no database, no server holding state; every figure on the page is a chain read.

## Attestcoin integration, in short

Clearbook's `EvidenceVault` calls the Creditcoin **Block Prover precompile at `0x…0FD2`** (`verifyAndEmit`) to prove that a specific Ethereum transaction was included in an attested block, then decodes the returned receipt with the official `EvmV1Decoder`. On top of the reference integration it adds:

- **Runtime `chainKey` discovery** via the ChainInfo precompile `0x…0FD3` — no chain key is hardcoded anywhere.
- **`receiptStatus == 1` asserted by us** — the precompile does *not* check whether the source transaction succeeded.
- **Log-level replay protection** — `keccak(chainKey, blockHeight, txIndex, logIndex)`, deliberately stricter than the reference implementation's transaction-level key, because one transaction routinely carries many relevant `Transfer` logs (we measured 17 and 30 in real transactions).
- **Ordinary third-party ERC-20 logs** — Clearbook deploys **nothing** on the source chain.

Full detail, including a candid "protocol limits we hit" section: [`docs/ATTESTCOIN_INTEGRATION.md`](docs/ATTESTCOIN_INTEGRATION.md).

---

## Deployed on Creditcoin CC3 testnet

| Contract | Address |
|---|---|
| **`EvidenceVault`** | [`0x5b6048C74165237fF4A8A3cfe1d38E6fE7b547Af`](https://creditcoin-testnet.blockscout.com/address/0x5b6048C74165237fF4A8A3cfe1d38E6fE7b547Af) |
| **`Clearbook`** | [`0xCA02D51722947d7a93EDBe398498667bab368315`](https://creditcoin-testnet.blockscout.com/address/0xCA02D51722947d7a93EDBe398498667bab368315) |

**Every gate in the build specification passes.**

| Gate | What it proves | Result |
|---|---|---|
| 0 | Chain discovery · attestation live and advancing | **PASS** |
| 1a | Real package paths compile · full verifier interface resolves | **PASS** |
| 2 | Contracts build · fmt · lint clean | **PASS** |
| 3 | 92 tests · 100% line coverage of `src/` | **PASS** |
| 2/3 | Proof obtained · precompile `verify()` returns true | **PASS** |
| **4** | **On-chain decode matches the source chain — 120/120 checks over 10 facts** | **PASS** |
| **5** | **Circular flow breaches; honest loan reverts** | **PASS** |
| **6** | **Bond slashed, bounty paid, sink credited — all exact** | **PASS** |
| **7** | **Six forged proofs rejected, on-chain** | **PASS** |
| **8a** | **Worker killed mid-flight recovers; no fact lost, no duplicate submission** | **PASS** |

### The evidence, in short

**A real breach was proven on-chain.** Loan 2 — a genuine circular flow staged on Sepolia — was challenged by a third party and slashed: bond **−1.0 tCTC**, challenger bounty **+0.5**, protocol sink **+0.5**, exposure released. Every figure read from chain before and after. Challenge transaction: [`0x3a22a0ff…`](https://creditcoin-testnet.blockscout.com/tx/0x3a22a0fffd9d78ed6547658406f641fb337fe9e4638ac9e35eaa9c9020e93d47)

**An honest loan cannot be breached.** The honest control reverts `DisbursementNotFunding` — condition 11, the check that exists precisely so a genuine loan does not look circular. A mechanism that only ever fires detects nothing. `npm run demo:seed` re-asserts this on every run against the currently open loan; older loans revert `WindowClosed` once their challenge window has passed, which is the window check firing first, not the covenant.

**Forged proofs are rejected.** Six mutations of a valid proof — a Merkle sibling, a continuity root, the lower endpoint digest, the block height, an `isLeft` flag, one byte of the transaction — all six reverted on-chain:

`0x160fb333…` · `0x55f1ca63…` · `0x52924b60…` · `0xc535729c…` · `0x8ac73141…` · `0xf0943102…`

This also settled a contradiction in the protocol documentation: the precompile **reverts** rather than returning false.

**Nothing was deployed on Ethereum.** All ten demo transfers use canonical Sepolia WETH — a contract we do not control. `cast code $TOKEN` returns bytecode; `cast code $TREASURY` returns `0x`.

**Measured, not quoted.** A fresh transaction becomes usable evidence in **~8–10 minutes**, of which 97–99% is the attestation wait; `verify()` itself returns in **0.8s**. Deployment cost **0.0018 tCTC**; each fact submission **0.000113 tCTC**.

Raw evidence: [`integration/results/`](integration/results/) · [`demo/staged/`](demo/staged/). Reasoning: [`DECISIONS.md`](DECISIONS.md).

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

Against the live deployment (read-only, no gas):

```bash
npm run recheck               # re-asserts GATE 5/6 economics and the controls
```

Running or re-running the demo (needs funded throwaway wallets):

```bash
npm run demo:stage            # broadcast fresh source-chain transfers
npm run demo:prove            # wait for attestation, fetch + verify proofs
npm run gate4                 # submit the verified facts to the vault
npm run demo:seed             # register loans, claim, leave the breach un-taken
npm run demo:run              # presenter checklist with live state

npm run demo:reset            # redeploy clean (dry run unless --confirm)
```

**Seed 2–5 hours before a demo.** The challenge window is 1,200 Creditcoin blocks (~5 h): seed too early and it closes mid-presentation, too late and attestation has no margin. See `DEMO.md`.

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
