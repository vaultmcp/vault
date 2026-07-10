/// vault rh-demo — browser edition.
///
/// A zero-dependency Node http server (built-in http only) that runs the same
/// agentic-trading injection demo server-side and renders it in the browser with
/// the Vault brand palette. The detection pipeline is Node-only (embeddings,
/// native deps), so all scanning happens on the server; the page just fetches
/// structured results from /api/run.
///
/// Usage:
///   pnpm --filter @vaultmcp/rh-demo web            # http://localhost:5178
///   ANTHROPIC_API_KEY=... pnpm --filter @vaultmcp/rh-demo web   # + L3 + Claude agent

import { createServer } from 'node:http';
import { TradingServer } from './trading-server.js';
import { SCENARIOS } from './scenario.js';
import { pickAgent } from './agent.js';
import { warmupLayer2 } from './guard.js';
import { evaluateScenario, type ScenarioOutcome } from './engine.js';
import { createClientFromEnv } from '../../proxy/src/detection/clients/factory.js';

const PORT = Number(process.env.PORT ?? 5178);

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

const PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Vault × Robinhood Chain — agentic trading, prompt-injected</title>
<style>
  :root { --green:#00ff66; --bg:#050505; --panel:#0c0c0c; --line:#1f2328; --dim:#7a7a7a; --red:#ff4757; --yellow:#ffb547; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:#e8e8e8; font:15px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; }
  .wrap { max-width:1080px; margin:0 auto; padding:32px 20px 64px; }
  h1 { font-size:22px; margin:0 0 4px; }
  h1 .g { color:var(--green); }
  .sub { color:var(--dim); margin:0 0 24px; font-size:13px; }
  .bar { display:flex; gap:16px; flex-wrap:wrap; align-items:center; padding:12px 16px; border:1px solid var(--line); border-radius:10px; background:var(--panel); margin-bottom:24px; font-size:13px; }
  .bar b { color:var(--green); }
  button { background:var(--green); color:#00230f; border:0; border-radius:8px; padding:9px 18px; font:inherit; font-weight:700; cursor:pointer; }
  button:disabled { opacity:.5; cursor:default; }
  .cols { display:grid; grid-template-columns:1fr 1fr; gap:20px; }
  @media (max-width:820px){ .cols { grid-template-columns:1fr; } }
  .col h2 { font-size:14px; text-transform:uppercase; letter-spacing:.08em; color:var(--dim); border-bottom:1px solid var(--line); padding-bottom:8px; }
  .card { border:1px solid var(--line); border-radius:10px; background:var(--panel); padding:14px 16px; margin-bottom:14px; }
  .card .id { color:#9aa1a8; font-size:12px; margin-bottom:10px; }
  .scan { display:flex; justify-content:space-between; font-size:12px; padding:3px 0; color:#c9c9c9; }
  .scan .v-clean { color:var(--green); } .scan .v-mal { color:var(--red); } .scan .v-sus { color:var(--yellow); }
  .agent { font-size:12px; color:var(--dim); margin:10px 0 8px; border-left:2px solid var(--line); padding-left:10px; }
  .verdict { font-weight:700; font-size:13px; }
  .hijacked { color:var(--red); } .safe { color:var(--green); }
  .sumbar { margin-top:26px; padding:16px; border:1px solid var(--line); border-radius:10px; background:var(--panel); }
  .sumbar .row { margin:4px 0; } .foot { color:var(--dim); font-size:12px; margin-top:14px; }
  code { color:var(--green); }
  .note { color:var(--yellow); font-size:12px; margin-top:10px; }
  .spin { color:var(--dim); }
</style>
</head>
<body>
<div class="wrap">
  <h1>Vault × <span class="g">Robinhood Chain</span> — agentic trading, prompt-injected</h1>
  <p class="sub">A poisoned MCP tool response hijacks a trading agent into redirecting a swap. Vault strips the injection before the agent reads it. All results measured server-side.</p>
  <div class="bar" id="bar"><span class="spin">Warming up Vault detection layers…</span></div>
  <div class="cols">
    <div class="col"><h2>Pass 1 — no Vault</h2><div id="unguarded"></div></div>
    <div class="col"><h2>Pass 2 — Vault proxy in front</h2><div id="guarded"></div></div>
  </div>
  <div class="sumbar" id="summary"></div>
  <p class="foot">Wrap any MCP trading server: <code>npx @aimcpvault/mcp-proxy -- &lt;trading server&gt;</code> · vaultmcp.io</p>
</div>
<script>
const vclass = v => v==='malicious'?'v-mal':v==='suspicious'?'v-sus':'v-clean';
function card(o){
  const scans = o.scans.map(s=>{
    const lbl = o.guarded ? (s.blocked?('✗ '+s.verdict.toUpperCase()+(s.layer!=null?' L'+s.layer:'')):'✓ clean'+(s.layer!=null?' L'+s.layer:'')) : '(unscanned)';
    return '<div class="scan"><span>'+s.tool+'</span><span class="'+(o.guarded?vclass(s.verdict):'')+'">'+lbl+'</span></div>';
  }).join('');
  const v = o.hijacked ? '<span class="verdict hijacked">✗ HIJACKED — funds routed to attacker</span>'
                       : '<span class="verdict safe">✓ SAFE — swap to user wallet</span>';
  return '<div class="card"><div class="id">'+o.id+' ['+o.kind+']</div>'+scans+
         '<div class="agent">agent → '+o.recipient+'<br>'+o.reasoning+'</div>'+v+'</div>';
}
async function run(){
  const bar=document.getElementById('bar');
  bar.innerHTML='<span class="spin">Running scenarios…</span>';
  const r=await fetch('/api/run'); const d=await r.json();
  bar.innerHTML='agent backend <b>'+d.agentName+'</b> &nbsp; vault layers <b>'+(d.hasL3?'L0 L1 L2 L3':'L0 L1 L2 (L3 offline)')+'</b> &nbsp; '
    +'<button onclick="run()">Re-run</button>';
  document.getElementById('unguarded').innerHTML=d.unguarded.map(card).join('');
  document.getElementById('guarded').innerHTML=d.guarded.map(card).join('');
  const ugH=d.unguarded.filter(o=>o.hijacked).length;
  const gH=d.guarded.filter(o=>o.hijacked).length;
  const gB=d.guarded.reduce((n,o)=>n+o.scans.filter(s=>s.blocked).length,0);
  const missed=d.guarded.filter(o=>o.hijacked).map(o=>o.id);
  let html='<div class="row">Without Vault: <span class="hijacked">'+ugH+'/'+d.poisoned+' poisoned trades hijacked</span></div>'+
           '<div class="row">With Vault: <span class="'+(gH===0?'safe':'')+'" style="'+(gH>0?'color:var(--yellow)':'')+'">'+gH+'/'+d.poisoned+' hijacked</span> · <span class="safe">'+gB+' injection(s) stripped</span></div>';
  if(gH>0){ html+='<div class="note">Vault missed '+missed.join(', ')+' because '+(d.hasL3?'the L3 judge did not flag it':'L3 is offline — set ANTHROPIC_API_KEY; this is an L3 catch')+'.</div>'; }
  document.getElementById('summary').innerHTML=html;
}
run();
</script>
</body>
</html>`;

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
