/// vault decide — run Vault's action-layer decision on proposed tool calls, headless.
///
/// This exposes the exact same decision engine the proxy uses (decideCapability +
/// decideTradePolicy, composed with mergeDecisions, over a taint store) as a one-shot
/// stdin/stdout JSON tool. It exists so external harnesses — e.g. the AgentDojo benchmark
/// — can evaluate the REAL Vault logic on a tool call without speaking MCP, instead of a
/// reimplementation that could drift.
///
/// Input (JSON on stdin):
///   {
///     "priorOutputs": [{ "toolName": "get_most_recent_transactions", "content": "..." }],
///     "toolCalls":    [{ "toolName": "send_money", "args": { "recipient": "US133...", "amount": 0.01 } }]
///   }
/// Output (JSON on stdout):
///   { "decisions": [{ "action": "block"|"warn"|"allow", "reason": "...", "matchedPattern": "..." }] }
///
/// Policy comes from the same env vars the proxy reads (VAULT_TRADE_GUARD,
/// VAULT_TRADE_ALLOWLIST, VAULT_TRADE_SWAP_TOOLS, VAULT_CAPABILITY, ...).

import { loadConfig } from '../config.js';
import {
  TaintStore,
  TradeRateState,
  decideCapability,
  decideTradePolicy,
  mergeDecisions,
} from '../capability/index.js';

interface PriorOutput {
  toolName: string;
  content: string;
}
interface ToolCall {
  toolName: string;
  args: unknown;
}
interface DecideRequest {
  priorOutputs?: PriorOutput[];
  toolCalls: ToolCall[];
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function main(): Promise<void> {
  const raw = (await readStdin()).trim();
  if (!raw) {
    process.stdout.write(JSON.stringify({ decisions: [] }) + '\n');
    return;
  }
  const req = JSON.parse(raw) as DecideRequest;
  const config = loadConfig();

  // Rebuild the taint provenance from the tool outputs seen so far this turn, so a
  // recipient lifted from an (injected) tool response is recognized as tainted.
  const taint = new TaintStore(config.capability.windowSize);
  let t = 1;
  for (const o of req.priorOutputs ?? []) {
    taint.add({ toolName: o.toolName, content: o.content, addedAt: t++ });
  }

  const rate = new TradeRateState();
  const decisions = (req.toolCalls ?? []).map((call) => {
    const d = mergeDecisions(
      decideCapability(call.toolName, call.args, taint, config.capability),
      decideTradePolicy(call.toolName, call.args, taint, config.tradePolicy, rate),
    );
    return { action: d.action, reason: d.reason ?? null, matchedPattern: d.matchedPattern ?? null };
  });

  process.stdout.write(JSON.stringify({ decisions }) + '\n');
}

main().catch((err) => {
  process.stderr.write(`vault decide failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
