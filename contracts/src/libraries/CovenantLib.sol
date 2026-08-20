// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IEvidenceVault} from "../interfaces/IEvidenceVault.sol";

/// @title CovenantLib
/// @notice The covenant predicates, isolated so that the exact rule being enforced
///         is auditable in one place and cannot drift from the published text.
///
/// @dev What a `CIRCULAR_REPAYMENT` breach does and does not mean:
///
///      A breach establishes that two verified transfers occurred in a specific
///      relationship. It does NOT establish intent, control of either address by
///      any person or entity, the existence of an off-chain loan, or any violation
///      of law. It establishes that the originator's own published rule was not met.
library CovenantLib {
    /// @notice Covenant identifiers (BUILD.md §4.1), used as a bitmask.
    uint16 internal constant CIRCULAR_REPAYMENT = 0x01;
    uint16 internal constant EVIDENCE_UNIQUENESS = 0x02;
    uint16 internal constant EVIDENCE_FIRST = 0x03;

    // Conditions 3-9 of the predicate. Conditions 1-2 (status, challenge window)
    // and 10-11 (fact distinctness) depend on loan state rather than on the facts
    // themselves and are enforced by the caller.
    error ChainMismatch();
    error TokenMismatch();
    error NotTheSamePayer();
    error FundingNotFromBoundTreasury();
    error FundingBelowRepayment();
    error FundingNotBefore();
    error OutsideWindow();

    /// @notice Reverts unless `funding` and `repayment` together breach CIRCULAR_REPAYMENT.
    /// @dev Pure: takes the resolved treasury ownership rather than reading storage,
    ///      so the predicate can be reasoned about and tested in isolation.
    /// @param funding The transfer alleged to have funded the payer.
    /// @param repayment The transfer the originator claimed as repayment.
    /// @param fundingFromOriginatorId Originator that bound `funding.from`, or 0 if unbound.
    /// @param loanOriginatorId Originator that owns the loan under challenge.
    /// @param circularWindow Maximum source-chain block distance, published by the originator.
    function requireCircularRepaymentBreach(
        IEvidenceVault.TransferFact memory funding,
        IEvidenceVault.TransferFact memory repayment,
        uint256 fundingFromOriginatorId,
        uint256 loanOriginatorId,
        uint32 circularWindow
    ) internal pure {
        // 3. Both legs must come from the same source chain, or the comparison is
        //    meaningless: a Sepolia transfer must not be presented against a mainnet one.
        if (funding.chainKey != repayment.chainKey) revert ChainMismatch();

        // 4. Same asset. Anyone can deploy a worthless ERC-20 that emits Transfer.
        if (funding.token != repayment.token) revert TokenMismatch();

        // 5. The address that repaid is the address that was funded. This is the
        //    link that makes the flow circular rather than merely adjacent.
        if (funding.to != repayment.from) revert NotTheSamePayer();

        // 6. The funding leg must originate from a treasury this originator bound
        //    by signature. Funding from an address it never bound is outside the
        //    covenant by construction — an honest limit, documented, not a gap.
        if (fundingFromOriginatorId != loanOriginatorId) revert FundingNotFromBoundTreasury();

        // 7. The payer received at least what it paid back, so the repayment could
        //    have been sourced entirely from the originator's own money.
        if (funding.amount < repayment.amount) revert FundingBelowRepayment();

        // 8. Ordering: funding cannot come after the repayment it supposedly funded.
        //    Equality is allowed — same-block circularity is still circularity.
        if (funding.blockHeight > repayment.blockHeight) revert FundingNotBefore();

        // 9. Within the window the originator published and made immutable.
        if (repayment.blockHeight - funding.blockHeight > circularWindow) revert OutsideWindow();
    }
}
