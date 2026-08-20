// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IEvidenceVault} from "./interfaces/IEvidenceVault.sol";
import {CovenantLib} from "./libraries/CovenantLib.sol";

/// @title Clearbook
/// @notice Evidence-bound covenant compliance for credit originators.
/// @dev No admin, no owner, no proxy, no pause. The attack surface is the product;
///      an admin key would contradict the trust model. Every parameter an
///      originator is judged against is published on-chain at registration and is
///      immutable thereafter â€” a rule you can change after publishing is not a
///      covenant.
///
///      Clearbook never moves ERC-20s. It only reads verified logs. There is no
///      `approve`, no `transferFrom`, and no token custody anywhere; the contract
///      holds only native CTC.
contract Clearbook is EIP712, ReentrancyGuard {
    enum LoanStatus {
        NONE,
        REGISTERED,
        REPAYMENT_CLAIMED,
        DELINQUENT,
        SETTLED,
        BREACHED
    }

    struct Originator {
        address owner;
        string name;
        uint256 bond;
        uint256 exposure;
        uint32 circularWindow;
        uint32 challengeWindow;
        uint64 lastClaimBlock;
        uint16 covenants;
        bool active;
    }

    struct Loan {
        uint256 originatorId;
        address token;
        address borrower;
        uint256 principal;
        uint64 maturityBlock;
        bytes32 disbursementFactId;
        bytes32 repaymentFactId;
        uint64 claimBlock;
        LoanStatus status;
    }

    // ---------------------------------------------------------------------
    // Economic parameters (BUILD.md Â§4.4). Constants, not settings: there is no
    // admin who could change them, by design.
    // ---------------------------------------------------------------------

    uint256 public constant MIN_BOND = 1 ether;
    uint256 public constant BOND_PER_LOAN = 1 ether;
    uint16 public constant SLASH_BPS = 10_000;
    uint16 public constant BOUNTY_BPS = 5_000;
    uint16 public constant REPAYMENT_BPS = 10_000;
    uint64 public constant WITHDRAW_COOLDOWN = 1200;

    uint32 public constant MIN_CIRCULAR_WINDOW = 1;
    uint32 public constant MAX_CIRCULAR_WINDOW = 50_000;
    uint32 public constant MIN_CHALLENGE_WINDOW = 1200;

    bytes32 private constant TREASURY_BINDING_TYPEHASH =
        keccak256("TreasuryBinding(uint256 originatorId,address ethAddress,uint256 nonce,uint256 chainId)");

    IEvidenceVault public immutable VAULT;
    address public immutable PROTOCOL_SINK;

    mapping(uint256 => Originator) public originators;
    mapping(uint256 => Loan) public loans;
    /// @notice Bound source-chain address => originatorId. Zero means unbound.
    mapping(address => uint256) public treasuryOwner;
    /// @notice factId => loanId. Enforces EVIDENCE_UNIQUENESS. Zero means unconsumed.
    mapping(bytes32 => uint256) public factConsumedBy;
    /// @notice Per-address binding nonce, included in the signed struct.
    mapping(address => uint256) public bindingNonce;

    /// @dev Ids start at 1: zero is the sentinel for "unbound" and "unconsumed".
    uint256 public nextOriginatorId = 1;
    uint256 public nextLoanId = 1;

    event OriginatorRegistered(
        uint256 indexed originatorId,
        address indexed owner,
        string name,
        uint256 bond,
        uint32 circularWindow,
        uint32 challengeWindow,
        uint16 covenants
    );
    event TreasuryBound(uint256 indexed originatorId, address indexed ethAddress, uint256 nonce, uint64 ccBlock);
    event BondIncreased(uint256 indexed originatorId, address indexed from, uint256 amount, uint256 newBond);
    event BondWithdrawn(uint256 indexed originatorId, address indexed to, uint256 amount, uint256 newBond);
    event LoanRegistered(
        uint256 indexed loanId,
        uint256 indexed originatorId,
        address indexed token,
        address borrower,
        uint256 principal,
        uint64 maturityBlock,
        bytes32 disbursementFactId
    );
    event RepaymentClaimed(uint256 indexed loanId, bytes32 indexed repaymentFactId, uint64 claimBlock);
    event LoanDelinquent(uint256 indexed loanId, address indexed caller, uint64 ccBlock);
    event CovenantBreached(
        uint256 indexed loanId,
        uint16 indexed covenantId,
        bytes32 fundingFactId,
        bytes32 repaymentFactId,
        address indexed challenger
    );
    event BountyPaid(uint256 indexed loanId, address indexed challenger, uint256 bounty, uint256 toSink);
    event LoanSettled(uint256 indexed loanId, uint64 ccBlock);

    error BondTooSmall();
    error BadWindow();
    error CovenantRequired();
    error BadSignature();
    error AlreadyBound();
    error NotOwner();
    error Overexposed();
    error CooldownActive();
    error TransferFailed();
    error FactMismatch();
    error TreasuryNotBound();
    error FactAlreadyUsed();
    error InsufficientBond();
    error WrongStatus();
    error AmountTooLow();
    error NotYetMature();
    error WindowClosed();
    error WindowOpen();
    error SameFact();
    error DisbursementNotFunding();
    error InactiveOriginator();

    constructor(IEvidenceVault vault, address protocolSink) EIP712("Clearbook", "1") {
        VAULT = vault;
        PROTOCOL_SINK = protocolSink;
    }

    // ---------------------------------------------------------------------
    // Originator lifecycle
    // ---------------------------------------------------------------------

    /// @notice Registers a bonded originator and publishes its covenant parameters.
    /// @dev `circularWindow` and `challengeWindow` are immutable for this originator
    ///      once set. That immutability is the point.
    function registerOriginator(string calldata name, uint32 circularWindow, uint32 challengeWindow, uint16 covenants)
        external
        payable
        returns (uint256 originatorId)
    {
        if (msg.value < MIN_BOND) revert BondTooSmall();
        if (circularWindow < MIN_CIRCULAR_WINDOW || circularWindow > MAX_CIRCULAR_WINDOW) revert BadWindow();
        if (challengeWindow < MIN_CHALLENGE_WINDOW) revert BadWindow();
        if (covenants & CovenantLib.CIRCULAR_REPAYMENT == 0) revert CovenantRequired();

        originatorId = nextOriginatorId++;
        originators[originatorId] = Originator({
            owner: msg.sender,
            name: name,
            bond: msg.value,
            exposure: 0,
            circularWindow: circularWindow,
            challengeWindow: challengeWindow,
            lastClaimBlock: 0,
            covenants: covenants,
            active: true
        });

        emit OriginatorRegistered(
            originatorId, msg.sender, name, msg.value, circularWindow, challengeWindow, covenants
        );
    }

    /// @notice Binds a source-chain treasury address by signature from that address's key.
    /// @dev This proves control of the key, and nothing more. It does not establish
    ///      that the address belongs to any person or company.
    function bindTreasury(uint256 originatorId, address ethAddress, bytes calldata signature) external {
        Originator storage orig = originators[originatorId];
        if (orig.owner != msg.sender) revert NotOwner();
        if (!orig.active) revert InactiveOriginator();
        // One address binds to at most one originator, ever.
        if (treasuryOwner[ethAddress] != 0) revert AlreadyBound();

        uint256 nonce = bindingNonce[ethAddress];
        bytes32 structHash =
            keccak256(abi.encode(TREASURY_BINDING_TYPEHASH, originatorId, ethAddress, nonce, block.chainid));
        address recovered = ECDSA.recover(_hashTypedDataV4(structHash), signature);
        if (recovered != ethAddress) revert BadSignature();

        treasuryOwner[ethAddress] = originatorId;
        bindingNonce[ethAddress] = nonce + 1;

        emit TreasuryBound(originatorId, ethAddress, nonce, uint64(block.number));
    }

    /// @notice Adds to an originator's bond. Anyone may top up.
    function topUpBond(uint256 originatorId) external payable {
        Originator storage orig = originators[originatorId];
        if (!orig.active) revert InactiveOriginator();

        orig.bond += msg.value;
        emit BondIncreased(originatorId, msg.sender, msg.value, orig.bond);
    }

    /// @notice Withdraws unencumbered bond, subject to the post-claim cooldown.
    /// @dev The cooldown is what stops an originator from claiming a repayment and
    ///      pulling its bond out before a challenger can acquire proofs.
    function withdrawBond(uint256 originatorId, uint256 amount) external nonReentrant {
        Originator storage orig = originators[originatorId];
        if (orig.owner != msg.sender) revert NotOwner();
        if (orig.bond - orig.exposure < amount) revert Overexposed();
        if (block.number <= uint256(orig.lastClaimBlock) + WITHDRAW_COOLDOWN) revert CooldownActive();

        // CEI: state first, external call last.
        orig.bond -= amount;
        emit BondWithdrawn(originatorId, msg.sender, amount, orig.bond);

        (bool sent,) = msg.sender.call{value: amount}("");
        if (!sent) revert TransferFailed();
    }

    // ---------------------------------------------------------------------
    // Loan lifecycle
    // ---------------------------------------------------------------------

    /// @notice Registers a loan whose disbursement is backed by a verified fact.
    /// @dev EVIDENCE_FIRST: no loan exists without evidence matching token,
    ///      direction, counterparty and amount.
    function registerLoan(
        uint256 originatorId,
        address token,
        address borrower,
        uint256 principal,
        uint64 maturityBlock,
        bytes32 disbursementFactId
    ) external returns (uint256 loanId) {
        Originator storage orig = originators[originatorId];
        if (orig.owner != msg.sender) revert NotOwner();
        if (!orig.active) revert InactiveOriginator();
        if (maturityBlock <= block.number) revert BadWindow();
        if (factConsumedBy[disbursementFactId] != 0) revert FactAlreadyUsed();
        if (orig.bond - orig.exposure < BOND_PER_LOAN) revert InsufficientBond();

        // Reverts UnknownFact if the evidence was never ingested.
        IEvidenceVault.TransferFact memory fact = VAULT.getFact(disbursementFactId);
        if (fact.token != token) revert FactMismatch();
        if (fact.to != borrower) revert FactMismatch();
        if (fact.amount != principal) revert FactMismatch();
        // The money must have left an address this originator bound.
        if (treasuryOwner[fact.from] != originatorId) revert TreasuryNotBound();

        loanId = nextLoanId++;
        orig.exposure += BOND_PER_LOAN;

        loans[loanId] = Loan({
            originatorId: originatorId,
            token: token,
            borrower: borrower,
            principal: principal,
            maturityBlock: maturityBlock,
            disbursementFactId: disbursementFactId,
            repaymentFactId: bytes32(0),
            claimBlock: 0,
            status: LoanStatus.REGISTERED
        });
        factConsumedBy[disbursementFactId] = loanId;

        emit LoanRegistered(loanId, originatorId, token, borrower, principal, maturityBlock, disbursementFactId);
    }

    /// @notice Claims that a verified transfer repaid a loan.
    function claimRepayment(uint256 loanId, bytes32 repaymentFactId) external {
        Loan storage loan = loans[loanId];
        Originator storage orig = originators[loan.originatorId];
        if (orig.owner != msg.sender) revert NotOwner();
        if (loan.status != LoanStatus.REGISTERED && loan.status != LoanStatus.DELINQUENT) revert WrongStatus();
        if (factConsumedBy[repaymentFactId] != 0) revert FactAlreadyUsed();

        IEvidenceVault.TransferFact memory fact = VAULT.getFact(repaymentFactId);
        if (fact.token != loan.token) revert FactMismatch();
        // The money must have arrived at an address this originator bound.
        if (treasuryOwner[fact.to] != loan.originatorId) revert FactMismatch();
        if (fact.amount < (loan.principal * REPAYMENT_BPS) / 10_000) revert AmountTooLow();

        loan.repaymentFactId = repaymentFactId;
        loan.claimBlock = uint64(block.number);
        loan.status = LoanStatus.REPAYMENT_CLAIMED;
        orig.lastClaimBlock = uint64(block.number);
        factConsumedBy[repaymentFactId] = loanId;

        emit RepaymentClaimed(loanId, repaymentFactId, uint64(block.number));
    }

    /// @notice Marks a matured, unrepaid loan delinquent. Permissionless.
    function markDelinquent(uint256 loanId) external {
        Loan storage loan = loans[loanId];
        if (loan.status != LoanStatus.REGISTERED) revert WrongStatus();
        if (block.number <= loan.maturityBlock) revert NotYetMature();

        loan.status = LoanStatus.DELINQUENT;
        emit LoanDelinquent(loanId, msg.sender, uint64(block.number));
    }

    /// @notice Settles a loan whose challenge window has closed. Permissionless.
    function finalize(uint256 loanId) external {
        Loan storage loan = loans[loanId];
        Originator storage orig = originators[loan.originatorId];
        if (loan.status != LoanStatus.REPAYMENT_CLAIMED) revert WrongStatus();
        if (block.number <= uint256(loan.claimBlock) + orig.challengeWindow) revert WindowOpen();

        loan.status = LoanStatus.SETTLED;
        orig.exposure -= BOND_PER_LOAN;

        emit LoanSettled(loanId, uint64(block.number));
    }

    // ---------------------------------------------------------------------
    // Challenge
    // ---------------------------------------------------------------------

    /// @notice Proves a CIRCULAR_REPAYMENT breach over two verified facts.
    /// @dev Permissionless, atomic and self-verifying: there is no challenger bond,
    ///      no dispute period and no arbitrator. An invalid challenge reverts and
    ///      costs the caller only gas, leaving state bit-identical.
    /// @return bounty Amount paid to the challenger.
    function challenge(uint256 loanId, bytes32 fundingFactId) external nonReentrant returns (uint256 bounty) {
        Loan storage loan = loans[loanId];
        Originator storage orig = originators[loan.originatorId];

        // 1. Only a claimed repayment can be circular.
        if (loan.status != LoanStatus.REPAYMENT_CLAIMED) revert WrongStatus();
        // 2. Within the window the originator published.
        if (block.number > uint256(loan.claimBlock) + orig.challengeWindow) revert WindowClosed();
        // 10-11. The funding leg must be a distinct fact from both of the loan's own.
        if (fundingFactId == loan.repaymentFactId) revert SameFact();
        // Closes the obvious gambit: citing the disbursement itself as the funding leg.
        if (fundingFactId == loan.disbursementFactId) revert DisbursementNotFunding();

        IEvidenceVault.TransferFact memory repayment = VAULT.getFact(loan.repaymentFactId);
        IEvidenceVault.TransferFact memory funding = VAULT.getFact(fundingFactId);

        // 3-9. Reverts with the specific condition that failed.
        CovenantLib.requireCircularRepaymentBreach(
            funding, repayment, treasuryOwner[funding.from], loan.originatorId, orig.circularWindow
        );

        // --- Breach established. All state is written before any value moves. ---
        uint256 slash = (BOND_PER_LOAN * SLASH_BPS) / 10_000;
        if (slash > orig.bond) slash = orig.bond;
        bounty = (slash * BOUNTY_BPS) / 10_000;
        uint256 toSink = slash - bounty;

        loan.status = LoanStatus.BREACHED;
        orig.bond -= slash;
        orig.exposure -= BOND_PER_LOAN;

        emit CovenantBreached(loanId, CovenantLib.CIRCULAR_REPAYMENT, fundingFactId, loan.repaymentFactId, msg.sender);
        emit BountyPaid(loanId, msg.sender, bounty, toSink);

        // CEI: state above is final. A reverting payee reverts the whole call and
        // the loan simply remains challengeable.
        if (bounty > 0) {
            (bool paidChallenger,) = msg.sender.call{value: bounty}("");
            if (!paidChallenger) revert TransferFailed();
        }
        if (toSink > 0) {
            (bool paidSink,) = PROTOCOL_SINK.call{value: toSink}("");
            if (!paidSink) revert TransferFailed();
        }
    }
}
