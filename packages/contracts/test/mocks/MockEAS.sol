// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IEAS} from "../../src/interfaces/IEAS.sol";

contract MockEAS is IEAS {
    mapping(bytes32 => Attestation) public store;

    function setAttestation(bytes32 uid, Attestation memory att) external {
        att.uid = uid;
        store[uid] = att;
    }

    function setRevoked(bytes32 uid, uint64 at) external {
        store[uid].revocationTime = at;
    }

    function getAttestation(bytes32 uid) external view returns (Attestation memory) {
        return store[uid];
    }
}
