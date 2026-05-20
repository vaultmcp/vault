// Drives the real `mcp-server-git` Python MCP server through Vault.
// Read-only against this repo's own working tree.

import { execSync } from 'node:child_process';
import {
  runBattery,
  responsePreview,
  argsSummary,
  mdCell,
  writeReport,
  REPO_ROOT,
} from './_lib.mjs';

const VENV_PY = '/tmp/vault-venv-git/bin/python';

function recentSHAs(n) {
  const out = execSync(`git -C ${REPO_ROOT} log --format=%H -n ${n}`, { encoding: 'utf8' });
  return out.trim().split('\n');
}

function buildFrames() {
  const frames = [];
  let id = 1;
  frames.push({
    _label: 'initialize', _opType: 'init',
    jsonrpc: '2.0', id: id++, method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'vault-real-world', version: '0.0.1' } },
  });
  frames.push({ _label: 'initialized', _opType: 'notify', jsonrpc: '2.0', method: 'notifications/initialized' });
  frames.push({
    _label: 'tools/list', _opType: 'list', jsonrpc: '2.0', id: id++, method: 'tools/list', params: {},
  });

  const repo = REPO_ROOT;

  // git_status, git_log, git_diff against current repo
  frames.push({
    _label: 'git_status', _opType: 'call', jsonrpc: '2.0', id: id++,
    method: 'tools/call', params: { name: 'git_status', arguments: { repo_path: repo } },
  });
  frames.push({
    _label: 'git_log (15)', _opType: 'call', jsonrpc: '2.0', id: id++,
    method: 'tools/call', params: { name: 'git_log', arguments: { repo_path: repo, max_count: 15 } },
  });
  frames.push({
    _label: 'git_diff_unstaged', _opType: 'call', jsonrpc: '2.0', id: id++,
    method: 'tools/call', params: { name: 'git_diff_unstaged', arguments: { repo_path: repo } },
  });
  frames.push({
    _label: 'git_diff_staged', _opType: 'call', jsonrpc: '2.0', id: id++,
    method: 'tools/call', params: { name: 'git_diff_staged', arguments: { repo_path: repo } },
  });
  frames.push({
    _label: 'git_branch_list_local', _opType: 'call', jsonrpc: '2.0', id: id++,
    method: 'tools/call', params: { name: 'git_branch', arguments: { repo_path: repo, branch_type: 'local' } },
  });

  // git_show for the 10 most recent commits
  const shas = recentSHAs(10);
  for (const sha of shas) {
    frames.push({
      _label: `git_show ${sha.slice(0, 7)}`, _opType: 'call', jsonrpc: '2.0', id: id++,
      method: 'tools/call', params: { name: 'git_show', arguments: { repo_path: repo, revision: sha } },
    });
  }

  return frames;
}

async function main() {
  const frames = buildFrames();
  const t0 = Date.now();
  const result = await runBattery({
    upstreamCmd: VENV_PY,
    upstreamArgs: ['-m', 'mcp_server_git', '--repository', REPO_ROOT],
    frames,
    idleTimeoutMs: 6000,
    hardTimeoutMs: 180000,
  });
  const wallMs = Date.now() - t0;

  const rows = [];
  let calls = 0, cleanCount = 0, nonCleanCount = 0;
  const falsePositives = [];
  for (const f of frames) {
    if (f._opType !== 'call') continue;
    calls++;
    const verdictRec = result.verdicts.get(f.id);
    const respRec = result.responses.get(f.id);
    const verdict = verdictRec?.verdict ?? 'clean';
    const layer = verdictRec?.layer ?? null;
    const lat = verdictRec?.latencyMs ?? '';
    const preview = responsePreview(respRec?.obj);
    rows.push({ n: calls, tool: f.params.name, args: argsSummary(f.params.arguments), verdict, layer, lat, preview, label: f._label });
    if (verdict === 'clean') cleanCount++;
    else {
      nonCleanCount++;
      falsePositives.push({ label: f._label, tool: f.params.name, args: f.params.arguments, verdict, layer, preview, verdictLine: verdictRec?.raw ?? '' });
    }
  }

  const protocolOddities = [];
  for (const f of frames) {
    if (f._opType !== 'call') continue;
    const respRec = result.responses.get(f.id);
    if (!respRec) { protocolOddities.push(`op ${f._label}: no response captured (id=${f.id})`); continue; }
    if (respRec.obj.error) protocolOddities.push(`op ${f._label}: JSON-RPC error code=${respRec.obj.error.code} message=${(respRec.obj.error.message ?? '').slice(0, 100)}`);
    const r = respRec.obj.result;
    if (r && Array.isArray(r.content)) {
      const totalLen = r.content.reduce((acc, c) => acc + (typeof c.text === 'string' ? c.text.length : 0), 0);
      if (totalLen > 50000) protocolOddities.push(`op ${f._label}: large text response (${totalLen} chars)`);
      if (r.content.length > 1) protocolOddities.push(`op ${f._label}: multi-content response (${r.content.length} items)`);
      const nonText = r.content.filter((c) => c.type && c.type !== 'text');
      if (nonText.length) protocolOddities.push(`op ${f._label}: non-text content types: ${nonText.map((c) => c.type).join(',')}`);
    }
  }

  const lines = [];
  lines.push('# Real-world battery: mcp-server-git');
  lines.push('');
  lines.push('## What I ran');
  lines.push('');
  lines.push(`- Command: \`node packages/proxy/dist/index.js -- ${VENV_PY} -m mcp_server_git --repository ${REPO_ROOT}\``);
  lines.push('- Env: VAULT_MODE=log, VAULT_TELEMETRY=0, ANTHROPIC_API_KEY=unset (L3 disabled)');
  lines.push('- Upstream: PyPI `mcp-server-git` installed into `/tmp/vault-venv-git`');
  lines.push(`- Wall-clock: ${(wallMs / 1000).toFixed(1)}s`);
  lines.push('');
  lines.push('## Manifest verdict lines');
  lines.push('');
  for (const m of result.manifestLines) lines.push('- `' + m + '`');
  lines.push('');
  lines.push('## Operations');
  lines.push('');
  lines.push('| # | tool | args | verdict | layer | latency (ms) | preview |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const r of rows) lines.push(`| ${r.n} | ${mdCell(r.tool)} | ${mdCell(r.args)} | ${mdCell(r.verdict)} | ${mdCell(r.layer ?? '')} | ${mdCell(r.lat)} | ${mdCell(r.preview)} |`);
  lines.push('');
  lines.push('## False positives');
  lines.push('');
  if (falsePositives.length === 0) {
    lines.push('None. All commit shows, logs, diffs, and status reads were `clean`.');
  } else {
    for (const fp of falsePositives) {
      lines.push(`### ${fp.label}`);
      lines.push('');
      lines.push(`- Tool: \`${fp.tool}\``);
      lines.push(`- Args: \`${JSON.stringify(fp.args)}\``);
      lines.push(`- Verdict: \`${fp.verdict}\` (L${fp.layer ?? '?'})`);
      lines.push(`- Verdict line: \`${fp.verdictLine}\``);
      lines.push(`- Preview: ${fp.preview}`);
      lines.push('');
    }
  }
  lines.push('## False negatives');
  lines.push('');
  lines.push('N/A — commits are our own benign work.');
  lines.push('');
  lines.push('## Protocol oddities');
  lines.push('');
  if (protocolOddities.length === 0) lines.push('- None noted.');
  else for (const o of protocolOddities) lines.push(`- ${o}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Total ops: ${calls}`);
  lines.push(`- Clean: ${cleanCount}`);
  lines.push(`- Non-clean (FPs against benign content): ${nonCleanCount}`);
  lines.push(`- Protocol oddities noted: ${protocolOddities.length}`);
  lines.push(`- Battery exit reason: ${result.reason}`);

  writeReport('git.md', lines.join('\n') + '\n');
  console.log(`git: ${calls} ops, ${cleanCount} clean, ${nonCleanCount} flagged. Report written.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
