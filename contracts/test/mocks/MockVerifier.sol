// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {INativeQueryVerifier} from "@gluwa/usc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

/// @title MockVerifier
/// @notice Test double for the Block Prover precompile at 0x…0FD2.
/// @dev TESTS ONLY. `Deploy.s.sol` asserts production wires the real precompile.
///      The mock lets tests drive the two things the vault depends on — whether
///      verification succeeds, and what txIndex the proof resolves to — without
///      needing real Merkle proofs. It can also revert instead of returning false,
///      because the real precompile's failure mode is still unverified (K-007) and
///      EvidenceVault must fail closed under BOTH behaviours.
contract MockVerifier is INativeQueryVerifier {
    bool public verifyResult = true;
    uint64 public txIndexResult;
    bool public shouldRevert;

    uint256 public verifyAndEmitCalls;

    function setVerifyResult(bool value) external {
        verifyResult = value;
    }

    function setTxIndex(uint64 value) external {
        txIndexResult = value;
    }

    /// @notice Makes verification revert rather than return false.
    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function verifyAndEmit(
        uint64 chainKey,
        uint64 height,
        bytes calldata,
        MerkleProof calldata,
        ContinuityProof calldata
    ) external returns (bool) {
        if (shouldRevert) revert("MockVerifier: verification failed");
        verifyAndEmitCalls++;
        if (verifyResult) {
            emit TransactionVerified(chainKey, height, txIndexResult);
        }
        return verifyResult;
    }

    function verifyAndEmit(
        uint64 chainKey,
        uint64[] calldata heights,
        bytes[] calldata,
        MerkleProof[] calldata,
        ContinuityProof calldata
    ) external returns (bool) {
        if (shouldRevert) revert("MockVerifier: verification failed");
        verifyAndEmitCalls++;
        if (verifyResult) {
            for (uint256 i; i < heights.length; ++i) {
                emit TransactionVerified(chainKey, heights[i], txIndexResult);
            }
        }
        return verifyResult;
    }

    function verify(uint64, uint64, bytes calldata, MerkleProof calldata, ContinuityProof calldata)
        external
        view
        returns (bool)
    {
        if (shouldRevert) revert("MockVerifier: verification failed");
        return verifyResult;
    }

    function verify(uint64, uint64[] calldata, bytes[] calldata, MerkleProof[] calldata, ContinuityProof calldata)
        external
        view
        returns (bool)
    {
        if (shouldRevert) revert("MockVerifier: verification failed");
        return verifyResult;
    }

    function calculateTxIndex(MerkleProof calldata) external view returns (uint64) {
        return txIndexResult;
    }
}
