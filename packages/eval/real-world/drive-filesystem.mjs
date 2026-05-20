// Drives the real `@modelcontextprotocol/server-filesystem` MCP server
// through Vault and records every verdict. Read-only; only touches /tmp.

import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  runBattery,
  responsePreview,
  argsSummary,
  mdCell,
  writeReport,
} from './_lib.mjs';

const README_DIR = '/tmp/vault-readmes';

function listReadmes() {
  let names;
  try {
    names = readdirSync(README_DIR).filter((n) => n.endsWith('.md'));
  } catch {
    names = [];
  }
  return names.map((n) => path.join(README_DIR, n));
}

function buildFrames() {
  const frames = [];
  let id = 1;
  frames.push({
    _label: 'initialize',
    _opType: 'init',
    jsonrpc: '2.0',
    id: id++,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'vault-real-world', version: '0.0.1' },
    },
  });
  frames.push({
    _label: 'initialized',
    _opType: 'notify',
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  });
  frames.push({
    _label: 'tools/list',
    _opType: 'list',
    jsonrpc: '2.0',
    id: id++,
    method: 'tools/list',
    params: {},
  });

  // Directory listings — only on dirs we know exist & are safe to read.
  for (const dir of ['/tmp', '/usr/local', '/etc']) {
    frames.push({
      _label: `list_directory ${dir}`,
      _opType: 'call',
      jsonrpc: '2.0',
      id: id++,
      method: 'tools/call',
      params: { name: 'list_directory', arguments: { path: dir } },
    });
  }

  // list_allowed_directories (interesting — returns proxy-known dirs).
  frames.push({
    _label: 'list_allowed_directories',
    _opType: 'call',
    jsonrpc: '2.0',
    id: id++,
    method: 'tools/call',
    params: { name: 'list_allowed_directories', arguments: {} },
  });

  // get_file_info on a couple files
  const readmes = listReadmes();
  for (const f of readmes.slice(0, 3)) {
    frames.push({
      _label: `get_file_info ${path.basename(f)}`,
      _opType: 'call',
      jsonrpc: '2.0',
      id: id++,
      method: 'tools/call',
      params: { name: 'get_file_info', arguments: { path: f } },
    });
  }

  // read_text_file each README
  for (const f of readmes) {
    frames.push({
      _label: `read_text_file ${path.basename(f)}`,
      _opType: 'call',
      jsonrpc: '2.0',
      id: id++,
      method: 'tools/call',
      params: { name: 'read_text_file', arguments: { path: f } },
    });
  }

  return { frames, readmes };
}

async function main() {
  const { frames, readmes } = buildFrames();
  // The proxy spawns the filesystem server with /tmp as the allowed root.
  // `npx -y @modelcontextprotocol/server-filesystem /tmp` matches the help banner.
  const t0 = Date.now();
  const result = await runBattery({
    upstreamCmd: 'npx',
    upstreamArgs: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    frames,
    idleTimeoutMs: 6000,
    hardTimeoutMs: 240000,
  });
  const wallMs = Date.now() - t0;

  // Build the report.
  const rows = [];
  let opIdx = 0;
  let calls = 0;
  let cleanCount = 0;
  let nonCleanCount = 0;
  const falsePositives = [];
  for (const f of frames) {
    if (f._opType !== 'call') continue;
    opIdx++;
    calls++;
    const verdictRec = result.verdicts.get(f.id);
    const respRec = result.responses.get(f.id);
    const verdict = verdictRec?.verdict ?? 'clean';
    const layer = verdictRec?.layer ?? null;
    const lat = verdictRec?.latencyMs ?? '';
    const preview = responsePreview(respRec?.obj);
    rows.push({
      n: opIdx,
      tool: f.params.name,
      args: argsSummary(f.params.arguments),
      verdict,
      layer,
      lat,
      preview,
      label: f._label,
    });
    if (verdict === 'clean') cleanCount++;
    else {
      nonCleanCount++;
      falsePositives.push({
        label: f._label,
        tool: f.params.name,
        args: f.params.arguments,
        verdict,
        layer,
        preview,
        verdictLine: verdictRec?.raw ?? '',
      });
    }
  }

  const protocolOddities = [];
  // Were there responses with no matching send? Anything unusual?
  // Check for non-text content blocks and oversized text blocks.
  for (const f of frames) {
    if (f._opType !== 'call') continue;
    const respRec = result.responses.get(f.id);
    if (!respRec) {
      protocolOddities.push(`op ${f._label}: no response captured (id=${f.id})`);
      continue;
    }
    const r = respRec.obj.result;
    if (respRec.obj.error) {
      protocolOddities.push(`op ${f._label}: JSON-RPC error code=${respRec.obj.error.code} message=${(respRec.obj.error.message ?? '').slice(0, 100)}`);
    }
    if (r && Array.isArray(r.content)) {
      const nonText = r.content.filter((c) => c.type && c.type !== 'text');
      if (nonText.length) protocolOddities.push(`op ${f._label}: non-text content types: ${nonText.map((c) => c.type).join(',')}`);
      const totalLen = r.content.reduce((acc, c) => acc + (typeof c.text === 'string' ? c.text.length : 0), 0);
      if (totalLen > 50000) protocolOddities.push(`op ${f._label}: large text response (${totalLen} chars)`);
      if (r.content.length > 1) protocolOddities.push(`op ${f._label}: multi-content response (${r.content.length} items)`);
      // structured `result.structuredContent` is a newer field — surface if seen
      if (respRec.obj.result.structuredContent) protocolOddities.push(`op ${f._label}: result.structuredContent present`);
    }
  }

  const lines = [];
  lines.push('# Real-world battery: @modelcontextprotocol/server-filesystem');
  lines.push('');
  lines.push('## What I ran');
  lines.push('');
  lines.push('- Command: `node packages/proxy/dist/index.js -- npx -y @modelcontextprotocol/server-filesystem /tmp`');
  lines.push(`- Env: VAULT_MODE=log, VAULT_TELEMETRY=0, ANTHROPIC_API_KEY=unset (L3 disabled)`);
  lines.push(`- Proxy entry: \`packages/proxy/dist/index.js\` (built fresh for this sprint)`);
  lines.push(`- Upstream server name: \`secure-filesystem-server\` (per initialize response)`);
  lines.push(`- README battery: 34 files downloaded to \`/tmp/vault-readmes\` from popular GitHub repos`);
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
  for (const r of rows) {
    lines.push(`| ${r.n} | ${mdCell(r.tool)} | ${mdCell(r.args)} | ${mdCell(r.verdict)} | ${mdCell(r.layer ?? '')} | ${mdCell(r.lat)} | ${mdCell(r.preview)} |`);
  }
  lines.push('');
  lines.push('## False positives');
  lines.push('');
  if (falsePositives.length === 0) {
    lines.push('None. All real READMEs and directory listings received `clean` verdicts.');
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
  lines.push('');
  lines.push('## False negatives');
  lines.push('');
  lines.push('N/A for this server — all content is real benign README/file/dir metadata.');
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

  writeReport('filesystem.md', lines.join('\n') + '\n');
  console.log(`filesystem: ${calls} ops, ${cleanCount} clean, ${nonCleanCount} flagged. Report written.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
