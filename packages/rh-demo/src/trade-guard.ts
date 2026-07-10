/// Vault's second line of defense: guard the ACTION, not just the text.
///
/// Scanning tool responses (guard.ts) stops injections it recognizes. But a novel
/// injection can slip past any content scanner. So before an agent's swap or approval
/// is broadcast, Vault also checks the ACTION against policy — the thing that actually
/// moves money. This is the on-chain analogue of the proxy's capability firewall
/// (packages/proxy/src/capability): tainted data (anything the agent only learned from
/// a tool response) must not flow into a sensitive argument like a swap recipient.
///
/// The killer property: even with the content scanner fully OFF, a swap whose recipient
/// the agent only got from a (tainted) tool response is blocked here — because a
/// legitimate recipient (the user's own wallet) never comes from tool output.

export interface TradePolicy {
  /** Addresses the agent is allowed to send swap output / grant approvals to. */
  recipientAllowlist: string[];
  /** Approvals at or above this are treated as unlimited and blocked for non-allowlisted spenders. */
  maxApproval: bigint;
  /** minAmountOut must be at least this fraction of the quoted output (sandwich/rug guard). */
  minSlippageOutRatio: number;
}

export const DEFAULT_POLICY: Omit<TradePolicy, 'recipientAllowlist'> = {
  maxApproval: 2n ** 200n, // anything this large is "effectively unlimited"
  minSlippageOutRatio: 0.9,
};

export interface TradeAction {
  tool: 'execute_swap' | 'approve';
  /** Swap recipient or approval spender. */
  recipient: string;
  /** Approval amount (approve only). */
  approvalAmount?: bigint;
  /** Quoted vs. accepted output (execute_swap only), as plain numbers of tokens. */
  quotedOut?: number;
  minAmountOut?: number;
}

export interface TradeGuardDecision {
  action: 'allow' | 'block';
  reasons: string[];
}

function norm(addr: string): string {
  return addr.trim().toLowerCase();
}

/// Decide whether a trade action may proceed.
///
/// @param taintedSources - the tool-response texts the agent saw this turn. If the
///   recipient appears in any of them, it was attacker-influenceable (sourced from
///   untrusted tool output), which is the core taint signal.
export function guardTrade(
  a: TradeAction,
  taintedSources: string[],
  policy: TradePolicy,
): TradeGuardDecision {
  const reasons: string[] = [];
  const recipient = norm(a.recipient);
  const allow = new Set(policy.recipientAllowlist.map(norm));

  const allowlisted = allow.has(recipient);

  // 1. Recipient allowlist. A swap should land in a known-good wallet.
  if (!allowlisted) {
    reasons.push(`recipient ${a.recipient} is not in the allowlist`);
  }

  // 2. Taint: recipient sourced from an untrusted tool response. This is the signal
  //    that catches an injection the content scanner missed — a legitimate recipient
  //    never appears in tool output. Allowlisted addresses are exempt (they're trusted
  //    even if they happen to be echoed back).
  if (!allowlisted) {
    const tainted = taintedSources.some((t) => norm(t).includes(recipient));
    if (tainted) {
      reasons.push(`recipient was taken from an untrusted tool response (tainted)`);
    }
  }

  // 3. Unlimited approval to a non-allowlisted spender.
  if (a.tool === 'approve' && a.approvalAmount !== undefined) {
    if (!allowlisted && a.approvalAmount >= policy.maxApproval) {
      reasons.push(`unlimited approval (${a.approvalAmount}) to a non-allowlisted spender`);
    }
  }

  // 4. Slippage floor: accepting far less than quoted is a sandwich/rug tell.
  if (
    a.tool === 'execute_swap' &&
    a.quotedOut !== undefined &&
    a.minAmountOut !== undefined &&
    a.quotedOut > 0
  ) {
    const ratio = a.minAmountOut / a.quotedOut;
    if (ratio < policy.minSlippageOutRatio) {
      reasons.push(
        `minAmountOut ${a.minAmountOut} is ${(ratio * 100).toFixed(0)}% of quoted ${a.quotedOut} ` +
          `(below ${(policy.minSlippageOutRatio * 100).toFixed(0)}% floor)`,
      );
    }
  }

  return { action: reasons.length > 0 ? 'block' : 'allow', reasons };
}
