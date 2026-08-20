// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {INativeQueryVerifier} from "@gluwa/usc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {TestBase} from "./helpers/TestBase.sol";
import {EvidenceVault} from "../src/EvidenceVault.sol";
import {IEvidenceVault} from "../src/interfaces/IEvidenceVault.sol";

/// @notice Unit tests for the evidence registry. Every test states setup, action
///         and the exact property being asserted.
contract EvidenceVaultTest is TestBase {
    /// setup: a valid ERC-20 Transfer proof.
    /// action: submit it.
    /// expected: fields are decoded from the receipt, not taken from the caller.
    function test_submit_decodes_from_receipt() public {
        bytes32 factId = _submitTransfer(100, 7, token, treasury, borrower, PRINCIPAL);

        IEvidenceVault.TransferFact memory fact = vault.getFact(factId);
        assertEq(fact.chainKey, CHAIN_KEY, "chainKey");
        assertEq(fact.blockHeight, 100, "blockHeight");
        assertEq(fact.txIndex, 7, "txIndex comes from the precompile");
        assertEq(fact.logIndex, 0, "logIndex");
        assertEq(fact.token, token, "token from log.address_");
        assertEq(fact.from, treasury, "from from topics[1]");
        assertEq(fact.to, borrower, "to from topics[2]");
        assertEq(fact.amount, PRINCIPAL, "amount from data");
        assertEq(fact.submitter, address(this), "submitter is msg.sender");
        assertEq(fact.ccBlock, uint64(block.number), "ccBlock is chain context");
        assertTrue(vault.exists(factId), "exists set");
    }

    /// T1. setup: a fact already ingested.
    /// action: submit the identical bundle again.
    /// expected: no-op returning the same id, WITHOUT re-verifying and without a second event.
    function test_replay_is_noop() public {
        bytes32 first = _submitTransfer(100, 7, token, treasury, borrower, PRINCIPAL);
        uint256 callsAfterFirst = verifier.verifyAndEmitCalls();

        bytes32 second = _submitTransfer(100, 7, token, treasury, borrower, PRINCIPAL);

        assertEq(second, first, "same factId returned");
        assertEq(verifier.verifyAndEmitCalls(), callsAfterFirst, "dedupe precedes verification");
    }

    /// T2. setup: one transaction carrying three Transfer logs.
    /// action: ingest each log index.
    /// expected: three distinct facts. A transaction-level key would have collided.
    function test_multi_log_distinct_facts() public {
        RawLog[] memory logs = new RawLog[](3);
        logs[0] = _transferLog(token, treasury, borrower, 1e6);
        logs[1] = _transferLog(otherToken, borrower, payer, 2e6);
        logs[2] = _transferLog(token, payer, treasury, 3e6);

        bytes32 f0 = _submitFact(CHAIN_KEY, 200, 4, 0, 1, logs);
        bytes32 f1 = _submitFact(CHAIN_KEY, 200, 4, 1, 1, logs);
        bytes32 f2 = _submitFact(CHAIN_KEY, 200, 4, 2, 1, logs);

        assertTrue(f0 != f1 && f1 != f2 && f0 != f2, "distinct factIds");
        assertEq(vault.getFact(f0).amount, 1e6, "log 0 amount");
        assertEq(vault.getFact(f1).amount, 2e6, "log 1 amount");
        assertEq(vault.getFact(f2).amount, 3e6, "log 2 amount");
        assertEq(vault.getFact(f1).token, otherToken, "log 1 token");
    }

    /// T3. setup: the precompile rejects the proof.
    /// action: submit.
    /// expected: ProofRejected, nothing stored.
    function test_forged_bytes_rejected() public {
        verifier.setVerifyResult(false);
        verifier.setTxIndex(1);
        (bytes32 root, INativeQueryVerifier.MerkleProofEntry[] memory sibs, bytes32[] memory roots) =
            _emptyProofArgs();
        bytes memory txBytes = _buildTxBytes(2, 1, _singleLog(_transferLog(token, treasury, borrower, PRINCIPAL)));

        vm.expectRevert(EvidenceVault.ProofRejected.selector);
        vault.submitTransferFact(CHAIN_KEY, 100, txBytes, root, sibs, bytes32(0), roots, 0);

        assertFalse(vault.exists(vault.computeFactId(CHAIN_KEY, 100, 1, 0)), "nothing stored");
    }

    /// K-007. setup: the precompile REVERTS instead of returning false.
    /// action: submit.
    /// expected: the transaction still terminates and stores nothing. Fail closed
    ///           under either failure mode, since the real one is still unverified.
    function test_verifier_revert_also_fails_closed() public {
        verifier.setShouldRevert(true);
        verifier.setTxIndex(1);
        (bytes32 root, INativeQueryVerifier.MerkleProofEntry[] memory sibs, bytes32[] memory roots) =
            _emptyProofArgs();
        bytes memory txBytes = _buildTxBytes(2, 1, _singleLog(_transferLog(token, treasury, borrower, PRINCIPAL)));

        vm.expectRevert();
        vault.submitTransferFact(CHAIN_KEY, 100, txBytes, root, sibs, bytes32(0), roots, 0);

        assertFalse(vault.exists(vault.computeFactId(CHAIN_KEY, 100, 1, 0)), "nothing stored");
    }

    /// T4. setup: an included but REVERTED source transaction.
    /// action: submit.
    /// expected: SourceTxReverted. The precompile does not check this; we must.
    function test_reverted_tx_rejected() public {
        verifier.setTxIndex(1);
        (bytes32 root, INativeQueryVerifier.MerkleProofEntry[] memory sibs, bytes32[] memory roots) =
            _emptyProofArgs();
        bytes memory txBytes = _buildTxBytes(2, 0, _singleLog(_transferLog(token, treasury, borrower, PRINCIPAL)));

        vm.expectRevert(EvidenceVault.SourceTxReverted.selector);
        vault.submitTransferFact(CHAIN_KEY, 100, txBytes, root, sibs, bytes32(0), roots, 0);
    }

    /// T7. setup: an ERC-721 Transfer, which shares topic0 but has four topics.
    /// action: submit.
    /// expected: NotATransferLog. Otherwise topics[3] would be read as an amount.
    function test_erc721_rejected() public {
        verifier.setTxIndex(1);
        (bytes32 root, INativeQueryVerifier.MerkleProofEntry[] memory sibs, bytes32[] memory roots) =
            _emptyProofArgs();
        bytes memory txBytes = _buildTxBytes(2, 1, _singleLog(_erc721Log(token, treasury, borrower, 42)));

        vm.expectRevert(EvidenceVault.NotATransferLog.selector);
        vault.submitTransferFact(CHAIN_KEY, 100, txBytes, root, sibs, bytes32(0), roots, 0);
    }

    /// setup: a log whose topic0 is not Transfer.
    /// action: submit.
    /// expected: NotATransferLog.
    function test_non_transfer_topic_rejected() public {
        verifier.setTxIndex(1);
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = keccak256("Approval(address,address,uint256)");
        topics[1] = bytes32(uint256(uint160(treasury)));
        topics[2] = bytes32(uint256(uint160(borrower)));
        RawLog[] memory logs = _singleLog(RawLog({addr: token, topics: topics, data: abi.encode(PRINCIPAL)}));

        (bytes32 root, INativeQueryVerifier.MerkleProofEntry[] memory sibs, bytes32[] memory roots) =
            _emptyProofArgs();
        vm.expectRevert(EvidenceVault.NotATransferLog.selector);
        vault.submitTransferFact(CHAIN_KEY, 100, _buildTxBytes(2, 1, logs), root, sibs, bytes32(0), roots, 0);
    }

    /// setup: a Transfer-shaped log whose data is not exactly 32 bytes.
    /// action: submit.
    /// expected: MalformedTransferLog.
    function test_malformed_transfer_log_rejected() public {
        verifier.setTxIndex(1);
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = TRANSFER_TOPIC;
        topics[1] = bytes32(uint256(uint160(treasury)));
        topics[2] = bytes32(uint256(uint160(borrower)));
        RawLog[] memory logs = _singleLog(RawLog({addr: token, topics: topics, data: hex"1234"}));

        (bytes32 root, INativeQueryVerifier.MerkleProofEntry[] memory sibs, bytes32[] memory roots) =
            _emptyProofArgs();
        vm.expectRevert(EvidenceVault.MalformedTransferLog.selector);
        vault.submitTransferFact(CHAIN_KEY, 100, _buildTxBytes(2, 1, logs), root, sibs, bytes32(0), roots, 0);
    }

    /// T8. setup: a receipt with one log.
    /// action: submit logIndex 5.
    /// expected: LogIndexOutOfRange, checked before any array access.
    function test_log_index_oob() public {
        verifier.setTxIndex(1);
        (bytes32 root, INativeQueryVerifier.MerkleProofEntry[] memory sibs, bytes32[] memory roots) =
            _emptyProofArgs();
        bytes memory txBytes = _buildTxBytes(2, 1, _singleLog(_transferLog(token, treasury, borrower, PRINCIPAL)));

        vm.expectRevert(EvidenceVault.LogIndexOutOfRange.selector);
        vault.submitTransferFact(CHAIN_KEY, 100, txBytes, root, sibs, bytes32(0), roots, 5);
    }

    /// setup: an encoding declaring transaction type 5.
    /// action: submit.
    /// expected: UnsupportedTxType. The decoder supports 0-4 only.
    function test_unsupported_tx_type_rejected() public {
        verifier.setTxIndex(1);
        (bytes32 root, INativeQueryVerifier.MerkleProofEntry[] memory sibs, bytes32[] memory roots) =
            _emptyProofArgs();
        bytes memory txBytes = _buildTxBytes(5, 1, _singleLog(_transferLog(token, treasury, borrower, PRINCIPAL)));

        vm.expectRevert(EvidenceVault.UnsupportedTxType.selector);
        vault.submitTransferFact(CHAIN_KEY, 100, txBytes, root, sibs, bytes32(0), roots, 0);
    }

    /// setup: transaction types 3 and 4 carry four chunks, not three.
    /// action: submit each.
    /// expected: the receipt is still located correctly (index 3).
    function test_type3_and_type4_receipt_located() public {
        RawLog[] memory logs = _singleLog(_transferLog(token, treasury, borrower, PRINCIPAL));
        (bytes32 root, INativeQueryVerifier.MerkleProofEntry[] memory sibs, bytes32[] memory roots) =
            _emptyProofArgs();

        verifier.setTxIndex(3);
        bytes32 f3 =
            vault.submitTransferFact(CHAIN_KEY, 300, _buildTxBytes(3, 1, logs), root, sibs, bytes32(0), roots, 0);
        verifier.setTxIndex(4);
        bytes32 f4 =
            vault.submitTransferFact(CHAIN_KEY, 400, _buildTxBytes(4, 1, logs), root, sibs, bytes32(0), roots, 0);

        assertEq(vault.getFact(f3).amount, PRINCIPAL, "type 3 decoded");
        assertEq(vault.getFact(f4).amount, PRINCIPAL, "type 4 decoded");
    }

    /// T5. setup: the same transaction position on two different chains.
    /// action: ingest both.
    /// expected: distinct factIds — chainKey is part of identity.
    function test_cross_chain_distinct_facts() public {
        bytes32 a = _submitTransfer(100, 1, token, treasury, borrower, PRINCIPAL);

        RawLog[] memory logs = _singleLog(_transferLog(token, treasury, borrower, PRINCIPAL));
        bytes32 b = _submitFact(3, 100, 1, 0, 1, logs);

        assertTrue(a != b, "chainKey changes factId");
        assertEq(vault.getFact(b).chainKey, 3, "second fact is on chainKey 3");
    }

    /// T26. setup: a pathological receipt with many logs.
    /// action: ingest the last one.
    /// expected: decoding succeeds and picks the right log.
    function test_large_receipt() public {
        uint256 n = 60;
        RawLog[] memory logs = new RawLog[](n);
        for (uint256 i; i < n; ++i) {
            logs[i] = _transferLog(token, treasury, borrower, (i + 1) * 1e6);
        }

        bytes32 factId = _submitFact(CHAIN_KEY, 500, 2, uint32(n - 1), 1, logs);
        assertEq(vault.getFact(factId).amount, n * 1e6, "last log decoded correctly");
    }

    /// setup: nothing ingested.
    /// action: read an unknown fact.
    /// expected: UnknownFact rather than a zeroed struct.
    function test_getFact_unknown_reverts() public {
        vm.expectRevert(EvidenceVault.UnknownFact.selector);
        vault.getFact(keccak256("nope"));
    }

    /// setup: none.
    /// action: compute ids.
    /// expected: deterministic, and every component changes the result.
    function test_computeFactId_is_deterministic_in_all_components() public view {
        bytes32 base = vault.computeFactId(1, 2, 3, 4);
        assertEq(base, vault.computeFactId(1, 2, 3, 4), "deterministic");
        assertTrue(base != vault.computeFactId(2, 2, 3, 4), "chainKey matters");
        assertTrue(base != vault.computeFactId(1, 3, 3, 4), "blockHeight matters");
        assertTrue(base != vault.computeFactId(1, 2, 4, 4), "txIndex matters");
        assertTrue(base != vault.computeFactId(1, 2, 3, 5), "logIndex matters");
    }

    /// setup: mock resolves a known txIndex.
    /// action: call the passthrough helper.
    /// expected: it forwards to the precompile.
    function test_calculateTxIndex_passthrough() public {
        verifier.setTxIndex(9);
        INativeQueryVerifier.MerkleProof memory proof = INativeQueryVerifier.MerkleProof({
            root: bytes32(0),
            siblings: new INativeQueryVerifier.MerkleProofEntry[](0)
        });
        assertEq(vault.calculateTxIndex(proof), 9, "forwarded");
    }

    /// setup: none.
    /// action: read the constant.
    /// expected: matches keccak256("Transfer(address,address,uint256)").
    function test_transfer_topic_constant() public view {
        assertEq(vault.ERC20_TRANSFER_TOPIC(), keccak256("Transfer(address,address,uint256)"), "topic0");
    }

    /// setup: submission from an arbitrary address.
    /// action: submit.
    /// expected: succeeds — the vault is permissionless by design.
    function test_submission_is_permissionless() public {
        // Set the mock up first: vm.prank applies only to the very next call, and
        // it must land on submitTransferFact, not on the mock's setter.
        verifier.setTxIndex(1);
        (bytes32 root, INativeQueryVerifier.MerkleProofEntry[] memory sibs, bytes32[] memory roots) =
            _emptyProofArgs();
        bytes memory txBytes = _buildTxBytes(2, 1, _singleLog(_transferLog(token, treasury, borrower, PRINCIPAL)));

        vm.prank(challenger);
        bytes32 factId = vault.submitTransferFact(CHAIN_KEY, 100, txBytes, root, sibs, bytes32(0), roots, 0);

        assertEq(vault.getFact(factId).submitter, challenger, "anyone may submit");
    }
}
