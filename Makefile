# Clearbook — task runner.
#
# NOTE: `make` is not installed on every dev machine (notably plain Windows).
# Every target below is a thin wrapper over an npm script or a forge command,
# so the npm/forge form shown in each recipe always works without make.

.PHONY: help install gate0 gate0-lag gate1 gate2 gates build fmt fmt-check test coverage clean

help:
	@echo "Clearbook targets"
	@echo ""
	@echo "  install      install npm deps and init the forge-std submodule"
	@echo "  gate0        Gate 0: capability discovery        (~70s)"
	@echo "  gate0-lag    attestation lag observation         (~6 min)"
	@echo "  gate1        discover a real third-party ERC-20 Transfer"
	@echo "  gate2        Gates 2+3: prove, verify, decode, cross-check"
	@echo "  gates        run gate0 -> gate1 -> gate2 in order"
	@echo "  build        Gate 1a: forge build"
	@echo "  fmt          format Solidity"
	@echo "  fmt-check    check Solidity formatting           (Gate 2)"
	@echo "  lint         solhint src (strict) and test (relaxed)"
	@echo "  test         forge test                          (Gate 3)"
	@echo "  coverage     forge coverage, >=90% of src/ lines (Gate 3)"
	@echo "  check        build + fmt-check + lint + test + coverage"
	@echo "  clean        remove forge build output"
	@echo ""
	@echo "No target above needs a funded wallet or an API key."

install:
	npm install
	git submodule update --init --recursive

# ---- live protocol gates (read-only, no wallet required) ----

gate0:
	npm run gate0

gate0-lag:
	npm run gate0:lag

gate1:
	npm run gate1

gate2:
	npm run gate2

gates: gate0 gate1 gate2

# ---- contracts ----

build:
	cd contracts && forge build

fmt:
	cd contracts && forge fmt

fmt-check:
	cd contracts && forge fmt --check

# src/ is linted strictly; test/ uses a relaxed config (test_snake_case names,
# `catch {}` in the fuzz handler, revert strings in mocks).
lint:
	npx solhint "contracts/src/**/*.sol" --config contracts/.solhint.json
	npx solhint "contracts/test/**/*.sol" --config contracts/test/.solhint.json

# Everything Gate 2 and Gate 3 require, in one command.
check: build fmt-check lint test coverage

test:
	cd contracts && forge test -vvv

# --ir-minimum is REQUIRED: coverage disables via_ir, which reintroduces the
# "stack too deep" error the official decoder triggers (DECISIONS D-018/D-028).
coverage:
	cd contracts && forge coverage --ir-minimum --report summary

clean:
	cd contracts && forge clean
