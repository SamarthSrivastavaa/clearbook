// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {INativeQueryVerifier} from "@gluwa/usc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

import {EvidenceVault} from "../src/EvidenceVault.sol";
import {Clearbook} from "../src/Clearbook.sol";
import {IEvidenceVault} from "../src/interfaces/IEvidenceVault.sol";

/// @title DeployLib
/// @notice Deployment guards, factored out so they can be unit-tested. A guard that
///         only runs during a live broadcast is a guard nobody has ever verified.
library DeployLib {
    /// @notice The real Block Prover precompile.
    address internal constant BLOCK_PROVER_PRECOMPILE = 0x0000000000000000000000000000000000000FD2;

    error WrongNetwork(uint256 chainId);
    error NotTheRealPrecompile(address verifier);
    error ProtocolSinkUnset();

    /// @notice Creditcoin mainnet / testnet / devnet, per NativeQueryVerifierLib.
    function isCreditcoinChainId(uint256 chainId) internal pure returns (bool) {
        return chainId == 102030 || chainId == 102031 || chainId == 102032;
    }

    /// @notice BUILD.md Phase 3: production MUST wire the real precompile, never a
    ///         test double. The vault's injectable verifier is a testability seam;
    ///         a seam that reaches production is a vulnerability, not a convenience.
    function assertProductionConfig(uint256 chainId, address verifier, address protocolSink) internal pure {
        if (!isCreditcoinChainId(chainId)) revert WrongNetwork(chainId);
        if (verifier != BLOCK_PROVER_PRECOMPILE) revert NotTheRealPrecompile(verifier);
        if (protocolSink == address(0)) revert ProtocolSinkUnset();
    }
}

/// @notice Deploys EvidenceVault and Clearbook to a Creditcoin network.
/// @dev Run:
///        forge script script/Deploy.s.sol:Deploy \
///          --rpc-url $CREDITCOIN_RPC_URL --broadcast
///      Requires CC_DEPLOYER_PRIVATE_KEY and PROTOCOL_SINK_ADDRESS in the environment.
contract Deploy is Script {
    function run() external returns (EvidenceVault vault, Clearbook clearbook) {
        uint256 deployerKey = vm.envUint("CC_DEPLOYER_PRIVATE_KEY");
        address protocolSink = vm.envAddress("PROTOCOL_SINK_ADDRESS");
        address verifier = DeployLib.BLOCK_PROVER_PRECOMPILE;

        // Refuse to broadcast against the wrong chain or a fake verifier.
        DeployLib.assertProductionConfig(block.chainid, verifier, protocolSink);

        console.log("chainId       ", block.chainid);
        console.log("deployer      ", vm.addr(deployerKey));
        console.log("verifier      ", verifier);
        console.log("protocolSink  ", protocolSink);

        vm.startBroadcast(deployerKey);
        vault = new EvidenceVault(INativeQueryVerifier(verifier));
        clearbook = new Clearbook(IEvidenceVault(address(vault)), protocolSink);
        vm.stopBroadcast();

        // Post-conditions: what was actually deployed, read back from the chain.
        require(address(vault.VERIFIER()) == verifier, "vault wired to the wrong verifier");
        require(address(clearbook.VAULT()) == address(vault), "clearbook wired to the wrong vault");
        require(clearbook.PROTOCOL_SINK() == protocolSink, "clearbook wired to the wrong sink");

        console.log("EVIDENCE_VAULT_ADDRESS", address(vault));
        console.log("CLEARBOOK_ADDRESS     ", address(clearbook));
    }
}
