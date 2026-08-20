// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {INativeQueryVerifier} from "@gluwa/usc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

/// @title IEvidenceVault
/// @notice Read surface of the evidence registry, consumed by Clearbook and any
///         other Creditcoin dApp. The vault is application-agnostic: it knows
///         nothing about loans, originators or bonds.
interface IEvidenceVault {
    /// @notice An immutable, cryptographically verified ERC-20 `Transfer`.
    /// @dev Field provenance is a security invariant (BUILD.md §3.1). `token`,
    ///      `from`, `to` and `amount` are decoded from the verified receipt and
    ///      can never be influenced by the caller. `txIndex` comes from the
    ///      precompile, not from user input. `chainKey` and `blockHeight` are
    ///      caller-supplied but bound by the proof: a wrong value fails
    ///      verification. Nothing here is trusted user data.
    struct TransferFact {
        uint64 chainKey;
        uint64 blockHeight;
        uint64 txIndex;
        uint32 logIndex;
        address token;
        address from;
        address to;
        uint256 amount;
        address submitter;
        uint64 ccBlock;
    }

    event TransferFactStored(
        bytes32 indexed factId,
        uint64 indexed chainKey,
        uint64 blockHeight,
        uint64 txIndex,
        uint32 logIndex,
        address indexed token,
        address from,
        address to,
        uint256 amount,
        address submitter
    );

    /// @notice Verifies an Attestcoin proof and stores the ERC-20 Transfer it contains.
    /// @dev Idempotent: re-submitting a known fact returns the existing id without
    ///      re-verifying and without emitting. Permissionless by design.
    function submitTransferFact(
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
        bytes32 lowerEndpointDigest,
        bytes32[] calldata continuityRoots,
        uint32 logIndex
    ) external returns (bytes32 factId);

    /// @notice Batch path sharing one continuity proof across all items.
    /// @dev Guarded by the precompile's own limits: at most MAX_BATCH_SIZE items,
    ///      spanning at most MAX_BATCH_RANGE blocks. Idempotent per item.
    function submitTransferFactsBatch(
        uint64 chainKey,
        uint64[] calldata heights,
        bytes[] calldata encodedTransactions,
        INativeQueryVerifier.MerkleProof[] calldata merkleProofs,
        INativeQueryVerifier.ContinuityProof calldata sharedContinuityProof,
        uint32[] calldata logIndexes
    ) external returns (bytes32[] memory factIds);

    /// @notice Returns a stored fact. Reverts `UnknownFact` if it was never ingested.
    function getFact(bytes32 factId) external view returns (TransferFact memory);

    /// @notice True once a fact has been ingested.
    function exists(bytes32 factId) external view returns (bool);

    function computeFactId(uint64 chainKey, uint64 blockHeight, uint64 txIndex, uint32 logIndex)
        external
        pure
        returns (bytes32);

    /// @notice Passthrough to the precompile, so the worker can derive `txIndex`
    ///         without depending on the precompile ABI directly.
    function calculateTxIndex(INativeQueryVerifier.MerkleProof calldata proof) external view returns (uint64);
}
