/// Guarded-trade receipts + public tool reputation.
///
/// Every trading action the trade guard evaluates can produce a signed, verifiable
/// on-chain receipt: "Vault saw execute_swap on this server, and cleared / blocked it for
/// this reason." Receipts are privacy-preserving — the recipient is hashed and the amount
/// is bucketed to an order of magnitude — so they prove what happened without publishing
/// the wallet or the size.
///
/// From a stream of receipts you can compute a public safety record per tool
/// (aggregateToolReputation): how many trades a tool has had cleared vs blocked, and why.
/// That turns "trust me, I run Vault" into something anyone can verify.
///
/// Split, as everywhere else: buildTradeReceipt / aggregateToolReputation are pure and
/// fully tested; emitTradeReceipt is the thin wiring the transports call.

import { createHash } from 'node:crypto';
import type { Hex } from 'viem';
import type { GateDecision } from '../capability/gate.js';
import {
  classifyTrade,
  extractRecipient,
  extractToken,
  extractAmount,
  type TradePolicyConfig,
} from '../capability/trade-policy.js';
import type { AttestationItem, TradeReceiptPayload } from './types.js';

const ZERO_BYTES32 = `0x${'0'.repeat(64)}` as Hex;

/// Decision codes for the on-chain receipt.
export const DECISION = { cleared: 0, warned: 1, blocked: 2 } as const;

/// Why a trade was blocked, as a compact on-chain enum. 0 means it was cleared.
export const REASON_CODES = {
  cleared: 0,
  allowlist: 1,
  tainted: 2,
  unlimitedApproval: 3,
  perTradeCap: 4,
  perWindowCap: 5,
  perTokenCap: 6,
  velocity: 7,
  circuitBreaker: 8,
  marketClosed: 9,
  other: 255,
} as const;

/// Map a trade-policy reason string to a stable code. Substring match against the phrases
/// decideTradePolicy emits.
export function classifyReason(action: GateDecision['action'], reason?: string): number {
  if (action === 'allow') return REASON_CODES.cleared;
  const r = (reason ?? '').toLowerCase();
  if (r.includes('not in the trade allowlist')) return REASON_CODES.allowlist;
  if (r.includes('tainted')) return REASON_CODES.tainted;
  if (r.includes('unlimited approval')) return REASON_CODES.unlimitedApproval;
  if (r.includes('per-trade cap')) return REASON_CODES.perTradeCap;
  if (r.includes('per-window cap')) return REASON_CODES.perWindowCap;
  if (r.includes('per-token cap')) return REASON_CODES.perTokenCap;
  if (r.includes('rate limit')) return REASON_CODES.velocity;
  if (r.includes('circuit breaker')) return REASON_CODES.circuitBreaker;
  if (r.includes('market is closed')) return REASON_CODES.marketClosed;
  return REASON_CODES.other;
}

function hashRecipient(recipient: string | null): Hex {
  if (!recipient) return ZERO_BYTES32;
  return `0x${createHash('sha256').update(recipient.toLowerCase()).digest('hex')}` as Hex;
}

/// Order-of-magnitude bucket of a trade amount — digit count, clamped to a uint8. 0 means
/// unknown. This keeps the exact size off-chain while still letting the reputation record
/// distinguish dust from whales.
function bucketValue(amount: bigint | null): number {
  if (amount == null || amount <= 0n) return 0;
  return Math.min(254, amount.toString().length);
}

export interface TradeReceiptInput {
  mcpServerUrl: string;
  toolName: string;
  action: GateDecision['action'];
  reason?: string;
  recipient?: string | null;
  token?: string;
  amount?: bigint | null;
  now: number; // ms
}

/// Pure: turn a guarded-trade outcome into a signable receipt payload.
export function buildTradeReceipt(input: TradeReceiptInput): TradeReceiptPayload {
  const decision =
    input.action === 'block' ? DECISION.blocked : input.action === 'warn' ? DECISION.warned : DECISION.cleared;
  return {
    mcpServerUrl: input.mcpServerUrl,
    toolName: input.toolName,
    decision,
    reasonCode: classifyReason(input.action, input.reason),
    recipientHash: hashRecipient(input.recipient ?? null),
    token: input.token ?? '',
    valueBucket: bucketValue(input.amount ?? null),
    guardedAt: BigInt(Math.floor(input.now / 1000)),
  };
}

// ---------------------------------------------------------------------------
// Emit seam — called by the transports after a trade decision.
// ---------------------------------------------------------------------------

export interface TradeReceiptSink {
  enqueueTradeReceipt(item: Extract<AttestationItem, { kind: 'trade' }>): void;
}

let receiptSeq = 0;

/// Thin wiring: if this call is a trade action, build a receipt and enqueue it. No-op for
/// non-trade tools. `sink` is the attestation client (or any enqueue target, for tests).
export function emitTradeReceipt(
  sink: TradeReceiptSink,
  tradeConfig: TradePolicyConfig,
  mcpServerUrl: string,
  toolName: string,
  args: unknown,
  decision: GateDecision,
  now: number = Date.now(),
): boolean {
  if (classifyTrade(toolName, tradeConfig) === null) return false;
  const payload = buildTradeReceipt({
    mcpServerUrl,
    toolName,
    action: decision.action,
    reason: decision.reason,
    recipient: extractRecipient(args, tradeConfig.recipientKeys),
    token: extractToken(args, tradeConfig.tokenKeys),
    amount: extractAmount(args, tradeConfig.amountKeys),
    now,
  });
  sink.enqueueTradeReceipt({ kind: 'trade', payload, localId: `trade-${now}-${receiptSeq++}` });
  return true;
}

// ---------------------------------------------------------------------------
// Reputation — pure aggregation over a receipt stream.
// ---------------------------------------------------------------------------

export interface ToolReputation {
  toolName: string;
  total: number;
  cleared: number;
  warned: number;
  blocked: number;
  /** blocked / total, 0..1. */
  blockRate: number;
  /** 0..1000, mirrors the VaultReputation on-chain model: 1000 * (1 - blockRate). */
  score: number;
  /** Most common block reason code (REASON_CODES), or null if nothing was blocked. */
  topBlockReason: number | null;
}

export interface ReceiptLike {
  toolName: string;
  decision: number;
  reasonCode: number;
}

/// Pure: fold a stream of trade receipts into a per-tool safety record.
export function aggregateToolReputation(receipts: ReceiptLike[]): ToolReputation[] {
  const byTool = new Map<
    string,
    { total: number; cleared: number; warned: number; blocked: number; reasons: Map<number, number> }
  >();

  for (const r of receipts) {
    let t = byTool.get(r.toolName);
    if (!t) {
      t = { total: 0, cleared: 0, warned: 0, blocked: 0, reasons: new Map() };
      byTool.set(r.toolName, t);
    }
    t.total += 1;
    if (r.decision === DECISION.blocked) {
      t.blocked += 1;
      t.reasons.set(r.reasonCode, (t.reasons.get(r.reasonCode) ?? 0) + 1);
    } else if (r.decision === DECISION.warned) {
      t.warned += 1;
    } else {
      t.cleared += 1;
    }
  }

  const out: ToolReputation[] = [];
  for (const [toolName, t] of byTool) {
    const blockRate = t.total > 0 ? t.blocked / t.total : 0;
    let topBlockReason: number | null = null;
    let best = -1;
    for (const [code, count] of t.reasons) {
      if (count > best) {
        best = count;
        topBlockReason = code;
      }
    }
    out.push({
      toolName,
      total: t.total,
      cleared: t.cleared,
      warned: t.warned,
      blocked: t.blocked,
      blockRate,
      score: Math.round(1000 * (1 - blockRate)),
      topBlockReason,
    });
  }
  // Busiest tools first.
  out.sort((a, b) => b.total - a.total);
  return out;
}
