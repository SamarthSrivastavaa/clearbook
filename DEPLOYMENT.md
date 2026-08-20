# DEPLOYMENT.md

> **Status: Phase 1.** Nothing is deployed. No private key has been generated in this repository. This file records the verified network facts and the exact compiler settings that a deployment must reproduce, so that Phase 5/13 is mechanical rather than improvised.

---

## Networks

### Creditcoin CC3 testnet — the deployment target

| Item | Value | Class |
|---|---|---|
| RPC | `https://rpc.cc3-testnet.creditcoin.network` | [L] |
| `eth_chainId` | **102031** | [L] |
| Proof builder | `https://prover.cc3-testnet.creditcoin.network` | [L] |
| Block Prover precompile | `0x0000000000000000000000000000000000000FD2` | [C] |
| ChainInfo precompile | `0x0000000000000000000000000000000000000fd3` | [C] |
| EVM version supported | **Cancun** (`PUSH0`, `MCOPY`, `TSTORE`, `TLOAD` all execute) | [L] |

Creditcoin chain IDs recognised by `NativeQueryVerifierLib.isCreditcoinChainId`: `102030`, `102031`, `102032` `[C]`.

> **The precompiles have no bytecode.** `cast code 0x…0FD2` returns `0x`, and that is correct — native precompiles accept calls without deployed code. The upstream library says so explicitly. Do not treat an empty `cast code` as a missing precompile.

### Source chains — read-only, nothing deployed

Resolved live from the ChainInfo precompile. **Never hardcode these** — every script calls `resolveChainKey(info, chainId)`.

| chainKey | chainId | Chain | Attesting | Class |
|---|---|---|---|---|
| 1 | 11155111 | Ethereum Sepolia | yes | [L] |
| 3 | 1 | Ethereum Mainnet | yes | [L] |

Clearbook uses **Sepolia** (DECISIONS D-006). Source-chain RPC: `https://sepolia-proxy-rpc.creditcoin.network`, taken from the SDK's own smoke tests, verified live (`chain-id` → 11155111).

Measured attestation lag on Sepolia: **36–41 blocks (~7–8 min)**, stable, granted in batches of 10 roughly every 2 minutes.

---

## Compiler settings — must match exactly for bytecode verification

From `contracts/foundry.toml`:

| Setting | Value | Why |
|---|---|---|
| `solc` | `0.8.28` | the published `INativeQueryVerifier.sol` is `pragma ^0.8.28` |
| `evm_version` | `cancun` | measured live (D-017) |
| `via_ir` | **`true`** | **required** — without it the official decoder fails "Stack too deep" (D-018) |
| `optimizer` | `true` | |
| `optimizer_runs` | `200` | |
| `bytecode_hash` | `none` | deterministic bytecode |
| `cbor_metadata` | `false` | deterministic bytecode |

**`via_ir` is not optional and not cosmetic.** It changes code generation, so:
- Explorer verification must use these exact settings or the bytecode will not match.
- Gas measurements must be taken under this setting; the published formula is a cross-check, not a substitute (BUILD.md §16 requires measured figures).

Remappings (`contracts/remappings.txt`):

```
@gluwa/usc-contracts/=../node_modules/@gluwa/usc-contracts/
forge-std/=lib/forge-std/src/
```

The `../` is required because `node_modules` lives at the repo root while the Foundry project is `contracts/` (D-020), and `allow_paths = ["../node_modules"]` lets solc read it.

---

## Clean-clone build

`forge-std` is a **git submodule pinned to v1.16.2** (D-019), so a plain `git clone` is not enough:

```bash
git clone --recurse-submodules <repo-url> && cd clearbook
npm install                      # exact pinned versions via package-lock.json
cd contracts && forge build
```

Already cloned without submodules:

```bash
git submodule update --init --recursive
```

Pinned dependencies: `@gluwa/usc-sdk@0.18.0`, `@gluwa/usc-contracts@0.2.0`, `ethers@6.17.0`, `forge-std@v1.16.2`, `solc 0.8.28`.

---

## Deployment procedure — Phase 5 / Phase 13

Not yet executable; recorded so the steps are decided in advance rather than under time pressure.

1. **Fund a throwaway CC3 deployer.** Testnet CTC only. `CC_DEPLOYER_PRIVATE_KEY` in `.env`, never committed.
2. **Confirm the target network before broadcasting** — assert `eth_chainId == 102031`. A deploy script that does not check the chain id is a mistake waiting to happen.
3. **Deploy `EvidenceVault`**, constructor verifier address = `0x…0FD2`. `Deploy.s.sol` **must assert** the production verifier is the real precompile and not a test double (BUILD.md Phase 3).
4. **Deploy `Clearbook`**, pointing at the vault, with `protocolSink` set.
5. **Record addresses** in `.env`, in this file, and in the first screenful of `README.md`.
6. **Verify on the Creditcoin explorer.** If verification is unavailable, publish source plus the exact settings above plus a `forge verify` command that reproduces the bytecode (BUILD.md §16).
7. **Run `integration/gate4-decode.ts`** and confirm the decoded fields match the source-chain explorer byte-for-byte, with a `TransactionVerified` event from `0x0FD2` present in the same Creditcoin receipt.

### Deployed addresses

| Contract | Address | Network |
|---|---|---|
| `EvidenceVault` | *not deployed* | CC3 testnet |
| `Clearbook` | *not deployed* | CC3 testnet |
| `protocolSink` | *not set* | CC3 testnet |

---

## Key handling

- `.env` is gitignored; only `.env.example` is committed, with every key field empty.
- **No private key exists in this repository as of Phase 1.**
- Use throwaway wallets holding only testnet value. Never reuse a key that has held anything real.
- BUILD.md §8.3 requires a pre-commit hook scanning for key material. Note that its literal regex `0x[0-9a-fA-F]{64}` matches every transaction hash and Merkle root too — of 29 matches in this tree, all 29 are public evidence, not secrets. The hook needs scoping or it will train people to bypass it (KNOWN_ISSUES K-009).
