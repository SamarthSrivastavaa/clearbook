// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {INativeQueryVerifier} from "@gluwa/usc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {EvmV1Decoder} from "@gluwa/usc-contracts/contracts/write-ability/common/EvmV1Decoder.sol";
import {IEvidenceVault} from "./interfaces/IEvidenceVault.sol";

/// @title EvidenceVault
/// @notice Turns an Attestcoin proof bundle into an immutable, deduplicated,
///         application-agnostic fact. Permissionless: anyone may submit.
/// @dev Deliberately knows nothing about loans, originators or bonds, so that any
///      Creditcoin dApp can consume it. The only external call it ever makes is to
///      the Block Prover precompile, which is native and makes no callbacks — so
///      there is no reentrancy surface here.
contract EvidenceVault is IEvidenceVault {
    /// @notice keccak256("Transfer(address,address,uint256)").
    bytes32 public constant ERC20_TRANSFER_TOPIC = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef;

    /// @notice The Block Prover precompile. Injectable ONLY so tests can supply a
    ///         mock; `Deploy.s.sol` asserts production uses 0x…0FD2.
    INativeQueryVerifier public immutable VERIFIER;

    mapping(bytes32 => TransferFact) private _facts;
    mapping(bytes32 => bool) public exists;

    error ProofRejected();
    error SourceTxReverted();
    error LogIndexOutOfRange();
    error NotATransferLog();
    error MalformedTransferLog();
    error UnsupportedTxType();
    error UnknownFact();

    constructor(INativeQueryVerifier verifier) {
        VERIFIER = verifier;
    }

    /// @inheritdoc IEvidenceVault
    /// @dev Step order is security-critical and must not be rearranged:
    ///      dedupe first (makes replay nearly free), then VERIFY, and only then
    ///      decode. Never decode unverified bytes into anything consequential.
    function submitTransferFact(
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
        bytes32 lowerEndpointDigest,
        bytes32[] calldata continuityRoots,
        uint32 logIndex
    ) external returns (bytes32 factId) {
        // 1. Rebuild the proof structs the precompile expects.
        INativeQueryVerifier.MerkleProof memory merkleProof =
            INativeQueryVerifier.MerkleProof({root: merkleRoot, siblings: siblings});
        INativeQueryVerifier.ContinuityProof memory continuityProof =
            INativeQueryVerifier.ContinuityProof({lowerEndpointDigest: lowerEndpointDigest, roots: continuityRoots});

        // 2. txIndex comes from the precompile, never from the caller.
        uint64 txIndex = VERIFIER.calculateTxIndex(merkleProof);

        // 3. Identity is (chainKey, blockHeight, txIndex, logIndex). Log-level, not
        //    transaction-level: one transaction routinely carries several relevant
        //    Transfer logs, and a transaction-level key would let the first one
        //    ingested permanently lock out the rest.
        factId = computeFactId(chainKey, blockHeight, txIndex, logIndex);
        // Idempotent no-op. This is what makes the worker restart-safe.
        if (exists[factId]) {
            return factId;
        }

        // 4. Verify BEFORE decoding anything.
        bool ok = VERIFIER.verifyAndEmit(chainKey, blockHeight, encodedTransaction, merkleProof, continuityProof);
        if (!ok) revert ProofRejected();

        // 5. Only transaction types 0-4 are decodable.
        uint8 txType = EvmV1Decoder.getTransactionType(encodedTransaction);
        if (!EvmV1Decoder.isValidTransactionType(txType)) revert UnsupportedTxType();

        // 6. The precompile does NOT check whether the source transaction succeeded.
        //    Asserting this is our job, and skipping it would let a reverted
        //    transfer be cited as if value had moved.
        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTransaction);
        if (receipt.receiptStatus != 1) revert SourceTxReverted();

        // 7. Bounds-check before indexing.
        if (logIndex >= receipt.receiptLogs.length) revert LogIndexOutOfRange();

        // 8-10. Shape guards. `topics.length != 3` is what rejects an ERC-721
        //       Transfer, which shares topic0 but carries a fourth topic that
        //       would otherwise be misread as an amount.
        EvmV1Decoder.LogEntry memory lg = receipt.receiptLogs[logIndex];
        if (lg.topics.length != 3 || lg.topics[0] != ERC20_TRANSFER_TOPIC) revert NotATransferLog();
        if (lg.data.length != 32) revert MalformedTransferLog();

        // 11. Every stored value is decoded from the verified receipt.
        address token = lg.address_;
        address from = address(uint160(uint256(lg.topics[1])));
        address to = address(uint160(uint256(lg.topics[2])));
        uint256 amount = abi.decode(lg.data, (uint256));

        // 12. Store, mark, emit.
        _facts[factId] = TransferFact({
            chainKey: chainKey,
            blockHeight: blockHeight,
            txIndex: txIndex,
            logIndex: logIndex,
            token: token,
            from: from,
            to: to,
            amount: amount,
            submitter: msg.sender,
            ccBlock: uint64(block.number)
        });
        exists[factId] = true;

        emit TransferFactStored(factId, chainKey, blockHeight, txIndex, logIndex, token, from, to, amount, msg.sender);
    }

    /// @inheritdoc IEvidenceVault
    function getFact(bytes32 factId) external view returns (TransferFact memory) {
        if (!exists[factId]) revert UnknownFact();
        return _facts[factId];
    }

    /// @inheritdoc IEvidenceVault
    function computeFactId(uint64 chainKey, uint64 blockHeight, uint64 txIndex, uint32 logIndex)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(chainKey, blockHeight, txIndex, logIndex));
    }

    /// @inheritdoc IEvidenceVault
    function calculateTxIndex(INativeQueryVerifier.MerkleProof calldata proof) external view returns (uint64) {
        return VERIFIER.calculateTxIndex(proof);
    }
}
