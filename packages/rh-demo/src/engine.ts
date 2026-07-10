/// Shared evaluation logic used by both the CLI (run.ts) and the web server
/// (web.ts). Runs one scenario through one pass (guarded or not) and returns a
/// structured outcome — no printing. Every field is measured, nothing assumed.

import type { TradingServer } from './trading-server.js';
import type { Scenario } from './scenario.js';
import type { AgentDecision } from './agent.js';
import { guardToolResponse } from './guard.js';
import { guardTrade, DEFAULT_POLICY, type TradeGuardDecision } from './trade-guard.js';
import { AGENT_WALLET } from './chain.js';

export interface ScanRow {
  tool: string;
  verdict: 'clean' | 'suspicious' | 'malicious';
  layer?: number;
  confidence: number;
  blocked: boolean;
  /** Text the agent was allowed to see (original if clean, stub if blocked). */
  agentSaw: string;
}

export interface ScenarioOutcome {
  id: string;
  kind: Scenario['kind'];
  caughtBy: Scenario['caughtBy'];
  guarded: boolean;
  scans: ScanRow[];
  recipient: string;
  reasoning: string;
  hijacked: boolean;
  /** A tool response was withheld by the content scanner. */
  blocked: boolean;
  /** Action-layer verdict (guarded runs only): did the trade guard stop the swap? */
  tradeGuard?: TradeGuardDecision;
}

type AgentRun = (toolTexts: string[]) => Promise<AgentDecision>;

export async function evaluateScenario(
  server: TradingServer,
  agentRun: AgentRun,
  s: Scenario,
  guarded: boolean,
): Promise<ScenarioOutcome> {
  const calls = [
    { tool: 'get_token_metadata', resp: server.get_token_metadata(s.id) },
    { tool: 'get_quote', resp: server.get_quote(s.id) },
  ];
  // Raw tool output — the provenance record the action guard checks taint against,
  // independent of what the content scanner let the agent see.
  const rawTexts = calls.map((c) => c.resp.text);

  const scans: ScanRow[] = [];
  const agentTexts: string[] = [];
  let anyBlocked = false;

  for (const { tool, resp } of calls) {
    if (guarded) {
      const outcome = await guardToolResponse(tool, resp);
      if (outcome.blocked) anyBlocked = true;
      scans.push({
        tool,
        verdict: outcome.result.verdict,
        layer: outcome.result.layer,
        confidence: outcome.result.confidence,
        blocked: outcome.blocked,
        agentSaw: outcome.safeText,
      });
      agentTexts.push(outcome.safeText);
    } else {
      scans.push({
        tool,
        verdict: 'clean',
        confidence: 0,
        blocked: false,
        agentSaw: resp.text,
      });
      agentTexts.push(resp.text);
    }
  }

  const decision = await agentRun(agentTexts);
  const receipt = server.execute_swap(decision.recipient);

  // Second line of defense (guarded runs only): even if the content scanner missed an
  // injection, the action guard blocks a swap to a recipient that isn't allowlisted or
  // was sourced from untrusted tool output. If it blocks, the swap never broadcasts.
  let tradeGuard: TradeGuardDecision | undefined;
  if (guarded) {
    tradeGuard = guardTrade(
      { tool: 'execute_swap', recipient: decision.recipient },
      rawTexts,
      { recipientAllowlist: [AGENT_WALLET], ...DEFAULT_POLICY },
    );
  }
  const swapBroadcast = tradeGuard?.action !== 'block';
  const hijacked = swapBroadcast && receipt.redirected;

  return {
    id: s.id,
    kind: s.kind,
    caughtBy: s.caughtBy,
    guarded,
    scans,
    recipient: decision.recipient,
    reasoning: decision.reasoning,
    hijacked,
    blocked: anyBlocked,
    tradeGuard,
  };
}
