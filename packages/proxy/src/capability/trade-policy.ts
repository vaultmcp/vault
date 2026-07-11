/// Trade policy — a specialized, high-precision capability gate for on-chain trading
/// tools (swaps, approvals). Where the generic capability gate (gate.ts) blocks any
/// sensitive tool whose args merely overlap tainted content, this gate understands
/// trade semantics: it extracts the recipient/spender and approval amount from the
/// call and applies money-movement policy — recipient allowlist, taint on the
/// recipient specifically, and unlimited-approval blocking.
///
/// It reuses the same GateDecision shape as decideCapability, so both gates flow
/// through one block/warn/audit/telemetry path in the transports (see mergeDecisions).

import type { GateDecision } from './gate.js';
import type { TaintStore } from './taint.js';

export interface TradePolicyConfig {
  enabled: boolean;
  mode: 'block' | 'warn';
  /** Lowercased addresses a swap recipient / approval spender may be. Empty = allow any. */
  recipientAllowlist: Set<string>;
  /** Tool-name patterns that denote a swap / transfer action. */
  swapPatterns: RegExp[];
  /** Tool-name patterns that denote an approval / allowance action. */
  approvePatterns: RegExp[];
  /** Argument keys that carry the recipient/spender address. */
  recipientKeys: string[];
  /** Argument keys that carry a swap/approval amount. */
  amountKeys: string[];
  /** Approvals at or above this are treated as unlimited. */
  maxApproval: bigint;
  /** Per-trade value ceiling: a swap whose amount is at or above this is blocked. null = no cap. */
  maxTradeValue: bigint | null;
  /** Max allowed (non-blocked) trade actions per window. null = no velocity limit. */
  maxPerWindow: number | null;
  /** Velocity window in milliseconds. */
  windowMs: number;
}

const ALLOW: GateDecision = { action: 'allow' };

/// Per-session velocity tracker: records the timestamps of ALLOWED trade actions so
/// the policy can enforce a max-per-window rate limit (anti drain-loop). Created once
/// per proxied session in the transport, alongside the taint store.
export class TradeRateState {
  private times: number[] = [];

  /// Count allowed trades within [now - windowMs, now], pruning older entries.
  countInWindow(now: number, windowMs: number): number {
    const cutoff = now - windowMs;
    this.times = this.times.filter((t) => t >= cutoff);
    return this.times.length;
  }

  record(now: number): void {
    this.times.push(now);
  }
}

type TradeKind = 'swap' | 'approve' | null;

function classifyTrade(name: string, config: TradePolicyConfig): TradeKind {
  if (config.approvePatterns.some((re) => re.test(name))) return 'approve';
  if (config.swapPatterns.some((re) => re.test(name))) return 'swap';
  return null;
}

/// Pull the first present recipient-like value out of the call arguments.
function extractRecipient(args: unknown, keys: string[]): string | null {
  if (args == null || typeof args !== 'object') return null;
  const obj = args as Record<string, unknown>;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function extractAmount(args: unknown, keys: string[]): bigint | null {
  if (args == null || typeof args !== 'object') return null;
  const obj = args as Record<string, unknown>;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return BigInt(Math.trunc(v));
    if (typeof v === 'string' && /^\d+$/.test(v.trim())) {
      try {
        return BigInt(v.trim());
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

/// Decide whether a trading tool call may proceed. Returns `allow` for anything that
/// isn't a recognized trade action (so it composes cleanly with the generic gate).
///
/// `rate` (optional) enables the per-window velocity limit; it must be the same
/// per-session instance across calls. `now` is injectable for testing.
export function decideTradePolicy(
  toolName: string,
  args: unknown,
  taint: TaintStore,
  config: TradePolicyConfig,
  rate?: TradeRateState,
  now: number = Date.now(),
): GateDecision {
  if (!config.enabled || !toolName) return ALLOW;

  const kind = classifyTrade(toolName, config);
  if (kind === null) return ALLOW;

  const reasons: string[] = [];
  let taintSources: GateDecision['taintSources'];

  // Recipient-based checks — only when the call carries a recipient/spender.
  const recipient = extractRecipient(args, config.recipientKeys);
  const allowlisted = recipient ? config.recipientAllowlist.has(recipient.toLowerCase()) : false;
  if (recipient && !allowlisted) {
    if (config.recipientAllowlist.size > 0) {
      reasons.push(`recipient '${recipient}' is not in the trade allowlist`);
    }
    // Taint on the recipient specifically: did this address come from tool output?
    const overlap = Math.min(recipient.length, 20);
    const hits = taint.matches(recipient, overlap);
    if (hits.length > 0) {
      reasons.push(`recipient was sourced from an untrusted tool response (tainted)`);
      taintSources = hits;
    }
  }

  // Amount-based checks.
  const amount = extractAmount(args, config.amountKeys);
  if (kind === 'approve' && !allowlisted && amount !== null && amount >= config.maxApproval) {
    reasons.push(`unlimited approval (${amount}) to a non-allowlisted spender`);
  }
  if (kind === 'swap' && config.maxTradeValue !== null && amount !== null && amount >= config.maxTradeValue) {
    reasons.push(`trade amount ${amount} is at or above the per-trade cap ${config.maxTradeValue}`);
  }

  // A hard block wins immediately — the funds never move, so it does NOT count toward
  // the velocity budget.
  if (reasons.length > 0) {
    return {
      action: config.mode,
      reason: `trade-policy: ${reasons.join('; ')}`,
      matchedPattern: `trade:${kind}`,
      taintSources,
    };
  }

  // Velocity: rate-limit the trades that would otherwise be allowed (anti drain-loop).
  if (config.maxPerWindow !== null && rate) {
    const count = rate.countInWindow(now, config.windowMs);
    if (count >= config.maxPerWindow) {
      return {
        action: config.mode,
        reason:
          `trade-policy: trade rate limit exceeded ` +
          `(${count} in ${config.windowMs}ms, max ${config.maxPerWindow})`,
        matchedPattern: `trade:${kind}`,
      };
    }
    rate.record(now);
  }

  return ALLOW;
}
