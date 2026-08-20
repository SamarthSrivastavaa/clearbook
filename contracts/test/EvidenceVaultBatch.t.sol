// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {INativeQueryVerifier} from "@gluwa/usc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {TestBase} from "./helpers/TestBase.sol";
import {EvidenceVault} from "../src/EvidenceVault.sol";

/// @notice Batch submission path (BUILD.md §5.1). Both range guards are protocol
///         constraints imposed by the precompile, so exceeding either must fail
///         cheaply rather than waste the whole transaction's gas.
contract EvidenceVaultBatchTest is TestBase {
    function _proofs(uint256 n) internal pure returns (INativeQueryVerifier.MerkleProof[] memory proofs) {
        proofs = new INativeQueryVerifier.MerkleProof[](n);
        for (uint256 i; i < n; ++i) {
            proofs[i] = INativeQueryVerifier.MerkleProof({
                root: bytes32(0),
                siblings: new INativeQueryVerifier.MerkleProofEntry[](0)
            });
        }
    }

    function _sharedContinuity() internal pure returns (INativeQueryVerifier.ContinuityProof memory) {
        return INativeQueryVerifier.ContinuityProof({lowerEndpointDigest: bytes32(0), roots: new bytes32[](0)});
    }

    /// @dev n items, one Transfer each, heights spaced `spacing` apart.
    function _batch(uint256 n, uint64 startHeight, uint64 spacing)
        internal
        view
        returns (uint64[] memory heights, bytes[] memory txs, uint32[] memory logIndexes)
    {
        heights = new uint64[](n);
        txs = new bytes[](n);
        logIndexes = new uint32[](n);
        for (uint256 i; i < n; ++i) {
            heights[i] = startHeight + uint64(i) * spacing;
            txs[i] = _buildTxBytes(2, 1, _singleLog(_transferLog(token, treasury, borrower, (i + 1) * 1e6)));
            logIndexes[i] = 0;
        }
    }

    /// setup: a well-formed batch of three.
    /// action: submit.
    /// expected: three distinct facts, each decoded from its own receipt.
    function test_batch_stores_each_item() public {
        (uint64[] memory heights, bytes[] memory txs, uint32[] memory logIndexes) = _batch(3, 1000, 10);
        verifier.setTxIndex(1);

        bytes32[] memory ids =
            vault.submitTransferFactsBatch(CHAIN_KEY, heights, txs, _proofs(3), _sharedContinuity(), logIndexes);

        assertEq(ids.length, 3, "one id per item");
        for (uint256 i; i < 3; ++i) {
            assertTrue(vault.exists(ids[i]), "stored");
            assertEq(vault.getFact(ids[i]).amount, (i + 1) * 1e6, "decoded its own amount");
            assertEq(vault.getFact(ids[i]).blockHeight, heights[i], "its own height");
        }
    }

    /// Guard 1: the precompile's maximum batch size.
    function test_batch_too_large_rejected() public {
        uint256 n = vault.MAX_BATCH_SIZE() + 1;
        (uint64[] memory heights, bytes[] memory txs, uint32[] memory logIndexes) = _batch(n, 1000, 1);
        verifier.setTxIndex(1);

        vm.expectRevert(EvidenceVault.BatchTooLarge.selector);
        vault.submitTransferFactsBatch(CHAIN_KEY, heights, txs, _proofs(n), _sharedContinuity(), logIndexes);
    }

    /// Exactly at the limit must still be accepted.
    function test_batch_at_max_size_accepted() public {
        uint256 n = vault.MAX_BATCH_SIZE();
        (uint64[] memory heights, bytes[] memory txs, uint32[] memory logIndexes) = _batch(n, 1000, 1);
        verifier.setTxIndex(1);

        bytes32[] memory ids =
            vault.submitTransferFactsBatch(CHAIN_KEY, heights, txs, _proofs(n), _sharedContinuity(), logIndexes);
        assertEq(ids.length, n, "accepted at the boundary");
    }

    /// Guard 2: the precompile's maximum block span for a shared continuity proof.
    function test_batch_range_exceeded_rejected() public {
        uint64[] memory heights = new uint64[](2);
        heights[0] = 1000;
        heights[1] = 1000 + uint64(vault.MAX_BATCH_RANGE()) + 1;

        bytes[] memory txs = new bytes[](2);
        uint32[] memory logIndexes = new uint32[](2);
        for (uint256 i; i < 2; ++i) {
            txs[i] = _buildTxBytes(2, 1, _singleLog(_transferLog(token, treasury, borrower, 1e6)));
            logIndexes[i] = 0;
        }
        verifier.setTxIndex(1);

        vm.expectRevert(EvidenceVault.BatchRangeExceeded.selector);
        vault.submitTransferFactsBatch(CHAIN_KEY, heights, txs, _proofs(2), _sharedContinuity(), logIndexes);
    }

    /// Exactly at the span limit must still be accepted.
    function test_batch_at_max_range_accepted() public {
        uint64[] memory heights = new uint64[](2);
        heights[0] = 1000;
        heights[1] = 1000 + uint64(vault.MAX_BATCH_RANGE());

        bytes[] memory txs = new bytes[](2);
        uint32[] memory logIndexes = new uint32[](2);
        for (uint256 i; i < 2; ++i) {
            txs[i] = _buildTxBytes(2, 1, _singleLog(_transferLog(token, treasury, borrower, 1e6)));
            logIndexes[i] = 0;
        }
        verifier.setTxIndex(7);

        vault.submitTransferFactsBatch(CHAIN_KEY, heights, txs, _proofs(2), _sharedContinuity(), logIndexes);
    }

    /// The span guard must not depend on ordering.
    function test_batch_range_checked_regardless_of_order() public {
        uint64[] memory heights = new uint64[](3);
        heights[0] = 5000;
        heights[1] = 1000; // min appears after the max
        heights[2] = 5000 + uint64(vault.MAX_BATCH_RANGE());

        bytes[] memory txs = new bytes[](3);
        uint32[] memory logIndexes = new uint32[](3);
        for (uint256 i; i < 3; ++i) {
            txs[i] = _buildTxBytes(2, 1, _singleLog(_transferLog(token, treasury, borrower, 1e6)));
            logIndexes[i] = 0;
        }
        verifier.setTxIndex(1);

        vm.expectRevert(EvidenceVault.BatchRangeExceeded.selector);
        vault.submitTransferFactsBatch(CHAIN_KEY, heights, txs, _proofs(3), _sharedContinuity(), logIndexes);
    }

    function test_batch_empty_rejected() public {
        vm.expectRevert(EvidenceVault.EmptyBatch.selector);
        vault.submitTransferFactsBatch(
            CHAIN_KEY, new uint64[](0), new bytes[](0), _proofs(0), _sharedContinuity(), new uint32[](0)
        );
    }

    function test_batch_length_mismatch_rejected() public {
        (uint64[] memory heights, bytes[] memory txs,) = _batch(3, 1000, 1);
        uint32[] memory shortIndexes = new uint32[](2);
        verifier.setTxIndex(1);

        vm.expectRevert(EvidenceVault.BatchLengthMismatch.selector);
        vault.submitTransferFactsBatch(CHAIN_KEY, heights, txs, _proofs(3), _sharedContinuity(), shortIndexes);
    }

    /// T3, batch form: a rejected batch stores nothing at all.
    function test_batch_proof_rejected_stores_nothing() public {
        (uint64[] memory heights, bytes[] memory txs, uint32[] memory logIndexes) = _batch(3, 1000, 10);
        verifier.setTxIndex(1);
        verifier.setVerifyResult(false);

        vm.expectRevert(EvidenceVault.ProofRejected.selector);
        vault.submitTransferFactsBatch(CHAIN_KEY, heights, txs, _proofs(3), _sharedContinuity(), logIndexes);

        assertFalse(vault.exists(vault.computeFactId(CHAIN_KEY, heights[0], 1, 0)), "nothing stored");
    }

    /// T4, batch form: one reverted source transaction fails the whole batch.
    function test_batch_rejects_reverted_source_tx() public {
        (uint64[] memory heights, bytes[] memory txs, uint32[] memory logIndexes) = _batch(3, 1000, 10);
        // Middle item's receipt reports failure.
        txs[1] = _buildTxBytes(2, 0, _singleLog(_transferLog(token, treasury, borrower, 1e6)));
        verifier.setTxIndex(1);

        vm.expectRevert(EvidenceVault.SourceTxReverted.selector);
        vault.submitTransferFactsBatch(CHAIN_KEY, heights, txs, _proofs(3), _sharedContinuity(), logIndexes);
    }

    /// T1, batch form: re-submitting a known item is a no-op, not a revert.
    function test_batch_is_idempotent_per_item() public {
        (uint64[] memory heights, bytes[] memory txs, uint32[] memory logIndexes) = _batch(2, 2000, 10);
        verifier.setTxIndex(4);

        bytes32[] memory first =
            vault.submitTransferFactsBatch(CHAIN_KEY, heights, txs, _proofs(2), _sharedContinuity(), logIndexes);
        bytes32[] memory second =
            vault.submitTransferFactsBatch(CHAIN_KEY, heights, txs, _proofs(2), _sharedContinuity(), logIndexes);

        assertEq(second[0], first[0], "same ids returned");
        assertEq(second[1], first[1], "same ids returned");
        assertTrue(vault.exists(first[0]) && vault.exists(first[1]), "still stored exactly once");
    }

    /// The batch path must agree with the single path on identity.
    function test_batch_and_single_agree_on_factId() public {
        (uint64[] memory heights, bytes[] memory txs, uint32[] memory logIndexes) = _batch(1, 3000, 1);
        verifier.setTxIndex(2);

        bytes32[] memory batchIds =
            vault.submitTransferFactsBatch(CHAIN_KEY, heights, txs, _proofs(1), _sharedContinuity(), logIndexes);

        bytes32 expected = vault.computeFactId(CHAIN_KEY, 3000, 2, 0);
        assertEq(batchIds[0], expected, "identity is path-independent");
    }

    /// The limits must match what the precompile actually enforces.
    function test_batch_limits_match_protocol_constants() public view {
        assertEq(vault.MAX_BATCH_SIZE(), 10, "MAX_BATCH_SIZE");
        assertEq(vault.MAX_BATCH_RANGE(), 1000, "MAX_BATCH_RANGE");
    }
}
