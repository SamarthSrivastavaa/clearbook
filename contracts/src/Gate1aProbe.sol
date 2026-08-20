// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// The real published paths. BUILD.md §1.3 predicted, and DECISIONS D-007 confirmed,
// that the documented `contracts/decoding/EvmV1Decoder.sol` does not exist in
// @gluwa/usc-contracts@0.2.0.
//
// The `common/` prefix on the verifier is load-bearing: DECISIONS D-008 found a
// SECOND, materially different INativeQueryVerifier.sol at
// `contracts/write-ability/INativeQueryVerifier.sol` which compiles fine but is
// missing verifyAndEmit, the batch overloads and calculateTxIndex.
import {
    INativeQueryVerifier,
    NativeQueryVerifierLib
} from "@gluwa/usc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {EvmV1Decoder} from "@gluwa/usc-contracts/contracts/write-ability/common/EvmV1Decoder.sol";

/// @title Gate1aProbe
/// @notice THROWAWAY. Exists only to prove that the real package paths resolve and
///         that every protocol API BUILD.md depends on is actually present and has
///         the signature BUILD.md claims. Deleted in Phase 2. Never deployed.
/// @dev This is a compile-time interface contract test. If any function or struct
///      below disappears or changes shape upstream, `forge build` fails loudly here
///      rather than silently in EvidenceVault later.
contract Gate1aProbe {
    /// BUILD.md §1.2 [C]: precompile address.
    address internal constant EXPECTED_PRECOMPILE = 0x0000000000000000000000000000000000000FD2;

    /// BUILD.md §5.1 / §1.2: ERC-20 Transfer topic0. Re-derived with `cast keccak` (D-011).
    bytes32 internal constant ERC20_TRANSFER_TOPIC = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef;

    /// @notice Asserts the library constant matches the address BUILD.md pins.
    function checkPrecompileAddress() external pure returns (bool) {
        return NativeQueryVerifierLib.PRECOMPILE == EXPECTED_PRECOMPILE;
    }

    /// @notice Proves the FULL verifier interface resolved, not the lean vendored copy.
    ///         Referencing each selector fails to compile if the wrong file was imported.
    function checkVerifierInterface() external pure returns (bytes4[5] memory selectors) {
        selectors[0] = INativeQueryVerifier.calculateTxIndex.selector;
        // Overloaded: disambiguate single vs batch by explicit function-type cast.
        selectors[1] =
            bytes4(keccak256("verifyAndEmit(uint64,uint64,bytes,(bytes32,(bytes32,bool)[]),(bytes32,bytes32[]))"));
        selectors[2] =
            bytes4(keccak256("verifyAndEmit(uint64,uint64[],bytes[],(bytes32,(bytes32,bool)[])[],(bytes32,bytes32[]))"));
        selectors[3] = bytes4(keccak256("verify(uint64,uint64,bytes,(bytes32,(bytes32,bool)[]),(bytes32,bytes32[]))"));
        selectors[4] =
            bytes4(keccak256("verify(uint64,uint64[],bytes[],(bytes32,(bytes32,bool)[])[],(bytes32,bytes32[]))"));
    }

    /// @notice Proves the proof-bundle struct shapes are what EvidenceVault will build.
    function checkProofStructs()
        external
        pure
        returns (INativeQueryVerifier.MerkleProof memory m, INativeQueryVerifier.ContinuityProof memory c)
    {
        INativeQueryVerifier.MerkleProofEntry[] memory siblings = new INativeQueryVerifier.MerkleProofEntry[](1);
        siblings[0] = INativeQueryVerifier.MerkleProofEntry({hash: bytes32(0), isLeft: true});
        m = INativeQueryVerifier.MerkleProof({root: bytes32(0), siblings: siblings});
        c = INativeQueryVerifier.ContinuityProof({lowerEndpointDigest: bytes32(0), roots: new bytes32[](0)});
    }

    /// @notice Exercises every decoder entry point BUILD.md §5.1 uses, in the same order.
    function checkDecoderApi(bytes memory encodedTransaction)
        external
        pure
        returns (uint8 txType, bool validType, uint8 receiptStatus, uint256 logCount, uint256 transferLogCount)
    {
        txType = EvmV1Decoder.getTransactionType(encodedTransaction);
        validType = EvmV1Decoder.isValidTransactionType(txType);

        EvmV1Decoder.ReceiptFields memory r = EvmV1Decoder.decodeReceiptFields(encodedTransaction);
        receiptStatus = r.receiptStatus;
        logCount = r.receiptLogs.length;

        // The optional fallback path named in BUILD.md §14 (gate 4 failure row).
        EvmV1Decoder.LogEntry[] memory transfers = EvmV1Decoder.getLogsByEventSignature(r, ERC20_TRANSFER_TOPIC);
        transferLogCount = transfers.length;
    }

    /// @notice Proves CommonTxFields decoding resolves (BUILD.md §1.2 decoder API list).
    function checkCommonTxFields(bytes memory encodedTransaction) external pure returns (address from, address to) {
        EvmV1Decoder.CommonTxFields memory common = EvmV1Decoder.decodeCommonTxFields(encodedTransaction);
        return (common.from, common.to);
    }

    /// @notice Mirrors the exact log-shape guards from BUILD.md §5.1 steps 9-11,
    ///         including the ERC-721 rejection that T7 depends on.
    function checkTransferExtraction(bytes memory encodedTransaction, uint32 logIndex)
        external
        pure
        returns (address token, address from, address to, uint256 amount)
    {
        EvmV1Decoder.ReceiptFields memory r = EvmV1Decoder.decodeReceiptFields(encodedTransaction);
        require(r.receiptStatus == 1, "SourceTxReverted");
        require(logIndex < r.receiptLogs.length, "LogIndexOutOfRange");

        EvmV1Decoder.LogEntry memory lg = r.receiptLogs[logIndex];
        // topics.length != 3 rejects ERC-721 Transfer (4 topics), whose 4th topic
        // would otherwise be misread as an amount.
        require(lg.topics.length == 3 && lg.topics[0] == ERC20_TRANSFER_TOPIC, "NotATransferLog");
        require(lg.data.length == 32, "MalformedTransferLog");

        token = lg.address_;
        from = address(uint160(uint256(lg.topics[1])));
        to = address(uint160(uint256(lg.topics[2])));
        amount = abi.decode(lg.data, (uint256));
    }
}
