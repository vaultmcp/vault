// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {TradeReceiptLedger} from "../src/TradeReceiptLedger.sol";

contract TradeReceiptLedgerTest is Test {
    TradeReceiptLedger ledger;
    address owner = address(0xA11CE);
    address attester = address(0xBEEF);
    address stranger = address(0xDEAD);

    bytes32 constant RH = bytes32(uint256(0x1234));

    function setUp() public {
        vm.prank(owner);
        ledger = new TradeReceiptLedger(owner);
    }

    function _submit(address who, string memory tool, uint8 decision) internal {
        vm.prank(who);
        ledger.submitTradeReceipt("stdio:rh-trade", tool, decision, 1, RH, "WETH", 4, 1_700_000_000);
    }

    function test_ownerIsAttesterByDefault() public view {
        assertTrue(ledger.allowlistedAttester(owner));
        assertEq(ledger.owner(), owner);
    }

    function test_onlyAllowlistedAttesterCanSubmit() public {
        vm.prank(stranger);
        vm.expectRevert(TradeReceiptLedger.AttesterNotAllowed.selector);
        ledger.submitTradeReceipt("s", "execute_swap", 0, 0, RH, "WETH", 4, 1);
    }

    function test_ownerCanAllowlistAndRevoke() public {
        vm.prank(owner);
        ledger.setAttesterAllowlist(attester, true);
        _submit(attester, "execute_swap", 0); // does not revert

        vm.prank(owner);
        ledger.setAttesterAllowlist(attester, false);
        vm.prank(attester);
        vm.expectRevert(TradeReceiptLedger.AttesterNotAllowed.selector);
        ledger.submitTradeReceipt("s", "execute_swap", 0, 0, RH, "WETH", 4, 1);
    }

    function test_rejectsInvalidDecision() public {
        vm.prank(owner);
        vm.expectRevert(TradeReceiptLedger.InvalidDecision.selector);
        ledger.submitTradeReceipt("s", "execute_swap", 3, 0, RH, "WETH", 4, 1);
    }

    function test_accumulatesPerToolStatsAndScore() public {
        _submit(owner, "execute_swap", 0); // cleared
        _submit(owner, "execute_swap", 0); // cleared
        _submit(owner, "execute_swap", 2); // blocked
        _submit(owner, "execute_swap", 2); // blocked

        (uint64 total, uint64 cleared, uint64 warned, uint64 blocked, uint16 score) =
            ledger.getToolStats("execute_swap");
        assertEq(total, 4);
        assertEq(cleared, 2);
        assertEq(warned, 0);
        assertEq(blocked, 2);
        assertEq(score, 500); // 1000 * (1 - 2/4)
    }

    function test_cleanToolScoresPerfect_unknownToolToo() public {
        _submit(owner, "get_quote", 0);
        (,,,, uint16 score) = ledger.getToolStats("get_quote");
        assertEq(score, 1000);

        // A tool nobody has touched reads as a perfect, empty record.
        (uint64 total,,,, uint16 s2) = ledger.getToolStats("never_seen");
        assertEq(total, 0);
        assertEq(s2, 1000);
    }

    function test_fullyBlockedToolScoresZero() public {
        _submit(owner, "approve", 2);
        _submit(owner, "approve", 2);
        (,,,, uint16 score) = ledger.getToolStats("approve");
        assertEq(score, 0);
    }

    function test_enumeratesDistinctTools() public {
        _submit(owner, "execute_swap", 0);
        _submit(owner, "execute_swap", 2);
        _submit(owner, "approve", 2);
        assertEq(ledger.toolCount(), 2);

        (string memory name0,,,) = ledger.toolAt(0);
        (string memory name1,,,) = ledger.toolAt(1);
        assertEq(name0, "execute_swap");
        assertEq(name1, "approve");
    }

    function test_emitsTradeReceiptEvent() public {
        vm.expectEmit(true, true, false, true);
        emit TradeReceiptLedger.TradeReceipt(
            keccak256(bytes("execute_swap")),
            owner,
            "stdio:rh-trade",
            "execute_swap",
            2,
            1,
            RH,
            "WETH",
            4,
            1_700_000_000
        );
        _submit(owner, "execute_swap", 2);
    }

    function test_transferOwner() public {
        vm.prank(owner);
        ledger.transferOwner(attester);
        assertEq(ledger.owner(), attester);
        vm.prank(attester);
        ledger.setAttesterAllowlist(stranger, true); // new owner can admin
    }
}
