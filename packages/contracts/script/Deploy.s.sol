// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {VaultReputation} from "../src/VaultReputation.sol";
import {IEAS} from "../src/interfaces/IEAS.sol";

/// @notice Deploy VaultReputation. Reads EAS address, schema UIDs, and owner from env vars
/// so the same script works on Base mainnet (8453) and Base Sepolia (84532).
///
/// Usage (Sepolia):
///   VAULT_EAS_ADDRESS=0x4200000000000000000000000000000000000021 \
///   VAULT_SCAN_RECEIPT_SCHEMA=0x... \
///   VAULT_THREAT_RECORD_SCHEMA=0x... \
///   VAULT_OWNER=0x... \
///   forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify
contract Deploy is Script {
    function run() external returns (VaultReputation rep) {
        address easAddr = vm.envAddress("VAULT_EAS_ADDRESS");
        bytes32 scanSchema = vm.envBytes32("VAULT_SCAN_RECEIPT_SCHEMA");
        bytes32 threatSchema = vm.envBytes32("VAULT_THREAT_RECORD_SCHEMA");
        address owner = vm.envAddress("VAULT_OWNER");

        require(easAddr != address(0), "VAULT_EAS_ADDRESS not set");
        require(owner != address(0), "VAULT_OWNER not set");
        require(scanSchema != bytes32(0), "VAULT_SCAN_RECEIPT_SCHEMA not set");
        require(threatSchema != bytes32(0), "VAULT_THREAT_RECORD_SCHEMA not set");

        vm.startBroadcast();
        rep = new VaultReputation(IEAS(easAddr), scanSchema, threatSchema, owner);
        vm.stopBroadcast();

        console2.log("VaultReputation deployed at:", address(rep));
        console2.log("EAS:", easAddr);
        console2.log("Owner:", owner);
    }
}
