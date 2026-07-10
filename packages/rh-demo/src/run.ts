/// vault rh-demo — agentic-trading prompt-injection showcase on Robinhood Chain.
///
/// Runs a trading agent against poisoned MCP tool responses twice:
///   1. UN-GUARDED — the injection reaches the agent, which redirects the swap.
///   2. GUARDED    — Vault scans each tool response before the agent reads it.
///
/// Every number printed is measured from the actual run. In degraded mode (no
/// ANTHROPIC_API_KEY) Vault runs L1+L2 only and will MISS the subtle injection —
/// the summary reports that honestly and points you at enabling L3.
///
/// Usage:
///   pnpm --filter @vaultmcp/rh-demo demo                         # both passes, L1+L2
///   ANTHROPIC_API_KEY=... pnpm --filter @vaultmcp/rh-demo demo   # + L3 + real Claude agent
///   pnpm --filter @vaultmcp/rh-demo demo -- --unguarded

import { TradingServer } from './trading-server.js';
import { SCENARIOS, type Scenario } from './scenario.js';
import { pickAgent } from './agent.js';
import { guardToolResponse, warmupLayer2 } from './guard.js';
import { createClientFromEnv } from '../../proxy/src/detection/clients/factory.js';

const useColor = process.stdout.isTTY === true && !process.env.NO_COLOR;
const c = (s: string, code: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
// Vault brand green (#00ff66).
const green = (s: string) => c(s, '38;2;0;255;102');
const red = (s: string) => c(s, '31');
const yellow = (s: string) => c(s, '33');
const bold = (s: string) => c(s, '1');
const dim = (s: string) => c(s, '2;37');
const cyan = (s: string) => c(s, '36');

const SEP = '─'.repeat(60);
const out = (s: string) => process.stdout.write(s);

interface PassResult {
  scenarioId: string;
  kind: Scenario['kind'];
  guarded: boolean;
  hijacked: boolean;
  blocked: boolean;
}

function toolResponsesFor(server: TradingServer, s: Scenario) {
  return [
    { tool: 'get_token_metadata', resp: server.get_token_metadata(s.id) },
    { tool: 'get_quote', resp: server.get_quote(s.id) },
  ];
}

async function runScenario(
  server: TradingServer,
  agent: ReturnType<typeof pickAgent>,
  s: Scenario,
  guarded: boolean,
): Promise<PassResult> {
  out(`${SEP}\n`);
  out(`  ${bold(guarded ? green('GUARDED  ') : red('UN-GUARDED'))}  ${cyan(s.id)} ${dim(`[${s.kind}]`)}\n\n`);

  const calls = toolResponsesFor(server, s);
  const agentTexts: string[] = [];
  let anyBlocked = false;

  for (const { tool, resp } of calls) {
    if (guarded) {
      const outcome = await guardToolResponse(tool, resp);
      const tag = outcome.blocked
        ? red(`✗ ${outcome.result.verdict.toUpperCase()}`)
        : green('✓ clean');
      const via = outcome.result.layer !== undefined ? dim(` L${outcome.result.layer}`) : '';
      out(`  ${dim(tool)} → ${tag}${via} ${dim(`conf=${outcome.result.confidence.toFixed(2)}`)}\n`);
      if (outcome.blocked) anyBlocked = true;
      agentTexts.push(outcome.safeText);
    } else {
      out(`  ${dim(tool)} → ${dim('(passed straight to agent, unscanned)')}\n`);
      agentTexts.push(resp.text);
    }
  }

  const decision = await agent.run(agentTexts);
  const receipt = server.execute_swap(decision.recipient);
  const hijacked = receipt.redirected;

  out('\n');
  out(`  agent → swap recipient ${cyan(decision.recipient)}\n`);
  out(`  ${dim(decision.reasoning)}\n\n`);
  if (hijacked) {
    out(`  ${red(bold('✗ HIJACKED'))} — funds routed to the attacker.\n\n`);
  } else {
    out(`  ${green(bold('✓ SAFE'))} — swap completed to the user's wallet.\n\n`);
  }

  return { scenarioId: s.id, kind: s.kind, guarded, hijacked, blocked: anyBlocked };
}

async function main() {
  const args = process.argv.slice(2);
  const wantGuarded = !args.includes('--unguarded');
  const wantUnguarded = !args.includes('--guarded');

  const agent = pickAgent();
  const hasL3 = createClientFromEnv() !== null;
  const poisoned = SCENARIOS.filter((s) => s.kind === 'poisoned').length;

  out(`\n${bold('vault rh-demo')} — agentic-trading prompt injection on ${green('Robinhood Chain')}\n`);
  out(`${SEP}\n`);
  out(`  agent backend   ${cyan(agent.name)}${agent.name === 'naive' ? dim('  (set ANTHROPIC_API_KEY for a real Claude agent)') : ''}\n`);
  out(`  vault layers    ${hasL3 ? green('L0 L1 L2 L3') : `${green('L0 L1 L2')} ${yellow('L3-offline')}`}\n`);
  out(`  scenarios       ${cyan(String(SCENARIOS.length))} (${poisoned} poisoned)\n`);
  out(`  passes          ${cyan([wantUnguarded && 'un-guarded', wantGuarded && 'guarded'].filter(Boolean).join(' + '))}\n`);
  if (!hasL3) {
    out(`  ${yellow('⚠')} ${dim('Degraded mode: the subtle injection needs the L3 judge. Set ANTHROPIC_API_KEY.')}\n`);
  }
  out(`${SEP}\n\n`);

  out(`  Warming up Vault detection layers...\n\n`);
  await warmupLayer2();

  const server = new TradingServer();
  const results: PassResult[] = [];

  if (wantUnguarded) {
    out(`${bold('PASS 1 — no Vault')} ${dim('(what agentic trading looks like today)')}\n\n`);
    for (const s of SCENARIOS) results.push(await runScenario(server, agent, s, false));
  }
  if (wantGuarded) {
    out(`${bold('PASS 2 — Vault proxy in front of the trading server')}\n\n`);
    for (const s of SCENARIOS) results.push(await runScenario(server, agent, s, true));
  }

  // ── Summary — all counts measured from `results`, nothing assumed ───────────
  out(`${SEP}\n  ${bold('Summary')}\n\n`);

  const ug = results.filter((r) => !r.guarded);
  const g = results.filter((r) => r.guarded);
  const ugHijacks = ug.filter((r) => r.hijacked).length;
  const gHijacks = g.filter((r) => r.hijacked).length;
  const gBlocked = g.filter((r) => r.blocked).length;

  if (wantUnguarded) {
    out(`  Without Vault: ${red(`${ugHijacks}/${poisoned} poisoned trades hijacked`)}.\n`);
  }
  if (wantGuarded) {
    const label = gHijacks === 0 ? green(`${gHijacks}/${poisoned} hijacked`) : yellow(`${gHijacks}/${poisoned} hijacked`);
    out(`  With Vault:    ${label} · ${green(`${gBlocked} injection(s) stripped`)} before the agent read them.\n`);
    if (gHijacks > 0) {
      const missed = g.filter((r) => r.hijacked).map((r) => r.scenarioId);
      out(
        `\n  ${yellow('Note:')} Vault missed ${missed.join(', ')} in this run because ` +
          `${hasL3 ? 'the L3 judge did not flag it' : 'L3 is offline'}.\n` +
          (hasL3
            ? ''
            : `  Re-run with ${cyan('ANTHROPIC_API_KEY')} set — the subtle injection is an L3 catch.\n`),
      );
    }
  }

  out(`\n  ${dim('Wrap any MCP trading server:')} ${cyan('npx @aimcpvault/mcp-proxy -- <trading server>')}\n`);
  out(`  ${dim('vaultmcp.io')}\n\n`);
}

main().catch((err) => {
  process.stderr.write(`rh-demo failed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
