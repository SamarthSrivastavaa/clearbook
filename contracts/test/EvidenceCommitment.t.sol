// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TestBase} from "./helpers/TestBase.sol";
import {Clearbook} from "../src/Clearbook.sol";

/**
 * The registry's central property: a verified fact backs at most one claim.
 *
 * `factConsumedBy` is a single global mapping, not a per-originator one, so the
 * guard holds across every institution in the registry. That is what makes a
 * shared evidence namespace worth more than each fund keeping its own — and it
 * is the one property that must never regress.
 *
 * These live in their own contract rather than in `Clearbook.t.sol`: that suite
 * already sits at the stack ceiling under `via_ir`, and adding memory-heavy
 * fixtures to it fails codegen rather than the test (D-018, D-028).
 *
 * Scope discipline: this establishes that the same *evidence* cannot be
 * committed twice. It says nothing about collateral identity — the same
 * underlying obligation represented by a different transaction is not detected,
 * and this suite does not pretend otherwise.
 */
contract EvidenceCommitmentTest is TestBase {
    /// Reads one originator's exposure in its own stack frame — see D-018.
    function _exposureOf(uint256 originatorId) private view returns (uint256 exposure) {
        (,,, exposure,,,,,) = clearbook.originators(originatorId);
    }

    /// A second, fully independent originator: own owner, own bond, own treasury.
    function _registerSecondOriginator() private returns (address ownerB, uint256 idB) {
        ownerB = makeAddr("originatorOwnerB");
        vm.deal(ownerB, 100 ether);

        vm.prank(ownerB);
        idB = clearbook.registerOriginator{value: 10 ether}("Northgate", CIRCULAR_WINDOW, CHALLENGE_WINDOW, 0x01);

        address treasuryB = vm.addr(0xB0B);
        vm.prank(ownerB);
        clearbook.bindTreasury(idB, treasuryB, _bindingSignature(idB, treasuryB, 0, 0xB0B));
    }

    /// A further loan under the same originator, built in its own frame.
    function _secondLoanFor(uint256 originatorId) private returns (uint256) {
        bytes32 d = _submitTransfer(201, 0, token, treasury, borrower, PRINCIPAL);
        vm.prank(originatorOwner);
        return clearbook.registerLoan(originatorId, token, borrower, PRINCIPAL, uint64(block.number + 1_000), d);
    }

    /// @notice A verified fact backs at most one claim, across ALL originators.
    ///
    /// Two independent, separately bonded institutions cannot both commit the
    /// same piece of evidence.
    ///
    /// This also pins the guard ORDER. Originator B's treasury is not the fact's
    /// sender, so if `FactAlreadyUsed` were checked after the treasury binding,
    /// this would revert `TreasuryNotBound` instead — reporting the wrong reason
    /// for the refusal and hiding the property under test.
    function test_cross_originator_duplicate_commitment_rejected() public {
        (, uint256 loanId, bytes32 factId) = _setUpLoan();
        (address ownerB, uint256 idB) = _registerSecondOriginator();

        vm.prank(ownerB);
        vm.expectRevert(Clearbook.FactAlreadyUsed.selector);
        clearbook.registerLoan(idB, token, borrower, PRINCIPAL, uint64(block.number + 1_000), factId);

        // The refusal changes nothing: A keeps the fact, B takes on no exposure.
        assertEq(clearbook.factConsumedBy(factId), loanId, "fact was rebound");
        assertEq(_exposureOf(idB), 0, "B took on exposure from a refused commitment");
    }

    /// @notice Self-challenge is strictly loss-making.
    ///
    /// The documentation states that `BOUNTY_BPS < SLASH_BPS` is what stops an
    /// originator challenging its own breaching claim to recover the bond. That
    /// is an economic claim about deployed parameters, so it is asserted here
    /// rather than left to be believed: the originator ends down by the burned
    /// remainder, whoever presses the button.
    function test_self_challenge_is_loss_making() public {
        (uint256 idA, uint256 loanId,) = _setUpLoan();

        // A genuine circular flow: treasury funds the payer, payer repays.
        bytes32 fundingFactId = _submitTransfer(300, 0, token, treasury, payer, PRINCIPAL);
        bytes32 repaymentFactId = _submitTransfer(301, 0, token, payer, treasury, PRINCIPAL);

        vm.prank(originatorOwner);
        clearbook.claimRepayment(loanId, repaymentFactId);

        uint256 bondBefore = _bondOf(idA);
        uint256 walletBefore = originatorOwner.balance;

        // The originator challenges its own claim.
        vm.prank(originatorOwner);
        uint256 bounty = clearbook.challenge(loanId, fundingFactId);

        uint256 lost = bondBefore - _bondOf(idA);
        assertEq(lost, 1 ether, "slash was not the full bond for the claim");
        assertEq(bounty, 0.5 ether, "bounty was not half the slash");
        assertEq(originatorOwner.balance, walletBefore + bounty, "bounty was not paid");

        // Net position: down by the burned remainder. Breaking the covenant is
        // never free, even when you are the one who reports it.
        assertLt(bounty, lost, "self-challenge recovered the full slash");
        assertEq(lost - bounty, 0.5 ether, "burned remainder is not the difference");
    }

    /// Reads one originator's bond in its own stack frame — see D-018.
    function _bondOf(uint256 originatorId) private view returns (uint256 bond) {
        (,, bond,,,,,,) = clearbook.originators(originatorId);
    }

    /// @notice The same guard protects the repayment leg.
    ///
    /// One inbound payment cannot be credited as the settlement of two loans.
    function test_duplicate_repayment_commitment_rejected() public {
        (uint256 idA, uint256 loanId,) = _setUpLoan();
        bytes32 r = _submitTransfer(200, 0, token, borrower, treasury, PRINCIPAL);

        vm.prank(originatorOwner);
        clearbook.claimRepayment(loanId, r);
        assertEq(clearbook.factConsumedBy(r), loanId, "repayment not bound to the first claim");

        // Registered before expectRevert: the cheatcode arms the *next* call, and
        // an inline helper call would consume it instead of the one under test.
        uint256 loanId2 = _secondLoanFor(idA);

        vm.prank(originatorOwner);
        vm.expectRevert(Clearbook.FactAlreadyUsed.selector);
        clearbook.claimRepayment(loanId2, r);
    }
}
