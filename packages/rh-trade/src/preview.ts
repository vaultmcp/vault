/// Simulate-before-sign — the layer past the firewall.
///
/// The trade guard blocks a swap for *what it says* (bad recipient, over a limit).
/// This blocks a swap for *what it would actually do*. Before broadcasting, we run the
/// concrete, signable transaction against the chain and read how the recipient's balances
/// really change. A swap can pass every static rule and still rob you: a rigged router,
/// calldata that doesn't match the stated intent, a sandwich, or a transfer-taxed token.
/// Simulation catches those because it looks at the outcome, not the request.
///
/// Two parts, same split as the firewall:
///   - evaluatePreview(): a pure decision over simulated numbers (fully unit-tested)
///   - simulateSwapOutput(): a thin, injectable RPC adapter (mocked in tests)

import type { Address, Hex, PublicClient } from 'viem';

export interface PreviewInput {
  /** The agent's slippage floor, in output-token smallest units. */
  minOut: bigint;
  /** Output the recipient would ACTUALLY gain per simulation. null = could not simulate. */
  simulatedOut: bigint | null;
  /** Whether the simulated transaction reverted. */
  reverted: boolean;
  /** Quoted output for the drift check, if we could read it. */
  expectedOut?: bigint | null;
  /** Block when simulatedOut is more than this far below expectedOut. Default 200 (2%). */
  maxDriftBps?: number;
  /** When simulation is unavailable: true = block, false = warn and proceed. Default false. */
  strict?: boolean;
}

export interface PreviewVerdict {
  action: 'allow' | 'warn' | 'block';
  reason: string;
  simulatedOut: string | null;
  minOut: string;
}

/// Decide whether a swap should broadcast, given what a simulation says it would do.
/// Pure and deterministic — no network, no clock.
export function evaluatePreview(input: PreviewInput): PreviewVerdict {
  const minOut = input.minOut;
  const base = { simulatedOut: input.simulatedOut?.toString() ?? null, minOut: minOut.toString() };

  if (input.reverted) {
    return { action: 'block', reason: 'simulation reverted: this swap would fail on-chain (funds would not move)', ...base };
  }

  if (input.simulatedOut === null) {
    return input.strict
      ? { action: 'block', reason: 'could not simulate this swap and strict preview is on; refusing to broadcast blind', ...base }
      : { action: 'warn', reason: 'could not simulate this swap on the RPC; broadcasting without a preview', ...base };
  }

  const sim = input.simulatedOut;
  if (sim < minOut) {
    return {
      action: 'block',
      reason: `simulated output ${sim} is below your floor ${minOut}; the trade would under-deliver`,
      ...base,
    };
  }

  const expected = input.expectedOut;
  const driftBps = input.maxDriftBps ?? 200;
  if (expected != null && expected > 0n && driftBps > 0) {
    const floor = (expected * BigInt(10000 - driftBps)) / 10000n;
    if (sim < floor) {
      const offPct = Number(((expected - sim) * 10000n) / expected) / 100;
      return {
        action: 'block',
        reason: `simulated output ${sim} is ${offPct}% below the quoted ${expected}; possible price manipulation`,
        ...base,
      };
    }
  }

  return { action: 'allow', reason: `simulated output ${sim} meets the floor ${minOut}`, ...base };
}

// ---------------------------------------------------------------------------
// RPC adapter — injectable so tests never touch the network.
// ---------------------------------------------------------------------------

export interface SimulateArgs {
  to: Address;
  data: Hex;
  value: bigint;
  /** Whose balance change we care about (the swap recipient). */
  account: Address;
  /** The token the recipient should receive. */
  outputToken: Address;
}

export type SimulateFn = (args: SimulateArgs) => Promise<{ simulatedOut: bigint | null; reverted: boolean }>;

/// Real adapter: uses viem's `simulateCalls` (eth_simulateV1) with asset-change tracing to
/// read the recipient's real gain of the output token. Any RPC that doesn't support the
/// method (or any error) resolves to `simulatedOut: null`, which evaluatePreview treats as
/// "unavailable" rather than a false block.
export function viemSimulate(client: PublicClient): SimulateFn {
  return async ({ to, data, value, account, outputToken }) => {
    try {
      // simulateCalls is a recent viem action; cast to keep this compiling across versions.
      const res: any = await (client as any).simulateCalls({
        account,
        calls: [{ to, data, value }],
        traceAssetChanges: true,
      });
      const call = res?.results?.[0];
      if (call && call.status === 'failure') return { simulatedOut: null, reverted: true };
      if (!Array.isArray(res?.assetChanges)) return { simulatedOut: null, reverted: false }; // unsupported RPC
      const match = res.assetChanges.find(
        (c: any) => c?.token?.address?.toLowerCase() === outputToken.toLowerCase(),
      );
      const diff = match?.value?.diff;
      // Traced but the output token isn't among the gains → recipient gained nothing.
      const out = typeof diff === 'bigint' ? (diff > 0n ? diff : 0n) : 0n;
      return { simulatedOut: out, reverted: false };
    } catch {
      return { simulatedOut: null, reverted: false };
    }
  };
}

/// Best-effort read of the quoted output amount from the opaque Uniswap quote object, for
/// the drift check. Returns null if we can't find it (drift check is then skipped).
export function quotedOutput(quote: Record<string, unknown> | null | undefined): bigint | null {
  if (!quote || typeof quote !== 'object') return null;
  const q = quote as Record<string, any>;
  const candidates = [q.output?.amount, q.amountOut, q.quote, q.outputAmount, q.quoteGasAdjusted];
  for (const c of candidates) {
    if (typeof c === 'bigint') return c;
    if (typeof c === 'string' && /^\d+$/.test(c)) {
      try {
        return BigInt(c);
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}
