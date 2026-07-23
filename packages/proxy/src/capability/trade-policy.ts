/// Trade policy — a specialized, high-precision capability gate for on-chain trading
/// tools (swaps, approvals). Where the generic capability gate (gate.ts) blocks any
/// sensitive tool whose args merely overlap tainted content, this gate understands
/// trade semantics and enforces a full spending firewall on the ACTION:
///
///   - recipient allowlist + taint (who may receive funds)
///   - unlimited-approval blocking
///   - per-trade value cap
///   - cumulative value moved per rolling window
///   - per-token exposure cap per window
///   - a circuit breaker that halts trading after repeated blocks
///   - market-hours enforcement (tokenized stocks trade on a schedule)
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
  /**
   * What to do with a recipient that isn't allowlisted but ALSO isn't tainted (an unknown
   * first-time payee). 'block' = strict. 'warn' = flag it but let it through, which avoids
   * over-blocking legitimate new payees. Tainted recipients always hard-block regardless.
   */
  allowlistMode: 'block' | 'warn';
  /** Tool-name patterns that denote a swap / transfer action. */
  swapPatterns: RegExp[];
  /** Tool-name patterns that denote an approval / allowance action. */
  approvePatterns: RegExp[];
  /** Argument keys that carry the recipient/spender address. */
  recipientKeys: string[];
  /** Argument keys that carry a swap/approval amount. */
  amountKeys: string[];
  /** Argument keys that identify the token being traded (for per-token limits). */
  tokenKeys: string[];
  /** Approvals at or above this are treated as unlimited. */
  maxApproval: bigint;
  /** Per-trade value ceiling: a swap whose amount is at or above this is blocked. null = no cap. */
  maxTradeValue: bigint | null;
  /** Max allowed (non-blocked) trade actions per window. null = no velocity limit. */
  maxPerWindow: number | null;
  /** Cumulative value that may be moved within a window. null = no cap. */
  maxValuePerWindow: bigint | null;
  /** Cumulative value that may be moved into a single token within a window. null = no cap. */
  maxValuePerToken: bigint | null;
  /**
   * Graduated escalation. After this many consecutive blocked trades (fewer than the
   * breaker) the guard enters an ELEVATED state: value caps shrink by elevatedFactorPct and
   * unknown payees are hard-blocked even in warn mode. It relaxes as blocks stop. null = off.
   */
  elevatedThreshold: number | null;
  /** In the ELEVATED state, value caps are scaled to this percent of their configured value. */
  elevatedFactorPct: number;
  /** Trip the circuit breaker after this many consecutive blocked trades (the LOCKED state). null = off. */
  breakerThreshold: number | null;
  /** Trading window, UTC minutes-of-day (weekdays only). null = always open. */
  marketHours: { startMin: number; endMin: number } | null;
  /** Rolling window in milliseconds (velocity, value-per-window, breaker cooldown). */
  windowMs: number;
}

const ALLOW: GateDecision = { action: 'allow' };

/// Per-session firewall state: records ALLOWED trades (timestamp + value + token) for
/// the rolling-window limits, and tracks consecutive blocks for the circuit breaker.
/// Created once per proxied session in the transport, alongside the taint store.
export class TradeRateState {
  private entries: { ts: number; value: bigint; token: string }[] = [];
  private consecutiveBlocks = 0;
  private lastBlockAt = 0;

  private prune(cutoff: number): void {
    this.entries = this.entries.filter((e) => e.ts >= cutoff);
  }

  countInWindow(now: number, windowMs: number): number {
    this.prune(now - windowMs);
    return this.entries.length;
  }

  valueInWindow(now: number, windowMs: number): bigint {
    this.prune(now - windowMs);
    return this.entries.reduce((s, e) => s + e.value, 0n);
  }

  valueInWindowForToken(now: number, windowMs: number, token: string): bigint {
    this.prune(now - windowMs);
    const t = token.toLowerCase();
    return this.entries.reduce((s, e) => (e.token.toLowerCase() === t ? s + e.value : s), 0n);
  }

  record(now: number, value: bigint = 0n, token = ''): void {
    this.entries.push({ ts: now, value, token });
  }

  noteBlock(now: number): void {
    this.consecutiveBlocks += 1;
    this.lastBlockAt = now;
  }

  noteAllow(): void {
    this.consecutiveBlocks = 0;
  }

  /// Open when there have been >= threshold consecutive blocks and the last one was
  /// within the cooldown window. It relaxes on its own once things go quiet.
  breakerOpen(threshold: number, now: number, windowMs: number): boolean {
    return this.consecutiveBlocks >= threshold && now - this.lastBlockAt <= windowMs;
  }
}

export type TradeKind = 'swap' | 'approve' | null;

export function classifyTrade(name: string, config: TradePolicyConfig): TradeKind {
  if (config.approvePatterns.some((re) => re.test(name))) return 'approve';
  if (config.swapPatterns.some((re) => re.test(name))) return 'swap';
  return null;
}

export function extractRecipient(args: unknown, keys: string[]): string | null {
  if (args == null || typeof args !== 'object') return null;
  const obj = args as Record<string, unknown>;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

export function extractToken(args: unknown, keys: string[]): string {
  if (args == null || typeof args !== 'object') return '';
  const obj = args as Record<string, unknown>;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

export function extractAmount(args: unknown, keys: string[]): bigint | null {
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

/// True when `now` falls inside the market window (weekdays only, UTC).
function withinMarketHours(now: number, mh: { startMin: number; endMin: number }): boolean {
  const d = new Date(now);
  const day = d.getUTCDay(); // 0 Sun .. 6 Sat
  if (day === 0 || day === 6) return false;
  const minOfDay = d.getUTCHours() * 60 + d.getUTCMinutes();
  return minOfDay >= mh.startMin && minOfDay < mh.endMin;
}

function block(mode: 'block' | 'warn', kind: TradeKind, reason: string, taintSources?: GateDecision['taintSources']): GateDecision {
  return { action: mode, reason: `trade-policy: ${reason}`, matchedPattern: `trade:${kind}`, taintSources };
}

/// Decide whether a trading tool call may proceed. Returns `allow` for anything that
/// isn't a recognized trade action (so it composes cleanly with the generic gate).
///
/// `rate` (optional) enables the windowed limits + circuit breaker; it must be the same
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

  // 1. Circuit breaker — highest priority. Once open, halt everything until it cools
  //    down. Does not update state (so the cooldown can actually elapse).
  if (config.breakerThreshold !== null && rate && rate.breakerOpen(config.breakerThreshold, now, config.windowMs)) {
    return block(config.mode, kind, `circuit breaker open (>= ${config.breakerThreshold} consecutive blocked trades) — trading halted for the window`);
  }

  // 1b. Graduated escalation. Below the breaker but above the elevated threshold, the guard
  //     tightens itself: value caps shrink and unknown payees are hard-blocked. The pressure
  //     is on the PERMISSIONS, not the agent — it relaxes on its own as blocks stop.
  const elevated =
    config.elevatedThreshold !== null &&
    rate != null &&
    rate.breakerOpen(config.elevatedThreshold, now, config.windowMs);
  const scaleCap = (v: bigint | null): bigint | null =>
    v === null ? null : elevated ? (v * BigInt(config.elevatedFactorPct)) / 100n : v;
  const effAllowlistMode = elevated ? 'block' : config.allowlistMode;

  // 2. Market hours — a schedule gate. Blocks but does NOT feed the breaker (a closed
  //    market is expected, not suspicious).
  if (config.marketHours && !withinMarketHours(now, config.marketHours)) {
    return block(config.mode, kind, 'market is closed (outside VAULT_TRADE_MARKET_HOURS)');
  }

  const amount = extractAmount(args, config.amountKeys);
  const token = extractToken(args, config.tokenKeys);
  const hardReasons: string[] = [];
  let taintSources: GateDecision['taintSources'];
  let allowlistMiss = false;

  // 3. Recipient checks. Taint (the recipient came from a tool response) is the real
  //    injection signal and always hard-blocks. A plain unknown payee is softer — it's
  //    tracked separately and handled per allowlistMode after the hard checks.
  const recipient = extractRecipient(args, config.recipientKeys);
  const allowlisted = recipient ? config.recipientAllowlist.has(recipient.toLowerCase()) : false;
  if (recipient && !allowlisted) {
    const hits = taint.matches(recipient, Math.min(recipient.length, 20));
    if (hits.length > 0) {
      hardReasons.push('recipient was sourced from an untrusted tool response (tainted)');
      taintSources = hits;
    }
    if (config.recipientAllowlist.size > 0) allowlistMiss = true;
  }

  // 4. Amount / exposure limits — all hard.
  if (kind === 'approve' && !allowlisted && amount !== null && amount >= config.maxApproval) {
    hardReasons.push(`unlimited approval (${amount}) to a non-allowlisted spender`);
  }
  const capTag = elevated ? ' [elevated]' : '';
  const effMaxTradeValue = scaleCap(config.maxTradeValue);
  if (kind === 'swap' && effMaxTradeValue !== null && amount !== null && amount >= effMaxTradeValue) {
    hardReasons.push(`trade amount ${amount} is at or above the per-trade cap ${effMaxTradeValue}${capTag}`);
  }
  const effMaxValuePerWindow = scaleCap(config.maxValuePerWindow);
  if (kind === 'swap' && effMaxValuePerWindow !== null && rate && amount !== null) {
    const used = rate.valueInWindow(now, config.windowMs);
    if (used + amount > effMaxValuePerWindow) {
      hardReasons.push(`would move ${used + amount} in ${config.windowMs}ms, over the per-window cap ${effMaxValuePerWindow}${capTag}`);
    }
  }
  const effMaxValuePerToken = scaleCap(config.maxValuePerToken);
  if (kind === 'swap' && effMaxValuePerToken !== null && rate && amount !== null && token) {
    const used = rate.valueInWindowForToken(now, config.windowMs, token);
    if (used + amount > effMaxValuePerToken) {
      hardReasons.push(`would move ${used + amount} into ${token}, over the per-token cap ${effMaxValuePerToken}${capTag}`);
    }
  }

  if (hardReasons.length > 0) {
    rate?.noteBlock(now);
    return block(config.mode, kind, hardReasons.join('; '), taintSources);
  }

  // 5. Velocity (count) limit — hard.
  if (config.maxPerWindow !== null && rate) {
    const count = rate.countInWindow(now, config.windowMs);
    if (count >= config.maxPerWindow) {
      rate.noteBlock(now);
      return block(config.mode, kind, `trade rate limit exceeded (${count} in ${config.windowMs}ms, max ${config.maxPerWindow})`);
    }
  }

  // 6. Unknown payee (allowlist-miss, not tainted). Block in strict mode; otherwise warn and
  //    let it through — a legitimate first-time payee shouldn't be a hard failure.
  if (allowlistMiss) {
    const reason = `recipient '${recipient}' is not in the trade allowlist${elevated ? ' [elevated: unknown payees blocked]' : ''}`;
    if (effAllowlistMode === 'block') {
      rate?.noteBlock(now);
      return block(config.mode, kind, reason);
    }
    // warn: flag but proceed; it still counts as a completed trade for the windowed limits.
    if (rate) {
      rate.record(now, amount ?? 0n, token);
      rate.noteAllow();
    }
    return { action: 'warn', reason: `trade-policy: ${reason}`, matchedPattern: `trade:${kind}` };
  }

  // Allowed: record it for the windowed limits and reset the breaker.
  if (rate) {
    rate.record(now, amount ?? 0n, token);
    rate.noteAllow();
  }
  return ALLOW;
}
