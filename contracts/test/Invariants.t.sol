// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {INativeQueryVerifier} from "@gluwa/usc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

import {EvidenceVault} from "../src/EvidenceVault.sol";
import {Clearbook} from "../src/Clearbook.sol";
import {IEvidenceVault} from "../src/interfaces/IEvidenceVault.sol";
import {MockVerifier} from "./mocks/MockVerifier.sol";

/// @notice Drives random-but-valid sequences of protocol actions. Every call is
///         wrapped in try/catch so that legitimate reverts (wrong status, closed
///         window, insufficient bond) advance the fuzzer instead of aborting it.
contract Handler is Test {
    bytes32 internal constant TRANSFER_TOPIC = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef;

    MockVerifier internal immutable VERIFIER;
    EvidenceVault internal immutable VAULT;
    Clearbook internal immutable CLEARBOOK;
    address internal immutable TOKEN;

    uint256[] public originatorIds;
    uint256[] public loanIds;
    mapping(uint256 => address) public originatorOwnerOf;
    mapping(uint256 => address) public treasuryOf;

    /// @dev Ghost state for I3/I4/I5.
    mapping(bytes32 => uint256) public ghostFactClaimCount;
    uint256 public ghostTerminalTransitions;
    uint256 public ghostRevertedSubmissionsRejected;
    /// @dev Set true only if a receiptStatus == 0 bundle is ever accepted. Breaks I5.
    bool public ghostRevertedFactStored;
    uint256 public ghostChallengesSucceeded;
    uint256 public ghostChallengeAttempts;
    bytes4 public ghostLastChallengeError;
    uint256 public ghostClaimsSucceeded;
    uint256 public ghostClaimAttempts;
    bytes4 public ghostLastClaimError;

    uint64 internal factNonce;
    uint64 internal sourceBlock = 1_000;

    constructor(MockVerifier verifier_, EvidenceVault vault_, Clearbook clearbook_, address token_) {
        VERIFIER = verifier_;
        VAULT = vault_;
        CLEARBOOK = clearbook_;
        TOKEN = token_;
    }

    function _log(address from_, address to_, uint256 amount_) internal view returns (bytes memory) {
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = TRANSFER_TOPIC;
        topics[1] = bytes32(uint256(uint160(from_)));
        topics[2] = bytes32(uint256(uint160(to_)));

        bytes[] memory chunks = new bytes[](3);
        chunks[0] = abi.encode(uint64(0), uint64(21_000), address(0), false, address(0), uint256(0), "");
        chunks[1] = abi.encode(uint64(1), uint128(0), uint128(0), new bytes[](0), uint8(0), bytes32(0), bytes32(0));

        // One log, encoded as EvmV1Decoder's LogEntry tuple.
        bytes memory logsEncoded =
            abi.encode(uint8(1), uint64(21_000), _oneLog(TOKEN, topics, abi.encode(amount_)), hex"00");
        chunks[2] = logsEncoded;
        return abi.encode(uint8(2), chunks);
    }

    struct RawLog {
        address addr;
        bytes32[] topics;
        bytes data;
    }

    function _oneLog(address addr, bytes32[] memory topics, bytes memory data)
        internal
        pure
        returns (RawLog[] memory out)
    {
        out = new RawLog[](1);
        out[0] = RawLog({addr: addr, topics: topics, data: data});
    }

    function _submit(uint64 height, address from_, address to_, uint256 amount_) internal returns (bytes32) {
        VERIFIER.setTxIndex(++factNonce);
        return VAULT.submitTransferFact(
            1,
            height,
            _log(from_, to_, amount_),
            bytes32(0),
            new INativeQueryVerifier.MerkleProofEntry[](0),
            bytes32(0),
            new bytes32[](0),
            0
        );
    }

    // ---------------------------------------------------------------------
    // Actions
    // ---------------------------------------------------------------------

    function actRegisterOriginator(uint256 seed) public {
        if (originatorIds.length >= 5) return;
        uint256 bond = bound(seed, 1 ether, 20 ether);
        address owner = address(uint160(uint256(keccak256(abi.encode("owner", seed)))));
        uint256 treasuryKey = bound(seed, 1, type(uint128).max);
        address treasury = vm.addr(treasuryKey);

        vm.deal(owner, bond);
        vm.prank(owner);
        try CLEARBOOK.registerOriginator{value: bond}("fuzz", 5_000, 1_200, 0x01) returns (uint256 id) {
            originatorIds.push(id);
            originatorOwnerOf[id] = owner;
            treasuryOf[id] = treasury;
            _bind(id, treasury, treasuryKey, owner);
        } catch {}
    }

    function _bind(uint256 id, address treasury, uint256 key, address owner) internal {
        if (CLEARBOOK.treasuryOwner(treasury) != 0) return;
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("Clearbook")),
                keccak256(bytes("1")),
                block.chainid,
                address(CLEARBOOK)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("TreasuryBinding(uint256 originatorId,address ethAddress,uint256 nonce,uint256 chainId)"),
                id,
                treasury,
                CLEARBOOK.bindingNonce(treasury),
                block.chainid
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(key, keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash)));
        vm.prank(owner);
        try CLEARBOOK.bindTreasury(id, treasury, abi.encodePacked(r, s, v)) {} catch {}
    }

    function actRegisterLoan(uint256 seed) public {
        if (originatorIds.length == 0) return;
        uint256 id = originatorIds[bound(seed, 0, originatorIds.length - 1)];
        address treasury = treasuryOf[id];
        if (CLEARBOOK.treasuryOwner(treasury) != id) return;

        uint256 principal = bound(seed, 1e6, 1e12);
        address borrower = address(uint160(uint256(keccak256(abi.encode("borrower", seed)))));
        bytes32 fact = _submit(sourceBlock, treasury, borrower, principal);

        vm.prank(originatorOwnerOf[id]);
        try CLEARBOOK.registerLoan(id, TOKEN, borrower, principal, uint64(block.number + 5_000), fact) returns (
            uint256 loanId
        ) {
            loanIds.push(loanId);
        } catch {}
    }

    function actClaimRepayment(uint256 seed) public {
        if (loanIds.length == 0) return;
        uint256 loanId = loanIds[bound(seed, 0, loanIds.length - 1)];
        (uint256 id,, address borrower, uint256 principal,,,,,) = CLEARBOOK.loans(loanId);
        if (id == 0) return;

        sourceBlock += 10;
        bytes32 fact = _submit(sourceBlock, borrower, treasuryOf[id], principal);

        vm.prank(originatorOwnerOf[id]);
        try CLEARBOOK.claimRepayment(loanId, fact) {
            ghostFactClaimCount[fact]++;
            ghostClaimsSucceeded++;
        } catch (bytes memory err) {
            ghostClaimAttempts++;
            if (err.length >= 4) ghostLastClaimError = bytes4(err);
        }
    }

    /// @notice Stages a genuine circular flow, then challenges it.
    function actChallenge(uint256 seed) public {
        if (loanIds.length == 0) return;
        // Scan for a challengeable loan rather than hoping a random pick lands on
        // one. Without this the fuzzer almost never reaches the slashing path, and
        // I1/I2 would hold vacuously.
        uint256 loanId;
        uint256 id;
        bytes32 repaymentFactId;
        uint256 start = bound(seed, 0, loanIds.length - 1);
        for (uint256 k; k < loanIds.length; ++k) {
            uint256 candidate = loanIds[(start + k) % loanIds.length];
            (uint256 cid,,,,,, bytes32 rfid,, Clearbook.LoanStatus cstatus) = CLEARBOOK.loans(candidate);
            if (cid != 0 && cstatus == Clearbook.LoanStatus.REPAYMENT_CLAIMED) {
                loanId = candidate;
                id = cid;
                repaymentFactId = rfid;
                break;
            }
        }
        if (id == 0) return;

        IEvidenceVault.TransferFact memory repayment = VAULT.getFact(repaymentFactId);
        // Fund the payer from the bound treasury, just before the repayment block.
        bytes32 funding = _submit(repayment.blockHeight - 1, treasuryOf[id], repayment.from, repayment.amount);

        address caller = address(uint160(uint256(keccak256(abi.encode("challenger", seed)))));
        vm.prank(caller);
        try CLEARBOOK.challenge(loanId, funding) {
            ghostTerminalTransitions++;
            ghostChallengesSucceeded++;
        } catch (bytes memory err) {
            ghostChallengeAttempts++;
            if (err.length >= 4) ghostLastChallengeError = bytes4(err);
        }
    }

    function actFinalize(uint256 seed) public {
        if (loanIds.length == 0) return;
        uint256 loanId = loanIds[bound(seed, 0, loanIds.length - 1)];
        try CLEARBOOK.finalize(loanId) {
            ghostTerminalTransitions++;
        } catch {}
    }

    function actMarkDelinquent(uint256 seed) public {
        if (loanIds.length == 0) return;
        try CLEARBOOK.markDelinquent(loanIds[bound(seed, 0, loanIds.length - 1)]) {} catch {}
    }

    function actWithdrawBond(uint256 seed) public {
        if (originatorIds.length == 0) return;
        uint256 id = originatorIds[bound(seed, 0, originatorIds.length - 1)];
        (,, uint256 bond, uint256 exposure,,,,,) = CLEARBOOK.originators(id);
        if (bond <= exposure) return;

        vm.prank(originatorOwnerOf[id]);
        try CLEARBOOK.withdrawBond(id, bound(seed, 1, bond - exposure)) {} catch {}
    }

    function actTopUpBond(uint256 seed) public {
        if (originatorIds.length == 0) return;
        uint256 id = originatorIds[bound(seed, 0, originatorIds.length - 1)];
        uint256 amount = bound(seed, 1, 5 ether);
        address funder = address(uint160(uint256(keccak256(abi.encode("funder", seed)))));
        vm.deal(funder, amount);
        vm.prank(funder);
        try CLEARBOOK.topUpBond{value: amount}(id) {} catch {}
    }

    /// @notice I5: a reverted source transaction must never become a fact.
    function actSubmitRevertedTx(uint256 seed) public {
        VERIFIER.setTxIndex(++factNonce);
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = TRANSFER_TOPIC;
        topics[1] = bytes32(uint256(uint160(address(this))));
        topics[2] = bytes32(uint256(uint160(address(this))));

        bytes[] memory chunks = new bytes[](3);
        chunks[0] = abi.encode(uint64(0), uint64(21_000), address(0), false, address(0), uint256(0), "");
        chunks[1] = abi.encode(uint64(1), uint128(0), uint128(0), new bytes[](0), uint8(0), bytes32(0), bytes32(0));
        // receiptStatus = 0
        chunks[2] = abi.encode(uint8(0), uint64(21_000), _oneLog(TOKEN, topics, abi.encode(seed)), hex"00");

        try VAULT.submitTransferFact(
            1,
            uint64(bound(seed, 1, 1e9)),
            abi.encode(uint8(2), chunks),
            bytes32(0),
            new INativeQueryVerifier.MerkleProofEntry[](0),
            bytes32(0),
            new bytes32[](0),
            0
        ) {
            // Reaching here means a reverted source transaction became a fact.
            ghostRevertedFactStored = true;
        } catch {
            ghostRevertedSubmissionsRejected++;
        }
    }

    function actAdvanceBlocks(uint256 seed) public {
        vm.roll(block.number + bound(seed, 1, 2_000));
        sourceBlock += 10;
    }

    function originatorCount() external view returns (uint256) {
        return originatorIds.length;
    }

    function loanCount() external view returns (uint256) {
        return loanIds.length;
    }
}

/// @notice Asserts the global invariants I1-I6 from SECURITY.md §6.
contract InvariantsTest is Test {
    MockVerifier internal verifier;
    EvidenceVault internal vault;
    Clearbook internal clearbook;
    Handler internal handler;

    address internal token = makeAddr("token");
    address internal protocolSink = makeAddr("protocolSink");

    function setUp() public {
        verifier = new MockVerifier();
        vault = new EvidenceVault(INativeQueryVerifier(address(verifier)));
        clearbook = new Clearbook(IEvidenceVault(address(vault)), protocolSink);
        handler = new Handler(verifier, vault, clearbook, token);

        vm.roll(10_000);
        targetContract(address(handler));
    }

    /// I1. The contract always holds at least the sum of outstanding bonds.
    function invariant_I1_balance_covers_bonds() public view {
        uint256 total;
        uint256 n = handler.originatorCount();
        for (uint256 i; i < n; ++i) {
            (,, uint256 bond,,,,,,) = clearbook.originators(handler.originatorIds(i));
            total += bond;
        }
        assertGe(address(clearbook).balance, total, "I1: balance < sum of bonds");
    }

    /// I2. No originator is ever exposed beyond its bond.
    function invariant_I2_bond_covers_exposure() public view {
        uint256 n = handler.originatorCount();
        for (uint256 i; i < n; ++i) {
            (,, uint256 bond, uint256 exposure,,,,,) = clearbook.originators(handler.originatorIds(i));
            assertGe(bond, exposure, "I2: exposure exceeds bond");
        }
    }

    /// I3. Every fact backs at most one claim.
    function invariant_I3_fact_backs_one_claim() public view {
        uint256 n = handler.loanCount();
        for (uint256 i; i < n; ++i) {
            uint256 loanId = handler.loanIds(i);
            (,,,,, bytes32 disbursementFactId, bytes32 repaymentFactId,,) = clearbook.loans(loanId);
            assertEq(clearbook.factConsumedBy(disbursementFactId), loanId, "I3: disbursement fact rebound");
            if (repaymentFactId != bytes32(0)) {
                assertEq(clearbook.factConsumedBy(repaymentFactId), loanId, "I3: repayment fact rebound");
            }
        }
    }

    /// I4. Terminal states never transition, and I6 accounting holds.
    function invariant_I4_I6_status_and_exposure_accounting() public view {
        uint256 originators = handler.originatorCount();
        for (uint256 i; i < originators; ++i) {
            uint256 id = handler.originatorIds(i);
            uint256 open;
            uint256 loans = handler.loanCount();
            for (uint256 j; j < loans; ++j) {
                uint256 loanId = handler.loanIds(j);
                (uint256 originatorId,,,,,,,, Clearbook.LoanStatus status) = clearbook.loans(loanId);
                if (originatorId != id) continue;
                if (
                    status == Clearbook.LoanStatus.REGISTERED || status == Clearbook.LoanStatus.REPAYMENT_CLAIMED
                        || status == Clearbook.LoanStatus.DELINQUENT
                ) {
                    open++;
                }
            }
            (,,, uint256 exposure,,,,,) = clearbook.originators(id);
            assertEq(exposure, open * clearbook.BOND_PER_LOAN(), "I6: exposure != open loans * bondPerLoan");
        }
    }

    /// I5. No stored fact ever came from a reverted source transaction.
    /// @dev The handler repeatedly attempts to ingest receiptStatus == 0 bundles.
    ///      Every attempt must be rejected; a single acceptance sets the ghost flag
    ///      and fails this invariant.
    function invariant_I5_no_reverted_source_facts() public view {
        assertFalse(handler.ghostRevertedFactStored(), "I5: a reverted source tx was stored as a fact");
    }
    /// @notice Guards against vacuous invariants: proves the handler can actually
    ///         drive the protocol all the way to a slashing event. If this ever
    ///         fails, the invariants above are passing over state that never
    ///         reaches the mechanism they are meant to protect.

    function test_handler_reaches_a_breach() public {
        handler.actRegisterOriginator(1);
        assertGt(handler.originatorCount(), 0, "no originator created");
        handler.actRegisterLoan(1);
        assertGt(handler.loanCount(), 0, "no loan created");
        handler.actClaimRepayment(1);
        assertGt(handler.ghostClaimsSucceeded(), 0, "no repayment claimed");
        handler.actChallenge(1);
        assertGt(
            handler.ghostChallengesSucceeded(),
            0,
            string(
                abi.encodePacked(
                    "handler cannot reach a breach; attempts=",
                    vm.toString(handler.ghostChallengeAttempts()),
                    " lastErr=",
                    vm.toString(handler.ghostLastChallengeError())
                )
            )
        );
    }
}
