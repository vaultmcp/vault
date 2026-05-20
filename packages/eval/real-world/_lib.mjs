// Shared helpers for real-world MCP-server battery drivers.
//
// Each driver spawns `node packages/proxy/dist/index.js -- <upstream>` with
// VAULT_MODE=log, feeds JSON-RPC frames into stdin, captures stdout (responses)
// and stderr (vault verdict lines). We don't try to be a full MCP client — the
// protocol used here is the small subset needed to elicit tool responses.
//
// Verdict-line shapes emitted by Vault (see packages/proxy/src/transports/stdio.ts):
//   `vault: <verdict> (L<n>) response from '<tool>' (mode=log...)`  on non-clean
//   `vault: manifest <status> ...`                                  on init
//   `vault: capability-<verdict> ...`                               on agent->server
// Clean responses emit no verdict line; we record `clean` for those.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
export const PROXY_ENTRY = path.join(REPO_ROOT, 'packages', 'proxy', 'dist', 'index.js');
export const OUT_DIR = path.join(REPO_ROOT, 'packages', 'eval', 'real-world');

export function ensureOutDir() {
  mkdirSync(OUT_DIR, { recursive: true });
}

// Strip a known-noisy stderr prefix from upstream servers so summaries stay readable.
function isVaultLine(line) {
  return line.startsWith('vault: ');
}

/**
 * Run a single battery: spawn the proxy + upstream, send a sequence of
 * JSON-RPC frames, collect (id -> response) and (id -> verdict).
 *
 * @param {object} opts
 * @param {string} opts.upstreamCmd  - argv[0] for the wrapped MCP server
 * @param {string[]} opts.upstreamArgs - remaining argv
 * @param {object[]} opts.frames    - JSON-RPC frames to send IN ORDER. Each
 *                                    frame may include `_label` (string) and
 *                                    `_opType` ("call"|"list"|"init"|"notify").
 *                                    `_label` is stripped before sending.
 * @param {number} [opts.idleTimeoutMs=4000] - finish when no traffic for this long
 * @param {number} [opts.hardTimeoutMs=120000] - abort after this much wall time
 * @param {object} [opts.env]       - extra env vars
 * @returns {Promise<{frames: object[], responses: Map<number|string, object>, verdicts: Map<number|string, {verdict: string, layer: number|null, raw: string, latencyMs: number}>, stderrAll: string, manifestLines: string[]}>}
 */
export async function runBattery(opts) {
  const {
    upstreamCmd,
    upstreamArgs,
    frames,
    idleTimeoutMs = 4000,
    hardTimeoutMs = 120000,
    env: extraEnv = {},
  } = opts;

  const env = {
    ...process.env,
    VAULT_MODE: 'log',
    VAULT_TELEMETRY: '0',
    ...extraEnv,
  };
  // We must NOT inherit ANTHROPIC_API_KEY accidentally for this run; it's not
  // set in the sprint env anyway but be explicit.
  delete env.ANTHROPIC_API_KEY;

  const proxy = spawn(
    process.execPath,
    [PROXY_ENTRY, '--', upstreamCmd, ...upstreamArgs],
    { env, stdio: ['pipe', 'pipe', 'pipe'] },
  );

  const responses = new Map();
  const verdicts = new Map();
  const manifestLines = [];
  let stderrAll = '';

  // Latency: record send time per id so we can compute round-trip.
  const sendTime = new Map();

  // Buffer stdout into JSON lines.
  let stdoutBuf = '';
  proxy.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString('utf8');
    let nl;
    while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
      const line = stdoutBuf.slice(0, nl);
      stdoutBuf = stdoutBuf.slice(nl + 1);
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj && obj.id != null) {
          responses.set(obj.id, { obj, atMs: Date.now() });
        }
      } catch {
        // ignore non-JSON
      }
    }
    armIdle();
  });

  // Buffer stderr into lines so we can match verdict lines.
  // Last-seen tool name per id (from our send queue) lets us correlate verdicts.
  let stderrBuf = '';
  proxy.stderr.on('data', (chunk) => {
    const s = chunk.toString('utf8');
    stderrAll += s;
    stderrBuf += s;
    let nl;
    while ((nl = stderrBuf.indexOf('\n')) >= 0) {
      const line = stderrBuf.slice(0, nl);
      stderrBuf = stderrBuf.slice(nl + 1);
      if (!isVaultLine(line)) continue;
      if (line.startsWith('vault: manifest ') || line.startsWith('vault: MANIFEST ')) {
        manifestLines.push(line);
        continue;
      }
      // Match: vault: <verdict> (L<n>) response from '<tool>' ...
      const m = line.match(/^vault:\s+(\S+)\s+\(L(\d+|\?)\)\s+response from '([^']+)'/);
      if (m) {
        // Attach to the most recent pending tool call for this tool name
        // that has no verdict yet. Best-effort.
        const verdict = m[1];
        const layer = m[2] === '?' ? null : Number.parseInt(m[2], 10);
        const tool = m[3];
        // Find the most recent send for this tool with no verdict.
        let bestId = null;
        let bestT = -Infinity;
        for (const [id, info] of sendTime) {
          if (verdicts.has(id)) continue;
          if (info.tool !== tool) continue;
          if (info.sentAt > bestT) { bestT = info.sentAt; bestId = id; }
        }
        if (bestId != null) {
          verdicts.set(bestId, {
            verdict,
            layer,
            raw: line,
            latencyMs: Date.now() - bestT,
          });
        }
      }
    }
    armIdle();
  });

  // Idle-timeout based completion.
  let idleTimer = null;
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  function armIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => resolveDone('idle'), idleTimeoutMs);
  }
  armIdle();
  const hardTimer = setTimeout(() => resolveDone('hard-timeout'), hardTimeoutMs);

  proxy.on('exit', () => resolveDone('exit'));
  proxy.on('error', (e) => {
    stderrAll += `\n[driver] proxy spawn error: ${e.message}\n`;
    resolveDone('error');
  });

  // Send frames serially with a tiny stagger so the proxy can correlate ids.
  for (const frame of frames) {
    const { _label, _opType, ...rest } = frame;
    if (rest.id != null && rest.method === 'tools/call') {
      const tool = rest.params?.name ?? 'unknown';
      sendTime.set(rest.id, { sentAt: Date.now(), tool, label: _label });
    } else if (rest.id != null) {
      sendTime.set(rest.id, { sentAt: Date.now(), tool: rest.method ?? 'meta', label: _label });
    }
    proxy.stdin.write(JSON.stringify(rest) + '\n');
    // small stagger to keep ordering stable
    await new Promise((r) => setTimeout(r, 25));
  }

  const reason = await done;
  clearTimeout(hardTimer);
  if (idleTimer) clearTimeout(idleTimer);
  try { proxy.stdin.end(); } catch {}
  try { proxy.kill('SIGTERM'); } catch {}
  // give it a beat to flush
  await new Promise((r) => setTimeout(r, 200));

  return { frames, responses, verdicts, sendTime, manifestLines, stderrAll, reason };
}

/** Compact a tool response into a single short preview string. */
export function responsePreview(respObj, maxLen = 140) {
  if (!respObj) return '<no response>';
  if (respObj.error) {
    return `ERROR ${respObj.error.code}: ${(respObj.error.message ?? '').slice(0, maxLen)}`;
  }
  const r = respObj.result;
  if (!r) return '<no result>';
  if (r.content && Array.isArray(r.content)) {
    const text = r.content
      .map((c) => (typeof c.text === 'string' ? c.text : `[${c.type}]`))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
  }
  const j = JSON.stringify(r);
  return j.length > maxLen ? j.slice(0, maxLen) + '…' : j;
}

/** Summarise op args into a short string for the table. */
export function argsSummary(args, maxLen = 60) {
  if (args == null) return '';
  const j = JSON.stringify(args);
  return j.length > maxLen ? j.slice(0, maxLen) + '…' : j;
}

/** Markdown-escape pipe characters in table cells. */
export function mdCell(s) {
  return String(s ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

export function writeReport(filename, content) {
  ensureOutDir();
  writeFileSync(path.join(OUT_DIR, filename), content, 'utf8');
}
