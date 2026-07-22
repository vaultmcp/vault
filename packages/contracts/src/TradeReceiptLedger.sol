// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title TradeReceiptLedger
/// @notice Robinhood-Chain-native ledger for Vault guarded-trade receipts. Unlike
/// VaultReputation (which reads EAS attestations on Base), this is self-contained: RH Chain
/// is an Arbitrum Orbit L2 with no EAS deployment, so an allowlisted attester submits trade
/// receipts directly here. Each receipt is emitted as an event (for off-chain indexing / the
/// live feed) and folded into a per-tool safety record.
///
/// Privacy: the recipient is passed pre-hashed and the amount pre-bucketed by the proxy, so
/// no wallet address or exact trade size is ever written on-chain.
///
/// Score = MAX_SCORE - min(MAX_SCORE, blockRateBps), blockRateBps = (blocked * 10000) /
/// max(1, total * 10) — i.e. 1000 * (1 - blocked/total). Matches VaultReputation's model.
contract TradeReceiptLedger {
    uint16 public constant MAX_SCORE = 1000;

    // Decision codes, matching the proxy: 0 cleared, 1 warned, 2 blocked.
    uint8 public constant CLEARED = 0;
    uint8 public constant WARNED = 1;
    uint8 public constant BLOCKED = 2;

    struct ToolStats {
        uint64 total;
        uint64 cleared;
        uint64 warned;
        uint64 blocked;
    }

    address public owner;
    mapping(address => bool) public allowlistedAttester;

    mapping(bytes32 => ToolStats) private statsByTool;
    mapping(bytes32 => string) private nameByTool;
    mapping(bytes32 => bool) private knownTool;
    bytes32[] private tools;

    event TradeReceipt(
        bytes32 indexed toolKey,
        address indexed attester,
        string mcpServerUrl,
        string toolName,
        uint8 decision,
        uint8 reasonCode,
        bytes32 recipientHash,
        string token,
        uint8 valueBucket,
        uint64 guardedAt
    );
    event AttesterAllowlistUpdated(address indexed attester, bool allowed);
    event OwnerTransferred(address indexed prev, address indexed next);

    error NotOwner();
    error AttesterNotAllowed();
    error InvalidDecision();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _owner) {
        if (_owner == address(0)) revert ZeroAddress();
        owner = _owner;
        allowlistedAttester[_owner] = true;
        emit OwnerTransferred(address(0), _owner);
        emit AttesterAllowlistUpdated(_owner, true);
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

    // --- Submit --------------------------------------------------------------

    /// @notice Record one guarded-trade receipt. Callable only by an allowlisted attester.
    function submitTradeReceipt(
        string calldata mcpServerUrl,
        string calldata toolName,
        uint8 decision,
        uint8 reasonCode,
        bytes32 recipientHash,
        string calldata token,
        uint8 valueBucket,
        uint64 guardedAt
    ) external {
        if (!allowlistedAttester[msg.sender]) revert AttesterNotAllowed();
        if (decision > BLOCKED) revert InvalidDecision();

        bytes32 key = keccak256(bytes(toolName));
        if (!knownTool[key]) {
            knownTool[key] = true;
            nameByTool[key] = toolName;
            tools.push(key);
        }

        ToolStats storage s = statsByTool[key];
        unchecked {
            s.total += 1;
            if (decision == BLOCKED) s.blocked += 1;
            else if (decision == WARNED) s.warned += 1;
            else s.cleared += 1;
        }

        emit TradeReceipt(
            key, msg.sender, mcpServerUrl, toolName, decision, reasonCode, recipientHash, token, valueBucket, guardedAt
        );
    }

    // --- Views ---------------------------------------------------------------

    function scoreOf(uint64 total, uint64 blocked) public pure returns (uint16) {
        if (total == 0) return MAX_SCORE;
        uint256 blockRateBps = (uint256(blocked) * 10000) / (uint256(total) * 10);
        if (blockRateBps >= MAX_SCORE) return 0;
        return uint16(MAX_SCORE - blockRateBps);
    }

    function getToolStats(string calldata toolName)
        external
        view
        returns (uint64 total, uint64 cleared, uint64 warned, uint64 blocked, uint16 score)
    {
        ToolStats storage s = statsByTool[keccak256(bytes(toolName))];
        return (s.total, s.cleared, s.warned, s.blocked, scoreOf(s.total, s.blocked));
    }

    function toolCount() external view returns (uint256) {
        return tools.length;
    }

    /// @notice Enumerate tracked tools (for building a public leaderboard off-chain).
    function toolAt(uint256 i) external view returns (string memory toolName, uint64 total, uint64 blocked, uint16 score) {
        bytes32 key = tools[i];
        ToolStats storage s = statsByTool[key];
        return (nameByTool[key], s.total, s.blocked, scoreOf(s.total, s.blocked));
    }
}
