// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TestBase} from "./helpers/TestBase.sol";
import {Clearbook} from "../src/Clearbook.sol";
import {CovenantLib} from "../src/libraries/CovenantLib.sol";

/// @notice Adversarial tests for the challenge path — the mechanism that moves money.
contract SecurityTest is TestBase {
    uint64 internal constant DISBURSE_BLOCK = 100;
    uint64 internal constant FUNDING_BLOCK = 150;
    uint64 internal constant REPAY_BLOCK = 160;

    /// @dev treasury -> borrower (disbursed), treasury -> payer (funding leg),
    ///      payer -> treasury (claimed repayment). A textbook circular flow.
    function _setUpBreach() internal returns (uint256 id, uint256 loanId, bytes32 fundingFactId) {
        id = _registerOriginator(10 ether);
        _bindTreasury(id);

        bytes32 disbursement = _submitTransfer(DISBURSE_BLOCK, 0, token, treasury, borrower, PRINCIPAL);
        vm.prank(originatorOwner);
        loanId = clearbook.registerLoan(id, token, borrower, PRINCIPAL, uint64(block.number + 1_000), disbursement);

        fundingFactId = _submitTransfer(FUNDING_BLOCK, 1, token, treasury, payer, PRINCIPAL);
        bytes32 repayment = _submitTransfer(REPAY_BLOCK, 2, token, payer, treasury, PRINCIPAL);

        vm.prank(originatorOwner);
        clearbook.claimRepayment(loanId, repayment);
    }

    /// setup: a circular flow within W.
    /// action: anyone challenges.
    /// expected: BREACHED, bond slashed, bounty paid, remainder to the sink.
    function test_circular_flow_breach() public {
        (uint256 id, uint256 loanId, bytes32 fundingFactId) = _setUpBreach();

        uint256 challengerBefore = challenger.balance;
        uint256 sinkBefore = protocolSink.balance;

        vm.prank(challenger);
        uint256 bounty = clearbook.challenge(loanId, fundingFactId);

        uint256 expectedSlash = clearbook.BOND_PER_LOAN(); // SLASH_BPS == 100%
        uint256 expectedBounty = expectedSlash / 2; // BOUNTY_BPS == 50%

        assertEq(bounty, expectedBounty, "bounty");
        assertEq(challenger.balance, challengerBefore + expectedBounty, "challenger paid");
        assertEq(protocolSink.balance, sinkBefore + (expectedSlash - expectedBounty), "sink paid remainder");

        (,,,,,,,, Clearbook.LoanStatus status) = clearbook.loans(loanId);
        assertTrue(status == Clearbook.LoanStatus.BREACHED, "BREACHED");

        (,, uint256 bond, uint256 exposure,,,,,) = clearbook.originators(id);
        assertEq(bond, 10 ether - expectedSlash, "bond slashed exactly");
        assertEq(exposure, 0, "exposure released");
    }

    /// T13. A loan is slashed at most once.
    function test_double_slash() public {
        (, uint256 loanId, bytes32 fundingFactId) = _setUpBreach();

        vm.prank(challenger);
        clearbook.challenge(loanId, fundingFactId);

        vm.prank(challenger);
        vm.expectRevert(Clearbook.WrongStatus.selector);
        clearbook.challenge(loanId, fundingFactId);
    }

    /// T15. setup: a challenge citing evidence that does not breach.
    /// action: challenge.
    /// expected: revert, and state left bit-identical.
    function test_invalid_challenge_reverts() public {
        (uint256 id, uint256 loanId,) = _setUpBreach();

        // An unrelated transfer between third parties.
        bytes32 unrelated = _submitTransfer(155, 3, token, borrower, payer, PRINCIPAL);

        (,, uint256 bondBefore, uint256 exposureBefore,,,,,) = clearbook.originators(id);
        uint256 challengerBefore = challenger.balance;

        vm.prank(challenger);
        vm.expectRevert(CovenantLib.FundingNotFromBoundTreasury.selector);
        clearbook.challenge(loanId, unrelated);

        (,, uint256 bondAfter, uint256 exposureAfter,,,,,) = clearbook.originators(id);
        assertEq(bondAfter, bondBefore, "bond untouched");
        assertEq(exposureAfter, exposureBefore, "exposure untouched");
        assertEq(challenger.balance, challengerBefore, "no payout");

        (,,,,,,,, Clearbook.LoanStatus status) = clearbook.loans(loanId);
        assertTrue(status == Clearbook.LoanStatus.REPAYMENT_CLAIMED, "still claimable");
    }

    /// T17. The honest control: funding from an address the originator never bound
    ///      is NOT a breach. This is the documented depth-1 limit, enforced.
    function test_unbound_funding_not_a_breach() public {
        uint256 id = _registerOriginator(10 ether);
        _bindTreasury(id);

        bytes32 disbursement = _submitTransfer(DISBURSE_BLOCK, 0, token, treasury, borrower, PRINCIPAL);
        vm.prank(originatorOwner);
        uint256 loanId =
            clearbook.registerLoan(id, token, borrower, PRINCIPAL, uint64(block.number + 1_000), disbursement);

        // An unrelated faucet funds the borrower, not the originator's treasury.
        address faucet = makeAddr("faucet");
        bytes32 funding = _submitTransfer(FUNDING_BLOCK, 1, token, faucet, borrower, PRINCIPAL);
        bytes32 repayment = _submitTransfer(REPAY_BLOCK, 2, token, borrower, treasury, PRINCIPAL);
        vm.prank(originatorOwner);
        clearbook.claimRepayment(loanId, repayment);

        vm.prank(challenger);
        vm.expectRevert(CovenantLib.FundingNotFromBoundTreasury.selector);
        clearbook.challenge(loanId, funding);
    }

    /// T18. Ordering: funding cannot post-date the repayment it supposedly funded.
    function test_ordering_enforced() public {
        uint256 id = _registerOriginator(10 ether);
        _bindTreasury(id);

        bytes32 disbursement = _submitTransfer(DISBURSE_BLOCK, 0, token, treasury, borrower, PRINCIPAL);
        vm.prank(originatorOwner);
        uint256 loanId =
            clearbook.registerLoan(id, token, borrower, PRINCIPAL, uint64(block.number + 1_000), disbursement);

        bytes32 repayment = _submitTransfer(200, 1, token, payer, treasury, PRINCIPAL);
        vm.prank(originatorOwner);
        clearbook.claimRepayment(loanId, repayment);

        // Funding AFTER the repayment.
        bytes32 lateFunding = _submitTransfer(250, 2, token, treasury, payer, PRINCIPAL);

        vm.prank(challenger);
        vm.expectRevert(CovenantLib.FundingNotBefore.selector);
        clearbook.challenge(loanId, lateFunding);
    }

    /// T20. Same-block circularity is still circularity.
    function test_same_block_breach() public {
        uint256 id = _registerOriginator(10 ether);
        _bindTreasury(id);

        bytes32 disbursement = _submitTransfer(DISBURSE_BLOCK, 0, token, treasury, borrower, PRINCIPAL);
        vm.prank(originatorOwner);
        uint256 loanId =
            clearbook.registerLoan(id, token, borrower, PRINCIPAL, uint64(block.number + 1_000), disbursement);

        // Both legs in block 300, distinguished by txIndex.
        bytes32 funding = _submitTransfer(300, 1, token, treasury, payer, PRINCIPAL);
        bytes32 repayment = _submitTransfer(300, 2, token, payer, treasury, PRINCIPAL);
        vm.prank(originatorOwner);
        clearbook.claimRepayment(loanId, repayment);

        vm.prank(challenger);
        clearbook.challenge(loanId, funding);

        (,,,,,,,, Clearbook.LoanStatus status) = clearbook.loans(loanId);
        assertTrue(status == Clearbook.LoanStatus.BREACHED, "same-block breach valid");
    }

    /// Condition 9: outside the published window is not a breach.
    function test_outside_window_not_a_breach() public {
        uint256 id = _registerOriginator(10 ether);
        _bindTreasury(id);

        bytes32 disbursement = _submitTransfer(DISBURSE_BLOCK, 0, token, treasury, borrower, PRINCIPAL);
        vm.prank(originatorOwner);
        uint256 loanId =
            clearbook.registerLoan(id, token, borrower, PRINCIPAL, uint64(block.number + 1_000), disbursement);

        bytes32 funding = _submitTransfer(1_000, 1, token, treasury, payer, PRINCIPAL);
        // CIRCULAR_WINDOW is 5000, so 6001 blocks later is outside it.
        bytes32 repayment = _submitTransfer(7_001, 2, token, payer, treasury, PRINCIPAL);
        vm.prank(originatorOwner);
        clearbook.claimRepayment(loanId, repayment);

        vm.prank(challenger);
        vm.expectRevert(CovenantLib.OutsideWindow.selector);
        clearbook.challenge(loanId, funding);
    }

    /// T5. Facts from different source chains cannot be compared.
    function test_cross_chain_rejected() public {
        uint256 id = _registerOriginator(10 ether);
        _bindTreasury(id);

        bytes32 disbursement = _submitTransfer(DISBURSE_BLOCK, 0, token, treasury, borrower, PRINCIPAL);
        vm.prank(originatorOwner);
        uint256 loanId =
            clearbook.registerLoan(id, token, borrower, PRINCIPAL, uint64(block.number + 1_000), disbursement);

        bytes32 repayment = _submitTransfer(REPAY_BLOCK, 2, token, payer, treasury, PRINCIPAL);
        vm.prank(originatorOwner);
        clearbook.claimRepayment(loanId, repayment);

        // Same shape, but on chainKey 3.
        bytes32 foreignFunding =
            _submitFact(3, FUNDING_BLOCK, 1, 0, 1, _singleLog(_transferLog(token, treasury, payer, PRINCIPAL)));

        vm.prank(challenger);
        vm.expectRevert(CovenantLib.ChainMismatch.selector);
        clearbook.challenge(loanId, foreignFunding);
    }

    /// Condition 4: a different token is not the same money.
    function test_token_mismatch_rejected() public {
        (, uint256 loanId,) = _setUpBreach();
        bytes32 wrongToken = _submitTransfer(FUNDING_BLOCK, 5, otherToken, treasury, payer, PRINCIPAL);

        vm.prank(challenger);
        vm.expectRevert(CovenantLib.TokenMismatch.selector);
        clearbook.challenge(loanId, wrongToken);
    }

    /// Condition 5: the funded address must be the one that repaid.
    function test_not_the_same_payer_rejected() public {
        (, uint256 loanId,) = _setUpBreach();
        bytes32 otherRecipient = _submitTransfer(FUNDING_BLOCK, 6, token, treasury, borrower, PRINCIPAL);

        vm.prank(challenger);
        vm.expectRevert(CovenantLib.NotTheSamePayer.selector);
        clearbook.challenge(loanId, otherRecipient);
    }

    /// Condition 7: funding below the repayment does not account for it.
    function test_funding_below_repayment_rejected() public {
        (, uint256 loanId,) = _setUpBreach();
        bytes32 small = _submitTransfer(FUNDING_BLOCK + 1, 7, token, treasury, payer, PRINCIPAL - 1);

        vm.prank(challenger);
        vm.expectRevert(CovenantLib.FundingBelowRepayment.selector);
        clearbook.challenge(loanId, small);
    }

    /// Conditions 10-11: the loan's own facts cannot serve as the funding leg.
    function test_same_fact_and_disbursement_rejected() public {
        (, uint256 loanId,) = _setUpBreach();
        (,,,,, bytes32 disbursementFactId, bytes32 repaymentFactId,,) = clearbook.loans(loanId);

        vm.prank(challenger);
        vm.expectRevert(Clearbook.SameFact.selector);
        clearbook.challenge(loanId, repaymentFactId);

        vm.prank(challenger);
        vm.expectRevert(Clearbook.DisbursementNotFunding.selector);
        clearbook.challenge(loanId, disbursementFactId);
    }

    /// Condition 2: the challenge window closes.
    function test_challenge_window_closes() public {
        (, uint256 loanId, bytes32 fundingFactId) = _setUpBreach();

        vm.roll(block.number + CHALLENGE_WINDOW + 1);
        vm.prank(challenger);
        vm.expectRevert(Clearbook.WindowClosed.selector);
        clearbook.challenge(loanId, fundingFactId);
    }

    /// D-022: a loan without a claimed repayment cannot be challenged.
    function test_challenge_requires_claimed_repayment() public {
        uint256 id = _registerOriginator(10 ether);
        _bindTreasury(id);
        bytes32 disbursement = _submitTransfer(DISBURSE_BLOCK, 0, token, treasury, borrower, PRINCIPAL);
        vm.prank(originatorOwner);
        uint256 loanId =
            clearbook.registerLoan(id, token, borrower, PRINCIPAL, uint64(block.number + 1_000), disbursement);

        bytes32 funding = _submitTransfer(FUNDING_BLOCK, 1, token, treasury, payer, PRINCIPAL);

        vm.prank(challenger);
        vm.expectRevert(Clearbook.WrongStatus.selector);
        clearbook.challenge(loanId, funding);
    }

    /// A settled loan is terminal.
    function test_settled_loan_cannot_be_challenged() public {
        (, uint256 loanId, bytes32 fundingFactId) = _setUpBreach();

        vm.roll(block.number + CHALLENGE_WINDOW + 1);
        clearbook.finalize(loanId);

        vm.prank(challenger);
        vm.expectRevert(Clearbook.WrongStatus.selector);
        clearbook.challenge(loanId, fundingFactId);
    }

    /// T14. Reentering challenge() during the bounty payout must not double-pay.
    function test_reentrancy_bounty() public {
        (uint256 id, uint256 loanId, bytes32 fundingFactId) = _setUpBreach();

        ReentrantChallenger attacker = new ReentrantChallenger(clearbook);
        (,, uint256 bondBefore,,,,,,) = clearbook.originators(id);

        // The guard makes the re-entrant call revert, which makes the payout call
        // fail, which reverts the whole challenge. Fail closed.
        vm.expectRevert(Clearbook.TransferFailed.selector);
        attacker.attack(loanId, fundingFactId);

        (,, uint256 bondAfter,,,,,,) = clearbook.originators(id);
        assertEq(bondAfter, bondBefore, "bond untouched");
        assertEq(address(attacker).balance, 0, "attacker paid nothing");

        (,,,,,,,, Clearbook.LoanStatus status) = clearbook.loans(loanId);
        assertTrue(status == Clearbook.LoanStatus.REPAYMENT_CLAIMED, "loan still challengeable");
    }

    /// T23. A payee that reverts cannot brick the mechanism: the call reverts and
    ///      the loan stays challengeable by someone else.
    function test_payout_to_reverting_contract() public {
        (uint256 id, uint256 loanId, bytes32 fundingFactId) = _setUpBreach();

        RevertingChallenger attacker = new RevertingChallenger(clearbook);
        (,, uint256 bondBefore,,,,,,) = clearbook.originators(id);

        vm.expectRevert(Clearbook.TransferFailed.selector);
        attacker.attack(loanId, fundingFactId);

        (,, uint256 bondAfter,,,,,,) = clearbook.originators(id);
        assertEq(bondAfter, bondBefore, "bond untouched");

        // An ordinary challenger still succeeds.
        vm.prank(challenger);
        clearbook.challenge(loanId, fundingFactId);
        (,,,,,,,, Clearbook.LoanStatus status) = clearbook.loans(loanId);
        assertTrue(status == Clearbook.LoanStatus.BREACHED, "still breachable by others");
    }

    /// I1. The contract never pays out more than it holds.
    function test_contract_balance_covers_bonds() public {
        (uint256 id, uint256 loanId, bytes32 fundingFactId) = _setUpBreach();

        vm.prank(challenger);
        clearbook.challenge(loanId, fundingFactId);

        (,, uint256 bond,,,,,,) = clearbook.originators(id);
        assertGe(address(clearbook).balance, bond, "I1 holds after slashing");
    }
}

/// @notice Re-enters challenge() from the bounty payout.
contract ReentrantChallenger {
    Clearbook internal immutable CLEARBOOK;
    uint256 internal loanId;
    bytes32 internal fundingFactId;
    bool internal entered;

    constructor(Clearbook clearbook_) {
        CLEARBOOK = clearbook_;
    }

    function attack(uint256 loanId_, bytes32 fundingFactId_) external {
        loanId = loanId_;
        fundingFactId = fundingFactId_;
        CLEARBOOK.challenge(loanId_, fundingFactId_);
    }

    receive() external payable {
        if (!entered) {
            entered = true;
            CLEARBOOK.challenge(loanId, fundingFactId);
        }
    }
}

/// @notice Refuses the bounty.
contract RevertingChallenger {
    Clearbook internal immutable CLEARBOOK;

    constructor(Clearbook clearbook_) {
        CLEARBOOK = clearbook_;
    }

    function attack(uint256 loanId_, bytes32 fundingFactId_) external {
        CLEARBOOK.challenge(loanId_, fundingFactId_);
    }

    receive() external payable {
        revert("no thanks");
    }
}
