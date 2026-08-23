// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TestBase} from "./helpers/TestBase.sol";
import {Clearbook} from "../src/Clearbook.sol";
import {CovenantLib} from "../src/libraries/CovenantLib.sol";

/**
 * What CIRCULAR_REPAYMENT actually means, condition by condition.
 *
 * Written as a precondition for the reference challenger: an autonomous actor
 * must not be built on a predicate whose semantics are only assumed. Every case
 * here pins observed contract behaviour, including the cases where the covenant
 * fires on activity an originator would call legitimate.
 *
 * Own contract rather than Clearbook.t.sol - that suite is at the via_ir stack
 * ceiling (D-018, D-028).
 */
contract CovenantSemanticsTest is TestBase {
    /// The honest control: borrower repays with money the treasury never sent it.
    function _claimHonestRepayment(uint256 loanId) private returns (bytes32 repaymentFactId) {
        repaymentFactId = _submitTransfer(400, 0, token, borrower, treasury, PRINCIPAL);
        vm.prank(originatorOwner);
        clearbook.claimRepayment(loanId, repaymentFactId);
    }

    /// The payer repays after the treasury funded it - a genuine circular flow.
    function _claimCircularRepayment(uint256 loanId) private returns (bytes32 fundingFactId) {
        fundingFactId = _submitTransfer(300, 0, token, treasury, payer, PRINCIPAL);
        bytes32 repaymentFactId = _submitTransfer(400, 0, token, payer, treasury, PRINCIPAL);
        vm.prank(originatorOwner);
        clearbook.claimRepayment(loanId, repaymentFactId);
    }

    // -----------------------------------------------------------------
    // 1-2. The mechanism fires, and only when it should
    // -----------------------------------------------------------------

    function test_01_genuine_breach_slashes() public {
        (, uint256 loanId,) = _setUpLoan();
        bytes32 funding = _claimCircularRepayment(loanId);

        address hunter = makeAddr("hunter");
        vm.prank(hunter);
        uint256 bounty = clearbook.challenge(loanId, funding);

        assertEq(bounty, 0.5 ether, "bounty");
        assertEq(hunter.balance, 0.5 ether, "challenger not paid");
    }

    function test_02_honest_repayment_cannot_be_breached() public {
        (, uint256 loanId, bytes32 disbursement) = _setUpLoan();
        _claimHonestRepayment(loanId);

        // The only treasury-out transfer that exists is the loan's own
        // disbursement, which condition 11 refuses by construction.
        vm.expectRevert(Clearbook.DisbursementNotFunding.selector);
        clearbook.challenge(loanId, disbursement);
    }

    // -----------------------------------------------------------------
    // 3. The second tranche - the case that decides whether an autonomous
    //    challenger is safe to run against a real lending business.
    // -----------------------------------------------------------------

    /// @notice A legitimate second tranche to the same borrower makes the FIRST
    ///         loan challengeable.
    ///
    /// Nothing here is fraudulent: the originator disburses a second tranche to
    /// a borrower it is already lending to, and the borrower then repays the
    /// first loan with its own money. The covenant does not - and cannot - see
    /// which coins repaid it. It sees that the treasury sent the payer at least
    /// the repayment amount, in the same token, inside the published window.
    ///
    /// That is the covenant firing exactly as published, not a coding error.
    /// It is recorded here because it is the single most important fact for
    /// anyone running the reference challenger.
    function test_03_second_tranche_makes_first_loan_challengeable() public {
        (, uint256 loanId,) = _setUpLoan();

        // Second tranche to the same borrower, after the first disbursement.
        bytes32 tranche2 = _submitTransfer(300, 0, token, treasury, borrower, PRINCIPAL);

        // The borrower repays loan 1.
        bytes32 repayment = _submitTransfer(400, 0, token, borrower, treasury, PRINCIPAL);
        vm.prank(originatorOwner);
        clearbook.claimRepayment(loanId, repayment);

        // Condition 11 excludes only THIS loan's disbursement, so the tranche
        // qualifies as a funding leg.
        address hunter = makeAddr("hunter");
        vm.prank(hunter);
        uint256 bounty = clearbook.challenge(loanId, tranche2);

        assertEq(bounty, 0.5 ether, "the tranche was accepted as a funding leg");
    }

    /// The same holds when the tranche is itself committed as a second loan.
    function test_04_committed_second_tranche_also_qualifies() public {
        (uint256 origId, uint256 loanId,) = _setUpLoan();

        bytes32 tranche2 = _submitTransfer(300, 0, token, treasury, borrower, PRINCIPAL);
        vm.prank(originatorOwner);
        clearbook.registerLoan(origId, token, borrower, PRINCIPAL, uint64(block.number + 1_000), tranche2);

        bytes32 repayment = _submitTransfer(400, 0, token, borrower, treasury, PRINCIPAL);
        vm.prank(originatorOwner);
        clearbook.claimRepayment(loanId, repayment);

        vm.prank(makeAddr("hunter"));
        clearbook.challenge(loanId, tranche2);
        // Reaching here without revert is the finding.
    }

    /// Narrowing the published window is the originator's defence.
    function test_05_tight_circular_window_excludes_the_tranche() public {
        address owner2 = makeAddr("tightOwner");
        vm.deal(owner2, 100 ether);
        vm.prank(owner2);
        uint256 origId = clearbook.registerOriginator{value: 10 ether}("Tight", 10, CHALLENGE_WINDOW, 0x01);

        address tre = vm.addr(0xC0FFEE);
        vm.prank(owner2);
        clearbook.bindTreasury(origId, tre, _bindingSignature(origId, tre, 0, 0xC0FFEE));

        bytes32 d1 = _submitTransfer(100, 0, token, tre, borrower, PRINCIPAL);
        vm.prank(owner2);
        uint256 loanId = clearbook.registerLoan(origId, token, borrower, PRINCIPAL, uint64(block.number + 1_000), d1);

        bytes32 tranche2 = _submitTransfer(300, 0, token, tre, borrower, PRINCIPAL);
        bytes32 repayment = _submitTransfer(400, 0, token, borrower, tre, PRINCIPAL);
        vm.prank(owner2);
        clearbook.claimRepayment(loanId, repayment);

        // 400 - 300 = 100 blocks apart, window is 10.
        vm.expectRevert(CovenantLib.OutsideWindow.selector);
        clearbook.challenge(loanId, tranche2);
    }

    // -----------------------------------------------------------------
    // 6-15. Each condition refuses for its own named reason
    // -----------------------------------------------------------------

    function test_06_wrong_token_refused() public {
        (, uint256 loanId,) = _setUpLoan();
        _claimCircularRepayment(loanId);
        bytes32 other = _submitTransfer(310, 0, makeAddr("otherToken"), treasury, payer, PRINCIPAL);
        vm.expectRevert(CovenantLib.TokenMismatch.selector);
        clearbook.challenge(loanId, other);
    }

    function test_07_wrong_payer_refused() public {
        (, uint256 loanId,) = _setUpLoan();
        _claimCircularRepayment(loanId);
        bytes32 elsewhere = _submitTransfer(310, 0, token, treasury, makeAddr("stranger"), PRINCIPAL);
        vm.expectRevert(CovenantLib.NotTheSamePayer.selector);
        clearbook.challenge(loanId, elsewhere);
    }

    function test_08_unbound_treasury_refused() public {
        (, uint256 loanId,) = _setUpLoan();
        _claimCircularRepayment(loanId);
        bytes32 notOurs = _submitTransfer(310, 0, token, makeAddr("someoneElse"), payer, PRINCIPAL);
        vm.expectRevert(CovenantLib.FundingNotFromBoundTreasury.selector);
        clearbook.challenge(loanId, notOurs);
    }

    function test_09_funding_below_repayment_refused() public {
        (, uint256 loanId,) = _setUpLoan();
        _claimCircularRepayment(loanId);
        bytes32 tooSmall = _submitTransfer(310, 0, token, treasury, payer, PRINCIPAL - 1);
        vm.expectRevert(CovenantLib.FundingBelowRepayment.selector);
        clearbook.challenge(loanId, tooSmall);
    }

    function test_10_funding_after_repayment_refused() public {
        (, uint256 loanId,) = _setUpLoan();
        _claimCircularRepayment(loanId);
        bytes32 later = _submitTransfer(500, 0, token, treasury, payer, PRINCIPAL);
        vm.expectRevert(CovenantLib.FundingNotBefore.selector);
        clearbook.challenge(loanId, later);
    }

    function test_11_citing_the_repayment_itself_refused() public {
        (, uint256 loanId,) = _setUpLoan();
        _claimCircularRepayment(loanId);
        (,,,,,, bytes32 repaymentFactId,,) = clearbook.loans(loanId);
        vm.expectRevert(Clearbook.SameFact.selector);
        clearbook.challenge(loanId, repaymentFactId);
    }

    function test_12_closed_window_refused() public {
        (, uint256 loanId,) = _setUpLoan();
        bytes32 funding = _claimCircularRepayment(loanId);
        vm.roll(block.number + CHALLENGE_WINDOW + 1);
        vm.expectRevert(Clearbook.WindowClosed.selector);
        clearbook.challenge(loanId, funding);
    }

    function test_13_last_block_of_window_still_open() public {
        (, uint256 loanId,) = _setUpLoan();
        bytes32 funding = _claimCircularRepayment(loanId);
        vm.roll(block.number + CHALLENGE_WINDOW);
        vm.prank(makeAddr("hunter"));
        assertEq(clearbook.challenge(loanId, funding), 0.5 ether, "boundary block rejected");
    }

    function test_14_unclaimed_loan_cannot_be_challenged() public {
        (, uint256 loanId,) = _setUpLoan();
        bytes32 funding = _submitTransfer(300, 0, token, treasury, payer, PRINCIPAL);
        vm.expectRevert(Clearbook.WrongStatus.selector);
        clearbook.challenge(loanId, funding);
    }

    function test_15_breached_loan_cannot_be_challenged_twice() public {
        (, uint256 loanId,) = _setUpLoan();
        bytes32 funding = _claimCircularRepayment(loanId);
        vm.prank(makeAddr("first"));
        clearbook.challenge(loanId, funding);

        vm.prank(makeAddr("second"));
        vm.expectRevert(Clearbook.WrongStatus.selector);
        clearbook.challenge(loanId, funding);
    }
}
