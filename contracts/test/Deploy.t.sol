// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DeployLib} from "../script/Deploy.s.sol";

/// @notice BUILD.md Phase 3 requires that Deploy.s.sol assert production uses the
///         real 0x…0FD2 precompile. That assertion is itself security-critical, so
///         it is tested here rather than trusted to run correctly during a live
///         broadcast nobody can rehearse.
contract DeployTest is Test {
    address internal constant REAL_PRECOMPILE = 0x0000000000000000000000000000000000000FD2;
    address internal sink = makeAddr("protocolSink");
    GuardHarness internal guard;

    function setUp() public {
        // The guard is an `internal` library function, so it inlines into its
        // caller. vm.expectRevert needs the revert to happen one call deeper, so
        // the harness gives it an external boundary.
        guard = new GuardHarness();
    }

    function test_accepts_real_precompile_on_creditcoin_networks() public view {
        guard.check(102030, REAL_PRECOMPILE, sink);
        guard.check(102031, REAL_PRECOMPILE, sink);
        guard.check(102032, REAL_PRECOMPILE, sink);
    }

    /// The whole point: a mock verifier must never reach production.
    function test_rejects_a_test_double() public {
        address mock = makeAddr("MockVerifier");
        vm.expectRevert(abi.encodeWithSelector(DeployLib.NotTheRealPrecompile.selector, mock));
        guard.check(102031, mock, sink);
    }

    function test_rejects_wrong_network() public {
        // Ethereum mainnet, Sepolia, and an arbitrary chain are all refused.
        vm.expectRevert(abi.encodeWithSelector(DeployLib.WrongNetwork.selector, uint256(1)));
        guard.check(1, REAL_PRECOMPILE, sink);

        vm.expectRevert(abi.encodeWithSelector(DeployLib.WrongNetwork.selector, uint256(11155111)));
        guard.check(11155111, REAL_PRECOMPILE, sink);

        vm.expectRevert(abi.encodeWithSelector(DeployLib.WrongNetwork.selector, uint256(31337)));
        guard.check(31337, REAL_PRECOMPILE, sink);
    }

    function test_rejects_unset_protocol_sink() public {
        vm.expectRevert(DeployLib.ProtocolSinkUnset.selector);
        guard.check(102031, REAL_PRECOMPILE, address(0));
    }

    function test_creditcoin_chain_id_set_matches_upstream_library() public pure {
        assertTrue(DeployLib.isCreditcoinChainId(102030), "mainnet");
        assertTrue(DeployLib.isCreditcoinChainId(102031), "testnet");
        assertTrue(DeployLib.isCreditcoinChainId(102032), "devnet");
        assertFalse(DeployLib.isCreditcoinChainId(1), "not ethereum");
        assertFalse(DeployLib.isCreditcoinChainId(102033), "not an adjacent id");
    }

    function test_precompile_constant_is_correct() public pure {
        assertEq(DeployLib.BLOCK_PROVER_PRECOMPILE, REAL_PRECOMPILE, "0x0FD2");
    }
}

/// @notice External boundary so the inlined library guard can be revert-tested.
contract GuardHarness {
    function check(uint256 chainId, address verifier, address protocolSink) external pure {
        DeployLib.assertProductionConfig(chainId, verifier, protocolSink);
    }
}
