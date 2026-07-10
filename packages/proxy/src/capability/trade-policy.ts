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
  /** Argument keys that carry an approval amount. */
  amountKeys: string[];
  /** Approvals at or above this are treated as unlimited. */
  maxApproval: bigint;
}

const ALLOW: GateDecision = { action: 'allow' };

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

function extractApprovalAmount(args: unknown, keys: string[]): bigint | null {
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
export function decideTradePolicy(
  toolName: string,
  args: unknown,
  taint: TaintStore,
  config: TradePolicyConfig,
): GateDecision {
  if (!config.enabled || !toolName) return ALLOW;

  const kind = classifyTrade(toolName, config);
  if (kind === null) return ALLOW;

  const recipient = extractRecipient(args, config.recipientKeys);
  if (!recipient) return ALLOW; // nothing address-shaped to police
  const recipientLc = recipient.toLowerCase();
  const allowlisted = config.recipientAllowlist.has(recipientLc);

  const reasons: string[] = [];
  let taintSources: GateDecision['taintSources'];

  if (!allowlisted) {
    if (config.recipientAllowlist.size > 0) {
      reasons.push(`recipient '${recipient}' is not in the trade allowlist`);
    }
    // Taint on the recipient specifically: did this address come from tool output?
    const overlap = Math.min(recipientLc.length, 20);
    const hits = taint.matches(recipient, overlap);
    if (hits.length > 0) {
      reasons.push(`recipient was sourced from an untrusted tool response (tainted)`);
      taintSources = hits;
    }
  }

  if (kind === 'approve' && !allowlisted) {
    const amount = extractApprovalAmount(args, config.amountKeys);
    if (amount !== null && amount >= config.maxApproval) {
      reasons.push(`unlimited approval (${amount}) to a non-allowlisted spender`);
    }
  }

  if (reasons.length === 0) return ALLOW;

  return {
    action: config.mode,
    reason: `trade-policy: ${reasons.join('; ')}`,
    matchedPattern: `trade:${kind}`,
    taintSources,
  };
}
