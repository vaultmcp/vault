// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {VaultReputation} from "../src/VaultReputation.sol";
import {IEAS} from "../src/interfaces/IEAS.sol";
import {MockEAS} from "./mocks/MockEAS.sol";

contract VaultReputationTest is Test {
    VaultReputation internal rep;
    MockEAS internal eas;

    bytes32 internal constant SCAN_SCHEMA = keccak256("scan-receipt-schema");
    bytes32 internal constant THREAT_SCHEMA = keccak256("threat-record-schema");

    address internal constant OWNER = address(0xA110);
    address internal constant ATTESTER = address(0xBEEF);
    address internal constant STRANGER = address(0xDEAD);

    string internal constant SERVER_A = "stdio:filesystem";
    string internal constant SERVER_B = "https://mcp.example.com";

    function setUp() public {
        eas = new MockEAS();
        rep = new VaultReputation(IEAS(address(eas)), SCAN_SCHEMA, THREAT_SCHEMA, OWNER);
        vm.prank(OWNER);
        rep.setAttesterAllowlist(ATTESTER, true);
        // Anchor the clock at a non-zero week so decay math is exercised.
        vm.warp(100 weeks);
    }

    // --- helpers -------------------------------------------------------------

    function _encodeReceipt(string memory url, uint8 verdict) internal pure returns (bytes memory) {
        string[] memory patterns = new string[](0);
        return abi.encode(
            bytes32(uint256(0xC0FFEE)), // contentHash
            url,
            "read_file",
            verdict,
            uint8(95),
            uint8(0x07),
            patterns,
            uint64(1715000000)
        );
    }

    function _encodeThreat(string memory url, string memory category) internal pure returns (bytes memory) {
        return abi.encode(
            bytes32(uint256(0xC0FFEE)),
            url,
            "read_file",
            category,
            bytes32(uint256(0xDEADBEEF)),
            uint64(1715000000)
        );
    }

    function _mintReceipt(bytes32 uid, string memory url, uint8 verdict, address attester) internal {
        IEAS.Attestation memory a;
        a.uid = uid;
        a.schema = SCAN_SCHEMA;
        a.attester = attester;
        a.data = _encodeReceipt(url, verdict);
        eas.setAttestation(uid, a);
    }

    function _mintThreat(bytes32 uid, string memory url, string memory category, address attester) internal {
        IEAS.Attestation memory a;
        a.uid = uid;
        a.schema = THREAT_SCHEMA;
        a.attester = attester;
        a.data = _encodeThreat(url, category);
        eas.setAttestation(uid, a);
    }

    function _submitNScans(string memory url, uint256 n, uint256 startNonce) internal {
        for (uint256 i = 0; i < n; i++) {
            bytes32 uid = keccak256(abi.encode("scan", url, startNonce + i));
            _mintReceipt(uid, url, 0, ATTESTER);
            rep.submitReceipt(uid);
        }
    }

    /// @dev Submits N malicious (ScanReceipt + ThreatRecord) pairs in receipt-first order.
    /// Each pair contributes +1 scan and +1 block via real attestations.
    function _submitNPairs(string memory url, uint256 n, uint256 startNonce) internal {
        for (uint256 i = 0; i < n; i++) {
            _submitMaliciousPair(url, startNonce + i, false);
        }
    }

    // --- score formula ------------------------------------------------------

    function test_initialScoreIs1000() public view {
        (uint16 score, uint32 scans, uint32 blocks_) = rep.getScore(SERVER_A);
        assertEq(score, 1000);
        assertEq(scans, 0);
        assertEq(blocks_, 0);
    }

    function test_singleCleanScan_score1000() public {
        _submitNScans(SERVER_A, 1, 0);
        (uint16 score,,) = rep.getScore(SERVER_A);
        assertEq(score, 1000);
    }

    function test_100scans_1block_score990() public {
        _submitNScans(SERVER_A, 99, 0);
        _submitNPairs(SERVER_A, 1, 100);
        (uint16 score, uint32 scans, uint32 blocks_) = rep.getScore(SERVER_A);
        assertEq(scans, 100);
        assertEq(blocks_, 1);
        // (1 * 10000) / (100 * 10) = 10 → score 990
        assertEq(score, 990);
    }

    function test_100scans_10blocks_score900() public {
        _submitNScans(SERVER_A, 90, 0);
        _submitNPairs(SERVER_A, 10, 100);
        (uint16 score, uint32 scans, uint32 blocks_) = rep.getScore(SERVER_A);
        assertEq(scans, 100);
        assertEq(blocks_, 10);
        // penalty = (10 * 10000) / (100 * 10) = 100 → score 900
        assertEq(score, 900);
    }

    function test_100scans_100blocks_score0() public {
        _submitNPairs(SERVER_A, 100, 0);
        (uint16 score, uint32 scans, uint32 blocks_) = rep.getScore(SERVER_A);
        assertEq(scans, 100);
        assertEq(blocks_, 100);
        // penalty = (100 * 10000) / 1000 = 1000 → clamped to 0
        assertEq(score, 0);
    }

    function test_singleBlockThenManyClean_recovers() public {
        _submitNScans(SERVER_A, 9, 0);
        _submitNPairs(SERVER_A, 1, 100);
        (uint16 score1, uint32 scans1, uint32 blocks1) = rep.getScore(SERVER_A);
        assertEq(scans1, 10);
        assertEq(blocks1, 1);
        // 10 scans, 1 block → penalty (1*10000)/(10*10) = 100 → score 900
        assertEq(score1, 900);

        // Many clean scans dilute the block rate.
        _submitNScans(SERVER_A, 990, 200);
        (uint16 score2, uint32 scans2,) = rep.getScore(SERVER_A);
        assertEq(scans2, 1000);
        // 1000 scans, 1 block → penalty 1 → score 999
        assertEq(score2, 999);
    }

    // --- bucket decay -------------------------------------------------------

    function test_bucketDecay_oldDataDropsAfter4Weeks() public {
        _submitNPairs(SERVER_A, 100, 0);
        (uint16 score1,,) = rep.getScore(SERVER_A);
        assertEq(score1, 0);

        // Jump forward >4 weeks — rolling score should reset toward MAX as buckets decay.
        vm.warp(block.timestamp + 5 weeks);
        (uint16 score2, uint32 scans, uint32 blocks_) = rep.getScore(SERVER_A);
        assertEq(score2, 1000);
        // Lifetime totals are unchanged.
        assertEq(scans, 100);
        assertEq(blocks_, 100);
    }

    function test_bucketShift_partialAge() public {
        _submitNPairs(SERVER_A, 50, 0);
        // Move forward 2 weeks — old buckets shift, last30d still covers them.
        vm.warp(block.timestamp + 2 weeks);
        _submitNScans(SERVER_A, 50, 1000);
        // 100 scans in last 30d, 50 blocks → penalty 500 → score 500
        (uint16 score, uint32 scans, uint32 blocks_) = rep.getScore(SERVER_A);
        assertEq(scans, 100);
        assertEq(blocks_, 50);
        assertEq(score, 500);
    }

    // --- replay protection / authz ------------------------------------------

    function test_replayProtection_receipt() public {
        bytes32 uid = keccak256("dup-receipt");
        _mintReceipt(uid, SERVER_A, 0, ATTESTER);
        rep.submitReceipt(uid);
        vm.expectRevert(VaultReputation.AlreadySubmitted.selector);
        rep.submitReceipt(uid);
    }

    function test_replayProtection_threat() public {
        bytes32 uid = keccak256("dup-threat");
        _mintThreat(uid, SERVER_A, "exfiltration", ATTESTER);
        rep.submitThreat(uid);
        vm.expectRevert(VaultReputation.AlreadySubmitted.selector);
        rep.submitThreat(uid);
    }

    function test_invalidSchema_reverts() public {
        bytes32 uid = keccak256("wrong-schema");
        IEAS.Attestation memory a;
        a.uid = uid;
        a.schema = keccak256("some-other-schema");
        a.attester = ATTESTER;
        a.data = _encodeReceipt(SERVER_A, 0);
        eas.setAttestation(uid, a);

        vm.expectRevert(VaultReputation.InvalidSchema.selector);
        rep.submitReceipt(uid);
    }

    function test_revokedAttestation_reverts() public {
        bytes32 uid = keccak256("revoked");
        _mintReceipt(uid, SERVER_A, 0, ATTESTER);
        eas.setRevoked(uid, uint64(block.timestamp));
        vm.expectRevert(VaultReputation.AttestationRevoked.selector);
        rep.submitReceipt(uid);
    }

    function test_nonAllowlistedAttester_reverts() public {
        bytes32 uid = keccak256("not-allowed");
        _mintReceipt(uid, SERVER_A, 0, STRANGER);
        vm.expectRevert(VaultReputation.AttesterNotAllowed.selector);
        rep.submitReceipt(uid);
    }

    function test_setAttesterAllowlist_onlyOwner() public {
        vm.prank(STRANGER);
        vm.expectRevert(VaultReputation.NotOwner.selector);
        rep.setAttesterAllowlist(STRANGER, true);
    }

    // --- leaderboard --------------------------------------------------------

    function test_leaderboard_ordersByTotalScansDesc() public {
        _submitNScans(SERVER_A, 5, 0);
        _submitNScans(SERVER_B, 12, 0);
        string memory serverC = "stdio:notion";
        _submitNScans(serverC, 8, 0);

        (string[] memory urls, uint16[] memory scores) = rep.getLeaderboard(3);
        assertEq(urls.length, 3);
        assertEq(urls[0], SERVER_B);
        assertEq(urls[1], serverC);
        assertEq(urls[2], SERVER_A);
        assertEq(scores[0], 1000);
        assertEq(scores[1], 1000);
        assertEq(scores[2], 1000);
    }

    function test_leaderboard_returnsEmptyWhenNoServers() public view {
        (string[] memory urls, uint16[] memory scores) = rep.getLeaderboard(10);
        assertEq(urls.length, 0);
        assertEq(scores.length, 0);
    }

    function test_leaderboard_truncatesToKnownServers() public {
        _submitNScans(SERVER_A, 1, 0);
        (string[] memory urls,) = rep.getLeaderboard(10);
        assertEq(urls.length, 1);
        assertEq(urls[0], SERVER_A);
    }

    // --- gas snapshots ------------------------------------------------------

    function test_gas_submitReceipt() public {
        // Warm a server first so we measure the steady-state path (no first-write SSTORE inflation).
        _submitNScans(SERVER_A, 1, 0);

        bytes32 uid = keccak256(abi.encode("scan-gas", SERVER_A));
        _mintReceipt(uid, SERVER_A, 0, ATTESTER);
        uint256 gasBefore = gasleft();
        rep.submitReceipt(uid);
        uint256 used = gasBefore - gasleft();
        emit log_named_uint("submitReceipt gas (warm)", used);
        assertLt(used, 100_000, "submitReceipt > 100k gas");
    }

    function test_gas_submitThreat_noBackfill() public {
        // Warm storage slots before measuring (a fresh server's first write inflates gas).
        _submitNScans(SERVER_A, 1, 0);
        _submitMaliciousPair(SERVER_A, 999, false);

        bytes32 refUid = keccak256(abi.encode("scan-paired", SERVER_A));
        _mintReceipt(refUid, SERVER_A, 2, ATTESTER);
        rep.submitReceipt(refUid);

        bytes32 threatUid = keccak256(abi.encode("threat-gas-no-backfill", SERVER_A));
        IEAS.Attestation memory a;
        a.uid = threatUid;
        a.schema = THREAT_SCHEMA;
        a.attester = ATTESTER;
        a.data = abi.encode(
            bytes32(uint256(0xC0FFEE)),
            SERVER_A,
            "read_file",
            "exfiltration",
            refUid, // refUID already submitted → no backfill path
            uint64(1715000000)
        );
        eas.setAttestation(threatUid, a);

        uint256 gasBefore = gasleft();
        rep.submitThreat(threatUid);
        uint256 used = gasBefore - gasleft();
        emit log_named_uint("submitThreat gas (no backfill)", used);
        assertLt(used, 120_000, "submitThreat (no backfill) > 120k gas");
    }

    function test_gas_submitThreat_withBackfill() public {
        // Warm the server first, then submit a threat whose refUID has NOT been submitted yet.
        _submitNScans(SERVER_A, 1, 0);
        _submitMaliciousPair(SERVER_A, 999, false);

        bytes32 refUid = keccak256(abi.encode("scan-future", SERVER_A));
        bytes32 threatUid = keccak256(abi.encode("threat-gas-backfill", SERVER_A));
        IEAS.Attestation memory a;
        a.uid = threatUid;
        a.schema = THREAT_SCHEMA;
        a.attester = ATTESTER;
        a.data = abi.encode(
            bytes32(uint256(0xC0FFEE)),
            SERVER_A,
            "read_file",
            "exfiltration",
            refUid, // refUID unseen → backfill path
            uint64(1715000000)
        );
        eas.setAttestation(threatUid, a);

        uint256 gasBefore = gasleft();
        rep.submitThreat(threatUid);
        uint256 used = gasBefore - gasleft();
        emit log_named_uint("submitThreat gas (with backfill)", used);
        assertLt(used, 120_000, "submitThreat (with backfill) > 120k gas");
    }

    // --- backfill / invariant -----------------------------------------------

    /// Builds and submits a malicious-verdict pair. If `threatFirst`, submits the ThreatRecord
    /// before the ScanReceipt (covers the multiAttest reorder case).
    function _submitMaliciousPair(string memory url, uint256 nonce, bool threatFirst) internal {
        bytes32 receiptUid = keccak256(abi.encode("receipt-pair", url, nonce));
        bytes32 threatUid = keccak256(abi.encode("threat-pair", url, nonce));

        _mintReceipt(receiptUid, url, 2, ATTESTER);

        IEAS.Attestation memory a;
        a.uid = threatUid;
        a.schema = THREAT_SCHEMA;
        a.attester = ATTESTER;
        a.data = abi.encode(
            bytes32(uint256(0xC0FFEE)),
            url,
            "read_file",
            "instruction_override",
            receiptUid,
            uint64(1715000000)
        );
        eas.setAttestation(threatUid, a);

        if (threatFirst) {
            rep.submitThreat(threatUid);
            // The receipt was backfilled by the threat — re-submitting it now must revert.
            vm.expectRevert(VaultReputation.AlreadySubmitted.selector);
            rep.submitReceipt(receiptUid);
        } else {
            rep.submitReceipt(receiptUid);
            rep.submitThreat(threatUid);
        }
    }

    function _assertInvariant(string memory url) internal view {
        (, uint32 scans, uint32 blocks_) = rep.getScore(url);
        assertLe(blocks_, scans, "invariant: totalBlocks <= totalScans");
    }

    function test_invariant_receiptThenThreat() public {
        _submitMaliciousPair(SERVER_A, 0, false);
        (uint16 score, uint32 scans, uint32 blocks_) = rep.getScore(SERVER_A);
        assertEq(scans, 1);
        assertEq(blocks_, 1);
        assertEq(score, 0); // 100% block rate on one scan
        _assertInvariant(SERVER_A);
    }

    function test_invariant_threatThenReceipt_backfills() public {
        _submitMaliciousPair(SERVER_A, 0, true);
        (uint16 score, uint32 scans, uint32 blocks_) = rep.getScore(SERVER_A);
        assertEq(scans, 1, "backfill should have counted the scan");
        assertEq(blocks_, 1);
        assertEq(score, 0);
        _assertInvariant(SERVER_A);
    }

    function test_invariant_orphanThreat_bumpsScan() public {
        // Threat with refUID == 0 — proxy emitted a threat without a paired receipt.
        bytes32 threatUid = keccak256("orphan-threat");
        IEAS.Attestation memory a;
        a.uid = threatUid;
        a.schema = THREAT_SCHEMA;
        a.attester = ATTESTER;
        a.data = abi.encode(
            bytes32(uint256(0xC0FFEE)),
            SERVER_A,
            "read_file",
            "instruction_override",
            bytes32(0),
            uint64(1715000000)
        );
        eas.setAttestation(threatUid, a);

        rep.submitThreat(threatUid);
        (, uint32 scans, uint32 blocks_) = rep.getScore(SERVER_A);
        assertEq(scans, 1);
        assertEq(blocks_, 1);
        _assertInvariant(SERVER_A);
    }

    function test_invariant_mixedFlows_singleServer() public {
        // 10 clean scans, then 3 receipt-first malicious pairs, then 2 threat-first pairs.
        _submitNScans(SERVER_A, 10, 0);
        _assertInvariant(SERVER_A);
        for (uint256 i = 0; i < 3; i++) {
            _submitMaliciousPair(SERVER_A, 100 + i, false);
            _assertInvariant(SERVER_A);
        }
        for (uint256 i = 0; i < 2; i++) {
            _submitMaliciousPair(SERVER_A, 200 + i, true);
            _assertInvariant(SERVER_A);
        }
        (, uint32 scans, uint32 blocks_) = rep.getScore(SERVER_A);
        assertEq(scans, 15); // 10 clean + 5 paired
        assertEq(blocks_, 5);
    }

    function test_invariant_mixedFlows_multipleServers() public {
        _submitNScans(SERVER_A, 5, 0);
        _submitNScans(SERVER_B, 3, 0);
        _submitMaliciousPair(SERVER_A, 1, true);
        _submitMaliciousPair(SERVER_B, 1, false);
        _submitMaliciousPair(SERVER_A, 2, false);
        _assertInvariant(SERVER_A);
        _assertInvariant(SERVER_B);

        (, uint32 aScans, uint32 aBlocks) = rep.getScore(SERVER_A);
        (, uint32 bScans, uint32 bBlocks) = rep.getScore(SERVER_B);
        assertEq(aScans, 7);
        assertEq(aBlocks, 2);
        assertEq(bScans, 4);
        assertEq(bBlocks, 1);
    }

    function test_backfilledReceipt_revertsOnLaterSubmit() public {
        // Threat first, refUID points to a receipt we never directly submitted.
        bytes32 refUid = keccak256("future-receipt");
        bytes32 threatUid = keccak256("backfill-then-receipt");
        IEAS.Attestation memory threat;
        threat.uid = threatUid;
        threat.schema = THREAT_SCHEMA;
        threat.attester = ATTESTER;
        threat.data = abi.encode(
            bytes32(uint256(0xC0FFEE)),
            SERVER_A,
            "read_file",
            "instruction_override",
            refUid,
            uint64(1715000000)
        );
        eas.setAttestation(threatUid, threat);
        rep.submitThreat(threatUid);

        // Now the ScanReceipt itself shows up — must revert because backfill already counted it.
        _mintReceipt(refUid, SERVER_A, 2, ATTESTER);
        vm.expectRevert(VaultReputation.AlreadySubmitted.selector);
        rep.submitReceipt(refUid);

        // Still invariant-clean.
        _assertInvariant(SERVER_A);
    }
}
