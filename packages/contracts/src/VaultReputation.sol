// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IEAS} from "./interfaces/IEAS.sol";

/// @title VaultReputation
/// @notice Per-MCP-server reputation accounting fed by EAS attestations from an allowlisted attester.
/// Score = 1000 - min(1000, blockRateBps), where blockRateBps = (blocks * 10000) / max(1, scans * 10).
/// Rolling 30-day window via 4 weekly buckets; buckets older than 4 weeks decay on the next write.
contract VaultReputation {
    uint256 public constant WEEK = 7 days;
    uint16 public constant MAX_SCORE = 1000;
    uint8 public constant BUCKETS = 4;

    struct ServerStats {
        uint32 totalScans;
        uint32 totalBlocks;
        uint16 lastScore;
        uint64 lastUpdateWeek;
        uint32[BUCKETS] scans;
        uint32[BUCKETS] blocks;
    }

    IEAS public immutable eas;
    bytes32 public immutable scanReceiptSchema;
    bytes32 public immutable threatRecordSchema;

    address public owner;
    mapping(address => bool) public allowlistedAttester;
    mapping(bytes32 => bool) public submitted;

    mapping(bytes32 => ServerStats) private serversByKey;
    mapping(bytes32 => string) private urlByKey;
    mapping(bytes32 => bool) private known;
    bytes32[] private knownServers;

    event ReceiptSubmitted(bytes32 indexed uid, bytes32 indexed serverKey, string mcpServerUrl, uint8 verdict);
    event ThreatSubmitted(bytes32 indexed uid, bytes32 indexed serverKey, string mcpServerUrl, string category);
    event AttesterAllowlistUpdated(address indexed attester, bool allowed);
    event OwnerTransferred(address indexed prev, address indexed next);

    error NotOwner();
    error AlreadySubmitted();
    error InvalidSchema();
    error AttestationRevoked();
    error AttesterNotAllowed();
    error InvalidVerdict();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(IEAS _eas, bytes32 _scanReceiptSchema, bytes32 _threatRecordSchema, address _owner) {
        if (address(_eas) == address(0) || _owner == address(0)) revert ZeroAddress();
        eas = _eas;
        scanReceiptSchema = _scanReceiptSchema;
        threatRecordSchema = _threatRecordSchema;
        owner = _owner;
    }

    // --- Admin ---------------------------------------------------------------

    function setAttesterAllowlist(address attester, bool allowed) external onlyOwner {
        if (attester == address(0)) revert ZeroAddress();
        allowlistedAttester[attester] = allowed;
        emit AttesterAllowlistUpdated(attester, allowed);
    }

    function transferOwner(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit OwnerTransferred(owner, next);
        owner = next;
    }

    // --- Submissions ---------------------------------------------------------

    /// @notice Submit a ScanReceipt attestation UID. Caller pays gas.
    /// Each ScanReceipt counts as one scan toward reputation; verdict field is recorded for transparency
    /// but does NOT bump the block counter — that's the ThreatRecord's job.
    function submitReceipt(bytes32 uid) external {
        IEAS.Attestation memory att = _loadAndAuthorize(uid, scanReceiptSchema);

        (
            ,
            string memory mcpServerUrl,
            ,
            uint8 verdict,
            ,
            ,
            ,
        ) = abi.decode(att.data, (bytes32, string, string, uint8, uint8, uint8, string[], uint64));
        if (verdict > 2) revert InvalidVerdict();

        bytes32 key = keccak256(bytes(mcpServerUrl));
        _ensureKnown(key, mcpServerUrl);
        _recordScan(key);

        emit ReceiptSubmitted(uid, key, mcpServerUrl, verdict);
    }

    /// @notice Submit a ThreatRecord attestation UID. Caller pays gas.
    /// Each ThreatRecord counts as one block. To survive batch-ordering issues from multiAttest
    /// (threat may arrive before its referenced ScanReceipt), this function performs an idempotent
    /// scan-counter backfill:
    ///   - refUID == 0 (orphan threat, no linked receipt): bump the scan counter unconditionally.
    ///   - refUID != 0 and not yet seen:                   backfill +1 scan and lock the refUID so a
    ///                                                     future submitReceipt(refUID) is a no-op
    ///                                                     (reverts AlreadySubmitted).
    ///   - refUID != 0 and already seen:                   scan already counted, no backfill.
    /// Together with the proxy emitting 1:1 receipt:threat pairs, this preserves the invariant
    /// totalBlocks <= totalScans regardless of submit order.
    function submitThreat(bytes32 uid) external {
        IEAS.Attestation memory att = _loadAndAuthorize(uid, threatRecordSchema);

        (
            ,
            string memory mcpServerUrl,
            ,
            string memory category,
            bytes32 receiptRefUID,
        ) = abi.decode(att.data, (bytes32, string, string, string, bytes32, uint64));

        bytes32 key = keccak256(bytes(mcpServerUrl));
        _ensureKnown(key, mcpServerUrl);

        if (receiptRefUID == bytes32(0) || !submitted[receiptRefUID]) {
            if (receiptRefUID != bytes32(0)) submitted[receiptRefUID] = true;
            _recordScan(key);
        }

        _recordBlock(key);

        emit ThreatSubmitted(uid, key, mcpServerUrl, category);
    }

    function _loadAndAuthorize(bytes32 uid, bytes32 expectedSchema) internal returns (IEAS.Attestation memory att) {
        if (submitted[uid]) revert AlreadySubmitted();
        att = eas.getAttestation(uid);
        if (att.schema != expectedSchema) revert InvalidSchema();
        if (att.revocationTime != 0) revert AttestationRevoked();
        if (!allowlistedAttester[att.attester]) revert AttesterNotAllowed();
        submitted[uid] = true;
    }

    // --- Reputation core -----------------------------------------------------

    function _ensureKnown(bytes32 key, string memory url) internal {
        if (!known[key]) {
            known[key] = true;
            urlByKey[key] = url;
            knownServers.push(key);
        }
    }

    function _recordScan(bytes32 key) internal {
        ServerStats storage s = serversByKey[key];
        uint64 currentWeek = uint64(block.timestamp / WEEK);
        _decayBuckets(s, currentWeek);
        unchecked {
            s.scans[0] += 1;
            s.totalScans += 1;
        }
        s.lastScore = _computeScore(s);
    }

    function _recordBlock(bytes32 key) internal {
        ServerStats storage s = serversByKey[key];
        uint64 currentWeek = uint64(block.timestamp / WEEK);
        _decayBuckets(s, currentWeek);
        unchecked {
            s.blocks[0] += 1;
            s.totalBlocks += 1;
        }
        s.lastScore = _computeScore(s);
    }

    function _decayBuckets(ServerStats storage s, uint64 currentWeek) internal {
        // First-ever write — initialize week pointer, no shift needed.
        if (s.totalScans == 0 && s.totalBlocks == 0) {
            s.lastUpdateWeek = currentWeek;
            return;
        }
        if (currentWeek < s.lastUpdateWeek) return; // clock skew safety
        uint64 diff = currentWeek - s.lastUpdateWeek;
        if (diff == 0) return;
        if (diff >= BUCKETS) {
            for (uint256 i = 0; i < BUCKETS; i++) {
                s.scans[i] = 0;
                s.blocks[i] = 0;
            }
            s.lastUpdateWeek = currentWeek;
            return;
        }
        // Shift right by `diff` slots: new[i] = old[i - diff] for i >= diff; clear i < diff.
        for (uint256 i = BUCKETS - 1; i >= diff; i--) {
            s.scans[i] = s.scans[i - diff];
            s.blocks[i] = s.blocks[i - diff];
            if (i == diff) break; // prevent uint underflow on next decrement
        }
        for (uint256 i = 0; i < diff; i++) {
            s.scans[i] = 0;
            s.blocks[i] = 0;
        }
        s.lastUpdateWeek = currentWeek;
    }

    function _computeScore(ServerStats storage s) internal view returns (uint16) {
        uint64 currentWeek = uint64(block.timestamp / WEEK);
        if (currentWeek < s.lastUpdateWeek) return MAX_SCORE;
        uint64 diff = currentWeek - s.lastUpdateWeek;
        if (diff >= BUCKETS) return MAX_SCORE;

        uint256 limit = uint256(BUCKETS) - uint256(diff);
        uint256 scans;
        uint256 blocks_;
        for (uint256 i = 0; i < limit; i++) {
            scans += s.scans[i];
            blocks_ += s.blocks[i];
        }
        if (scans == 0) return MAX_SCORE;
        uint256 penalty = (blocks_ * 10000) / (scans * 10);
        if (penalty >= MAX_SCORE) return 0;
        return uint16(MAX_SCORE - penalty);
    }

    // --- Views ---------------------------------------------------------------

    function getScore(string calldata mcpServerUrl)
        external
        view
        returns (uint16 score, uint32 totalScans, uint32 totalBlocks)
    {
        bytes32 key = keccak256(bytes(mcpServerUrl));
        ServerStats storage s = serversByKey[key];
        score = _computeScore(s);
        totalScans = s.totalScans;
        totalBlocks = s.totalBlocks;
    }

    function getLeaderboard(uint8 n) external view returns (string[] memory urls, uint16[] memory scores) {
        uint256 len = knownServers.length;
        uint256 take = n > len ? len : n;
        urls = new string[](take);
        scores = new uint16[](take);
        if (take == 0) return (urls, scores);

        // Copy keys + scan counts to memory, partial selection sort by totalScans desc.
        bytes32[] memory keys = new bytes32[](len);
        uint32[] memory counts = new uint32[](len);
        for (uint256 i = 0; i < len; i++) {
            keys[i] = knownServers[i];
            counts[i] = serversByKey[keys[i]].totalScans;
        }
        for (uint256 i = 0; i < take; i++) {
            uint256 maxIdx = i;
            for (uint256 j = i + 1; j < len; j++) {
                if (counts[j] > counts[maxIdx]) maxIdx = j;
            }
            if (maxIdx != i) {
                (keys[i], keys[maxIdx]) = (keys[maxIdx], keys[i]);
                (counts[i], counts[maxIdx]) = (counts[maxIdx], counts[i]);
            }
            urls[i] = urlByKey[keys[i]];
            scores[i] = _computeScore(serversByKey[keys[i]]);
        }
    }

    function knownServerCount() external view returns (uint256) {
        return knownServers.length;
    }
}
