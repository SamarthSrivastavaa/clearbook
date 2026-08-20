// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {INativeQueryVerifier} from "@gluwa/usc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

import {EvidenceVault} from "../../src/EvidenceVault.sol";
import {Clearbook} from "../../src/Clearbook.sol";
import {IEvidenceVault} from "../../src/interfaces/IEvidenceVault.sol";
import {MockVerifier} from "../mocks/MockVerifier.sol";

// TestBase — shared fixtures.
//
// The important part is `_buildTxBytes`, which produces bytes in the EXACT layout
// the official EvmV1Decoder expects, so tests exercise the real decoder rather than
// a stub of it. Layout verified against both sides of the protocol:
//   encoder - usc-sdk/src/encoding/abi/v1.ts
//   decoder - EvmV1Decoder.sol `_decodeReceiptChunk`
// `abi.encode(uint8 txType, bytes[] chunks)`, receipt is the last chunk:
// index 2 for types 0-2, index 3 for types 3-4.
abstract contract TestBase is Test {
    /// @dev Mirrors EvmV1Decoder.LogEntry: (address, bytes32[], bytes).
    struct RawLog {
        address addr;
        bytes32[] topics;
        bytes data;
    }

    bytes32 internal constant TRANSFER_TOPIC = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef;

    MockVerifier internal verifier;
    EvidenceVault internal vault;
    Clearbook internal clearbook;

    address internal protocolSink = makeAddr("protocolSink");
    address internal originatorOwner = makeAddr("originatorOwner");
    address internal challenger = makeAddr("challenger");
    address internal borrower = makeAddr("borrower");
    address internal payer = makeAddr("payer");
    address internal token = makeAddr("token");
    address internal otherToken = makeAddr("otherToken");

    // Treasury is an EOA whose key we control, so it can produce EIP-712 bindings.
    uint256 internal treasuryKey = 0xA11CE;
    address internal treasury = vm.addr(0xA11CE);

    uint64 internal constant CHAIN_KEY = 1;
    uint32 internal constant CIRCULAR_WINDOW = 5_000;
    uint32 internal constant CHALLENGE_WINDOW = 1_200;
    uint256 internal constant PRINCIPAL = 1_000e6;

    function setUp() public virtual {
        verifier = new MockVerifier();
        vault = new EvidenceVault(INativeQueryVerifier(address(verifier)));
        clearbook = new Clearbook(IEvidenceVault(address(vault)), protocolSink);

        vm.deal(originatorOwner, 100 ether);
        vm.deal(challenger, 10 ether);
        // Start well past block 0 so maturity/cooldown arithmetic is realistic.
        vm.roll(10_000);
    }

    // ---------------------------------------------------------------------
    // txBytes construction
    // ---------------------------------------------------------------------

    function _transferLog(address token_, address from_, address to_, uint256 amount_)
        internal
        pure
        returns (RawLog memory lg)
    {
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = TRANSFER_TOPIC;
        topics[1] = bytes32(uint256(uint160(from_)));
        topics[2] = bytes32(uint256(uint160(to_)));
        lg = RawLog({addr: token_, topics: topics, data: abi.encode(amount_)});
    }

    /// @notice An ERC-721 Transfer: same topic0, but four topics (tokenId indexed).
    function _erc721Log(address token_, address from_, address to_, uint256 tokenId)
        internal
        pure
        returns (RawLog memory lg)
    {
        bytes32[] memory topics = new bytes32[](4);
        topics[0] = TRANSFER_TOPIC;
        topics[1] = bytes32(uint256(uint160(from_)));
        topics[2] = bytes32(uint256(uint160(to_)));
        topics[3] = bytes32(tokenId);
        lg = RawLog({addr: token_, topics: topics, data: ""});
    }

    function _singleLog(RawLog memory lg) internal pure returns (RawLog[] memory out) {
        out = new RawLog[](1);
        out[0] = lg;
    }

    function _encodeReceiptChunk(uint8 status, RawLog[] memory logs) internal pure returns (bytes memory) {
        return abi.encode(status, uint64(21_000), logs, hex"00");
    }

    /// @notice Builds txBytes in the decoder's exact `(uint8, bytes[])` layout.
    function _buildTxBytes(uint8 txType, uint8 status, RawLog[] memory logs) internal pure returns (bytes memory) {
        bytes memory common = abi.encode(uint64(0), uint64(21_000), address(0), false, address(0), uint256(0), "");
        bytes memory typeSpecific =
            abi.encode(uint64(1), uint128(0), uint128(0), new bytes[](0), uint8(0), bytes32(0), bytes32(0));
        bytes memory receiptChunk = _encodeReceiptChunk(status, logs);

        // Types 0-2 carry three chunks; types 3-4 carry four.
        uint256 chunkCount = txType <= 2 ? 3 : 4;
        bytes[] memory chunks = new bytes[](chunkCount);
        chunks[0] = common;
        chunks[1] = typeSpecific;
        if (chunkCount == 3) {
            chunks[2] = receiptChunk;
        } else {
            chunks[2] = typeSpecific;
            chunks[3] = receiptChunk;
        }
        return abi.encode(txType, chunks);
    }

    function _emptyProofArgs()
        internal
        pure
        returns (bytes32 merkleRoot, INativeQueryVerifier.MerkleProofEntry[] memory siblings, bytes32[] memory roots)
    {
        merkleRoot = bytes32(0);
        siblings = new INativeQueryVerifier.MerkleProofEntry[](0);
        roots = new bytes32[](0);
    }

    // ---------------------------------------------------------------------
    // Fact submission
    // ---------------------------------------------------------------------

    function _submitFact(
        uint64 chainKey,
        uint64 blockHeight,
        uint64 txIndex,
        uint32 logIndex,
        uint8 status,
        RawLog[] memory logs
    ) internal returns (bytes32) {
        verifier.setTxIndex(txIndex);
        (bytes32 root, INativeQueryVerifier.MerkleProofEntry[] memory sibs, bytes32[] memory roots) =
            _emptyProofArgs();
        return vault.submitTransferFact(
            chainKey, blockHeight, _buildTxBytes(2, status, logs), root, sibs, bytes32(0), roots, logIndex
        );
    }

    /// @notice Submits a single successful ERC-20 Transfer as a fact.
    function _submitTransfer(
        uint64 blockHeight,
        uint64 txIndex,
        address token_,
        address from_,
        address to_,
        uint256 amount_
    ) internal returns (bytes32) {
        return
            _submitFact(CHAIN_KEY, blockHeight, txIndex, 0, 1, _singleLog(_transferLog(token_, from_, to_, amount_)));
    }

    // ---------------------------------------------------------------------
    // Clearbook fixtures
    // ---------------------------------------------------------------------

    function _registerOriginator(uint256 bond) internal returns (uint256 originatorId) {
        vm.prank(originatorOwner);
        originatorId =
            clearbook.registerOriginator{value: bond}("Acme Credit", CIRCULAR_WINDOW, CHALLENGE_WINDOW, 0x01);
    }

    function _bindingSignature(uint256 originatorId, address ethAddress, uint256 nonce, uint256 signerKey)
        internal
        view
        returns (bytes memory)
    {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("Clearbook")),
                keccak256(bytes("1")),
                block.chainid,
                address(clearbook)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("TreasuryBinding(uint256 originatorId,address ethAddress,uint256 nonce,uint256 chainId)"),
                originatorId,
                ethAddress,
                nonce,
                block.chainid
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _bindTreasury(uint256 originatorId) internal {
        bytes memory sig = _bindingSignature(originatorId, treasury, 0, treasuryKey);
        vm.prank(originatorOwner);
        clearbook.bindTreasury(originatorId, treasury, sig);
    }

    /// @notice Originator registered, bonded, treasury bound, one loan disbursed.
    function _setUpLoan() internal returns (uint256 originatorId, uint256 loanId, bytes32 disbursementFactId) {
        originatorId = _registerOriginator(10 ether);
        _bindTreasury(originatorId);

        disbursementFactId = _submitTransfer(100, 0, token, treasury, borrower, PRINCIPAL);

        vm.prank(originatorOwner);
        loanId = clearbook.registerLoan(
            originatorId, token, borrower, PRINCIPAL, uint64(block.number + 1_000), disbursementFactId
        );
    }
}
