// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TestBase} from "./helpers/TestBase.sol";
import {Clearbook} from "../src/Clearbook.sol";
import {EvidenceVault} from "../src/EvidenceVault.sol";
import {CovenantLib} from "../src/libraries/CovenantLib.sol";

/// @notice Lifecycle tests: originators, bonds, loans, claims, settlement.
contract ClearbookTest is TestBase {
    // ---------------------------------------------------------------------
    // Registration
    // ---------------------------------------------------------------------

    function test_registerOriginator_publishes_immutable_parameters() public {
        uint256 id = _registerOriginator(5 ether);

        (
            address owner,
            string memory name,
            uint256 bond,
            uint256 exposure,
            uint32 circularWindow,
            uint32 challengeWindow,
            uint64 lastClaimBlock,
            uint16 covenants,
            bool active
        ) = clearbook.originators(id);

        assertEq(owner, originatorOwner, "owner");
        assertEq(name, "Acme Credit", "name");
        assertEq(bond, 5 ether, "bond");
        assertEq(exposure, 0, "no exposure yet");
        assertEq(circularWindow, CIRCULAR_WINDOW, "W published");
        assertEq(challengeWindow, CHALLENGE_WINDOW, "challenge window published");
        assertEq(lastClaimBlock, 0, "no claim yet");
        assertEq(covenants, 0x01, "CIRCULAR_REPAYMENT opted in");
        assertTrue(active, "active");
    }

    function test_registerOriginator_rejects_small_bond() public {
        vm.prank(originatorOwner);
        vm.expectRevert(Clearbook.BondTooSmall.selector);
        clearbook.registerOriginator{value: 0.5 ether}("X", CIRCULAR_WINDOW, CHALLENGE_WINDOW, 0x01);
    }

    function test_registerOriginator_rejects_bad_windows() public {
        vm.startPrank(originatorOwner);

        vm.expectRevert(Clearbook.BadWindow.selector);
        clearbook.registerOriginator{value: 1 ether}("X", 0, CHALLENGE_WINDOW, 0x01);

        vm.expectRevert(Clearbook.BadWindow.selector);
        clearbook.registerOriginator{value: 1 ether}("X", 50_001, CHALLENGE_WINDOW, 0x01);

        vm.expectRevert(Clearbook.BadWindow.selector);
        clearbook.registerOriginator{value: 1 ether}("X", CIRCULAR_WINDOW, 1_199, 0x01);

        vm.stopPrank();
    }

    function test_registerOriginator_requires_circular_covenant() public {
        vm.prank(originatorOwner);
        vm.expectRevert(Clearbook.CovenantRequired.selector);
        clearbook.registerOriginator{value: 1 ether}("X", CIRCULAR_WINDOW, CHALLENGE_WINDOW, 0x02);
    }

    function test_window_boundaries_accepted() public {
        vm.startPrank(originatorOwner);
        clearbook.registerOriginator{value: 1 ether}("min", 1, 1_200, 0x01);
        clearbook.registerOriginator{value: 1 ether}("max", 50_000, 1_200, 0x01);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------------
    // Treasury binding
    // ---------------------------------------------------------------------

    /// T9. Binding requires a signature from the address being bound.
    function test_bind_requires_signature() public {
        uint256 id = _registerOriginator(2 ether);

        // Signed by the wrong key.
        bytes memory badSig = _bindingSignature(id, treasury, 0, 0xBADBAD);
        vm.prank(originatorOwner);
        vm.expectRevert(Clearbook.BadSignature.selector);
        clearbook.bindTreasury(id, treasury, badSig);

        // Correct key binds.
        _bindTreasury(id);
        assertEq(clearbook.treasuryOwner(treasury), id, "bound");
        assertEq(clearbook.bindingNonce(treasury), 1, "nonce advanced");
    }

    function test_bind_requires_owner() public {
        uint256 id = _registerOriginator(2 ether);
        bytes memory sig = _bindingSignature(id, treasury, 0, treasuryKey);

        vm.prank(challenger);
        vm.expectRevert(Clearbook.NotOwner.selector);
        clearbook.bindTreasury(id, treasury, sig);
    }

    /// T10. One address binds to at most one originator, ever.
    function test_binding_replay() public {
        uint256 first = _registerOriginator(2 ether);
        _bindTreasury(first);

        address secondOwner = makeAddr("secondOwner");
        vm.deal(secondOwner, 10 ether);
        vm.prank(secondOwner);
        uint256 second =
            clearbook.registerOriginator{value: 2 ether}("Other", CIRCULAR_WINDOW, CHALLENGE_WINDOW, 0x01);

        // Even a correctly signed binding for the second originator is refused.
        bytes memory sig = _bindingSignature(second, treasury, 1, treasuryKey);
        vm.prank(secondOwner);
        vm.expectRevert(Clearbook.AlreadyBound.selector);
        clearbook.bindTreasury(second, treasury, sig);

        assertEq(clearbook.treasuryOwner(treasury), first, "still bound to the first");
    }

    // ---------------------------------------------------------------------
    // Bonds
    // ---------------------------------------------------------------------

    function test_topUpBond_is_permissionless() public {
        uint256 id = _registerOriginator(1 ether);

        vm.prank(challenger);
        clearbook.topUpBond{value: 1 ether}(id);

        (,, uint256 bond,,,,,,) = clearbook.originators(id);
        assertEq(bond, 2 ether, "topped up by a third party");
    }

    function test_withdrawBond_succeeds_when_unexposed() public {
        uint256 id = _registerOriginator(5 ether);
        vm.roll(block.number + clearbook.WITHDRAW_COOLDOWN() + 1);

        uint256 before = originatorOwner.balance;
        vm.prank(originatorOwner);
        clearbook.withdrawBond(id, 2 ether);

        assertEq(originatorOwner.balance, before + 2 ether, "paid out");
        (,, uint256 bond,,,,,,) = clearbook.originators(id);
        assertEq(bond, 3 ether, "bond reduced");
    }

    function test_withdrawBond_requires_owner() public {
        uint256 id = _registerOriginator(5 ether);
        vm.roll(block.number + clearbook.WITHDRAW_COOLDOWN() + 1);

        vm.prank(challenger);
        vm.expectRevert(Clearbook.NotOwner.selector);
        clearbook.withdrawBond(id, 1 ether);
    }

    /// T12. Exposure is not withdrawable.
    function test_cannot_withdraw_exposed() public {
        (uint256 id,,) = _setUpLoan();
        vm.roll(block.number + clearbook.WITHDRAW_COOLDOWN() + 1);

        // 10 CTC bonded, 1 CTC exposed by the open loan.
        vm.prank(originatorOwner);
        vm.expectRevert(Clearbook.Overexposed.selector);
        clearbook.withdrawBond(id, 10 ether);

        vm.prank(originatorOwner);
        clearbook.withdrawBond(id, 9 ether);

        (,, uint256 bond, uint256 exposure,,,,,) = clearbook.originators(id);
        assertEq(bond, 1 ether, "only exposure remains");
        assertEq(exposure, 1 ether, "exposure intact");
    }

    /// T12. Bond flight ahead of a challenge is blocked by the cooldown.
    function test_withdraw_blocked_during_cooldown_after_claim() public {
        (uint256 id, uint256 loanId,) = _setUpLoan();
        bytes32 repayment = _submitTransfer(200, 1, token, borrower, treasury, PRINCIPAL);
        vm.prank(originatorOwner);
        clearbook.claimRepayment(loanId, repayment);

        vm.prank(originatorOwner);
        vm.expectRevert(Clearbook.CooldownActive.selector);
        clearbook.withdrawBond(id, 1 ether);

        vm.roll(block.number + clearbook.WITHDRAW_COOLDOWN() + 1);
        vm.prank(originatorOwner);
        clearbook.withdrawBond(id, 1 ether);
    }

    // ---------------------------------------------------------------------
    // Loans
    // ---------------------------------------------------------------------

    function test_registerLoan_binds_evidence_to_claim() public {
        (uint256 id, uint256 loanId, bytes32 factId) = _setUpLoan();

        (
            uint256 originatorId,
            address token_,
            address borrower_,
            uint256 principal,
            uint64 maturityBlock,
            bytes32 disbursementFactId,
            bytes32 repaymentFactId,
            uint64 claimBlock,
            Clearbook.LoanStatus status
        ) = clearbook.loans(loanId);

        assertEq(originatorId, id, "originator");
        assertEq(token_, token, "token");
        assertEq(borrower_, borrower, "borrower");
        assertEq(principal, PRINCIPAL, "principal");
        assertGt(maturityBlock, block.number, "matures in future");
        assertEq(disbursementFactId, factId, "evidence cited");
        assertEq(repaymentFactId, bytes32(0), "no repayment yet");
        assertEq(claimBlock, 0, "no claim yet");
        assertTrue(status == Clearbook.LoanStatus.REGISTERED, "REGISTERED");

        assertEq(clearbook.factConsumedBy(factId), loanId, "fact consumed");
        (,,, uint256 exposure,,,,,) = clearbook.originators(id);
        assertEq(exposure, clearbook.BOND_PER_LOAN(), "exposure increased");
    }

    /// T6. The declared token must match the verified log's token.
    function test_wrong_token_rejected() public {
        uint256 id = _registerOriginator(10 ether);
        _bindTreasury(id);
        bytes32 factId = _submitTransfer(100, 0, otherToken, treasury, borrower, PRINCIPAL);

        vm.prank(originatorOwner);
        vm.expectRevert(Clearbook.FactMismatch.selector);
        clearbook.registerLoan(id, token, borrower, PRINCIPAL, uint64(block.number + 1_000), factId);
    }

    function test_registerLoan_rejects_wrong_recipient_and_amount() public {
        uint256 id = _registerOriginator(10 ether);
        _bindTreasury(id);

        bytes32 wrongTo = _submitTransfer(100, 0, token, treasury, payer, PRINCIPAL);
        vm.prank(originatorOwner);
        vm.expectRevert(Clearbook.FactMismatch.selector);
        clearbook.registerLoan(id, token, borrower, PRINCIPAL, uint64(block.number + 1_000), wrongTo);

        bytes32 wrongAmount = _submitTransfer(101, 0, token, treasury, borrower, PRINCIPAL - 1);
        vm.prank(originatorOwner);
        vm.expectRevert(Clearbook.FactMismatch.selector);
        clearbook.registerLoan(id, token, borrower, PRINCIPAL, uint64(block.number + 1_000), wrongAmount);
    }

    /// T17. Money must leave an address the originator actually bound.
    function test_registerLoan_requires_bound_treasury() public {
        uint256 id = _registerOriginator(10 ether);
        bytes32 factId = _submitTransfer(100, 0, token, treasury, borrower, PRINCIPAL);

        vm.prank(originatorOwner);
        vm.expectRevert(Clearbook.TreasuryNotBound.selector);
        clearbook.registerLoan(id, token, borrower, PRINCIPAL, uint64(block.number + 1_000), factId);
    }

    function test_registerLoan_requires_future_maturity() public {
        uint256 id = _registerOriginator(10 ether);
        _bindTreasury(id);
        bytes32 factId = _submitTransfer(100, 0, token, treasury, borrower, PRINCIPAL);

        vm.prank(originatorOwner);
        vm.expectRevert(Clearbook.BadWindow.selector);
        clearbook.registerLoan(id, token, borrower, PRINCIPAL, uint64(block.number), factId);
    }

    function test_registerLoan_requires_sufficient_bond() public {
        uint256 id = _registerOriginator(1 ether);
        _bindTreasury(id);

        bytes32 first = _submitTransfer(100, 0, token, treasury, borrower, PRINCIPAL);
        vm.prank(originatorOwner);
        clearbook.registerLoan(id, token, borrower, PRINCIPAL, uint64(block.number + 1_000), first);

        // The whole bond is now exposed; a second loan cannot be backed.
        bytes32 second = _submitTransfer(101, 0, token, treasury, borrower, PRINCIPAL);
        vm.prank(originatorOwner);
        vm.expectRevert(Clearbook.InsufficientBond.selector);
        clearbook.registerLoan(id, token, borrower, PRINCIPAL, uint64(block.number + 1_000), second);
    }

    function test_registerLoan_requires_known_fact() public {
        uint256 id = _registerOriginator(10 ether);
        _bindTreasury(id);

        vm.prank(originatorOwner);
        vm.expectRevert(EvidenceVault.UnknownFact.selector);
        clearbook.registerLoan(id, token, borrower, PRINCIPAL, uint64(block.number + 1_000), keccak256("ghost"));
    }

    /// T11. One fact backs at most one claim.
    function test_fact_reuse_rejected() public {
        (uint256 id,, bytes32 factId) = _setUpLoan();

        vm.prank(originatorOwner);
        vm.expectRevert(Clearbook.FactAlreadyUsed.selector);
        clearbook.registerLoan(id, token, borrower, PRINCIPAL, uint64(block.number + 1_000), factId);
    }

    // ---------------------------------------------------------------------
    // Claims, delinquency, settlement
    // ---------------------------------------------------------------------

    /// Happy path: register, claim, finalize.
    function test_register_claim_finalize() public {
        (uint256 id, uint256 loanId,) = _setUpLoan();

        bytes32 repayment = _submitTransfer(200, 1, token, borrower, treasury, PRINCIPAL);
        vm.prank(originatorOwner);
        clearbook.claimRepayment(loanId, repayment);

        (,,,,,, bytes32 repaymentFactId, uint64 claimBlock, Clearbook.LoanStatus status) = clearbook.loans(loanId);
        assertEq(repaymentFactId, repayment, "repayment cited");
        assertEq(claimBlock, uint64(block.number), "claim block recorded");
        assertTrue(status == Clearbook.LoanStatus.REPAYMENT_CLAIMED, "REPAYMENT_CLAIMED");

        // Cannot settle while the window is open.
        vm.expectRevert(Clearbook.WindowOpen.selector);
        clearbook.finalize(loanId);

        vm.roll(block.number + CHALLENGE_WINDOW + 1);
        clearbook.finalize(loanId);

        (,,,,,,,, status) = clearbook.loans(loanId);
        assertTrue(status == Clearbook.LoanStatus.SETTLED, "SETTLED");
        (,,, uint256 exposure,,,,,) = clearbook.originators(id);
        assertEq(exposure, 0, "exposure released");
    }

    /// T19. Repayment must cover principal; disbursement must match exactly.
    function test_amount_boundaries() public {
        (, uint256 loanId,) = _setUpLoan();

        bytes32 short = _submitTransfer(200, 1, token, borrower, treasury, PRINCIPAL - 1);
        vm.prank(originatorOwner);
        vm.expectRevert(Clearbook.AmountTooLow.selector);
        clearbook.claimRepayment(loanId, short);

        // Exactly principal is accepted, and so is an overpayment.
        bytes32 exact = _submitTransfer(201, 1, token, borrower, treasury, PRINCIPAL);
        vm.prank(originatorOwner);
        clearbook.claimRepayment(loanId, exact);
    }

    function test_claimRepayment_requires_bound_recipient_and_token() public {
        (, uint256 loanId,) = _setUpLoan();

        bytes32 unbound = _submitTransfer(200, 1, token, borrower, payer, PRINCIPAL);
        vm.prank(originatorOwner);
        vm.expectRevert(Clearbook.FactMismatch.selector);
        clearbook.claimRepayment(loanId, unbound);

        bytes32 wrongToken = _submitTransfer(201, 1, otherToken, borrower, treasury, PRINCIPAL);
        vm.prank(originatorOwner);
        vm.expectRevert(Clearbook.FactMismatch.selector);
        clearbook.claimRepayment(loanId, wrongToken);
    }

    function test_claimRepayment_requires_owner_and_status() public {
        (, uint256 loanId,) = _setUpLoan();
        bytes32 repayment = _submitTransfer(200, 1, token, borrower, treasury, PRINCIPAL);

        vm.prank(challenger);
        vm.expectRevert(Clearbook.NotOwner.selector);
        clearbook.claimRepayment(loanId, repayment);

        vm.prank(originatorOwner);
        clearbook.claimRepayment(loanId, repayment);

        // Already claimed: a second claim is refused.
        bytes32 another = _submitTransfer(202, 1, token, borrower, treasury, PRINCIPAL);
        vm.prank(originatorOwner);
        vm.expectRevert(Clearbook.WrongStatus.selector);
        clearbook.claimRepayment(loanId, another);
    }

    function test_markDelinquent_is_permissionless_after_maturity() public {
        (, uint256 loanId,) = _setUpLoan();

        vm.expectRevert(Clearbook.NotYetMature.selector);
        clearbook.markDelinquent(loanId);

        vm.roll(block.number + 1_001);
        vm.prank(challenger);
        clearbook.markDelinquent(loanId);

        (,,,,,,,, Clearbook.LoanStatus status) = clearbook.loans(loanId);
        assertTrue(status == Clearbook.LoanStatus.DELINQUENT, "DELINQUENT");
    }

    /// A delinquent loan can still be repaid.
    function test_delinquent_loan_can_be_claimed() public {
        (, uint256 loanId,) = _setUpLoan();
        vm.roll(block.number + 1_001);
        clearbook.markDelinquent(loanId);

        bytes32 repayment = _submitTransfer(200, 1, token, borrower, treasury, PRINCIPAL);
        vm.prank(originatorOwner);
        clearbook.claimRepayment(loanId, repayment);

        (,,,,,,,, Clearbook.LoanStatus status) = clearbook.loans(loanId);
        assertTrue(status == Clearbook.LoanStatus.REPAYMENT_CLAIMED, "REPAYMENT_CLAIMED");
    }

    function test_markDelinquent_rejects_wrong_status() public {
        (, uint256 loanId,) = _setUpLoan();
        bytes32 repayment = _submitTransfer(200, 1, token, borrower, treasury, PRINCIPAL);
        vm.prank(originatorOwner);
        clearbook.claimRepayment(loanId, repayment);

        vm.roll(block.number + 1_001);
        vm.expectRevert(Clearbook.WrongStatus.selector);
        clearbook.markDelinquent(loanId);
    }

    function test_finalize_rejects_wrong_status() public {
        (, uint256 loanId,) = _setUpLoan();
        vm.expectRevert(Clearbook.WrongStatus.selector);
        clearbook.finalize(loanId);
    }

    function test_covenant_ids_are_stable() public pure {
        assertEq(CovenantLib.CIRCULAR_REPAYMENT, 0x01, "0x01");
        assertEq(CovenantLib.EVIDENCE_UNIQUENESS, 0x02, "0x02");
        assertEq(CovenantLib.EVIDENCE_FIRST, 0x03, "0x03");
    }
}
