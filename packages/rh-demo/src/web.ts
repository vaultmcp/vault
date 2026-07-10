/// vault rh-demo — browser edition.
///
/// A zero-dependency Node http server (built-in http only) that runs the same
/// agentic-trading injection demo server-side and streams structured results to a
/// stepped, animated player (src/index.html). The detection pipeline is Node-only
/// (embeddings, native deps), so all scanning happens on the server; the page
/// fetches results from /api/run and paces the reveal client-side.
///
/// Usage:
///   pnpm --filter @vaultmcp/rh-demo web            # http://localhost:5178
///   ANTHROPIC_API_KEY=... pnpm --filter @vaultmcp/rh-demo web   # + L3 detection

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TradingServer } from './trading-server.js';
import { SCENARIOS } from './scenario.js';
import { pickAgent } from './agent.js';
import { warmupLayer2 } from './guard.js';
import { evaluateScenario, type ScenarioOutcome } from './engine.js';
import { createClientFromEnv } from '../../proxy/src/detection/clients/factory.js';

const PORT = Number(process.env.PORT ?? 5178);
const PAGE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html'), 'utf8');

interface RunPayload {
  hasL3: boolean;
  agentName: string;
  poisoned: number;
  unguarded: ScenarioOutcome[];
  guarded: ScenarioOutcome[];
}

async function runAll(): Promise<RunPayload> {
  const agent = pickAgent();
  const server = new TradingServer();
  const unguarded: ScenarioOutcome[] = [];
  const guarded: ScenarioOutcome[] = [];
  for (const s of SCENARIOS) unguarded.push(await evaluateScenario(server, agent.run, s, false));
  for (const s of SCENARIOS) guarded.push(await evaluateScenario(server, agent.run, s, true));
  return {
    hasL3: createClientFromEnv() !== null,
    agentName: agent.name,
    poisoned: SCENARIOS.filter((s) => s.kind === 'poisoned').length,
    unguarded,
    guarded,
  };
}

async function main() {
  process.stdout.write('vault rh-demo (web): warming up detection layers…\n');
  await warmupLayer2();

  const srv = createServer(async (req, res) => {
    try {
      if (req.url === '/api/run') {
        const payload = await runAll();
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE);
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(`error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  srv.listen(PORT, () => {
    process.stdout.write(`vault rh-demo (web): http://localhost:${PORT}\n`);
  });
}

main().catch((err) => {
  process.stderr.write(`rh-demo web failed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
