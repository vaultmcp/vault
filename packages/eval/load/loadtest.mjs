// Vault proxy load test. Spawns the proxy wrapping the fixture-server, then drives
// JSON-RPC tools/call requests through stdin/stdout at a target rate-per-second.
//
// Defaults are configurable via flags / env:
//   --target-rps   N    (default 100)
//   --duration     s    (default 600, ie. 10 minutes)
//   --sample-every s    (default 10)
//   --report       path (default packages/eval/load/report.md)
//
// We use the built dist file (packages/proxy/dist/index.js) so the load test reflects
// what users get from npx. If the dist is missing the script tells you to run pnpm build.
//
// Methodology: one proxy process. Many concurrent in-flight JSON-RPC ids. We schedule
// requests at the target rate using a small admission scheduler — we do NOT spawn 100
// concurrent HTTP clients. Latency is measured client-side (driver clock).

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROXY_DIST = path.resolve(__dirname, '../../proxy/dist/index.js');
const PROXY_SRC = path.resolve(__dirname, '../../proxy/src/index.ts');
const FIXTURE = path.resolve(__dirname, './fixture-server.mjs');

function parseArgs() {
  const argv = process.argv.slice(2);
  const out = { targetRps: 100, duration: 600, sampleEvery: 10, report: path.resolve(__dirname, './report.md') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target-rps') out.targetRps = Number(argv[++i]);
    else if (a === '--duration') out.duration = Number(argv[++i]);
    else if (a === '--sample-every') out.sampleEvery = Number(argv[++i]);
    else if (a === '--report') out.report = path.resolve(argv[++i]);
  }
  return out;
}

const args = parseArgs();
const TARGET_RPS = args.targetRps;
const DURATION_S = args.duration;
const SAMPLE_EVERY_S = args.sampleEvery;
const REPORT_PATH = args.report;

// Pick the proxy entry — prefer dist, fall back to running src via tsx import.
let proxyCmd, proxyArgs;
if (existsSync(PROXY_DIST)) {
  proxyCmd = process.execPath;
  proxyArgs = [PROXY_DIST, '--', process.execPath, FIXTURE];
} else if (existsSync(PROXY_SRC)) {
  proxyCmd = process.execPath;
  proxyArgs = ['--import', 'tsx', PROXY_SRC, '--', process.execPath, FIXTURE];
} else {
  console.error('ERROR: proxy not built and src not found. Run `pnpm --filter @vaultmcp/mcp-proxy build`.');
  process.exit(2);
}

// ────────────────────────────────────────────────────────────────────────────────
// Start the proxy
// ────────────────────────────────────────────────────────────────────────────────
// Use a minimal env that turns off telemetry/audit/attestation/capability so the
// load test reflects core scan throughput, not optional features.
const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  // Disable optional subsystems explicitly — defaults are already off but be explicit.
  VAULT_MODE: 'block',
  VAULT_MANIFEST_CHECK: 'on',
  VAULT_TELEMETRY: '0',
};

console.log(`[loadtest] spawning proxy: ${proxyCmd} ${proxyArgs.join(' ')}`);
const proxy = spawn(proxyCmd, proxyArgs, { stdio: ['pipe', 'pipe', 'pipe'], env });

let proxyCrashed = false;
let proxyCrashCode = null;
proxy.on('exit', (code, signal) => {
  proxyCrashed = true;
  proxyCrashCode = signal ? `signal:${signal}` : `code:${code}`;
  console.error(`[loadtest] proxy exited unexpectedly: ${proxyCrashCode}`);
});
proxy.stderr.on('data', (buf) => {
  // Echo stderr but truncate
  const s = buf.toString().split('\n').filter(Boolean).slice(0, 3).join(' | ');
  if (s) console.error(`[proxy stderr] ${s}`);
});

const inflight = new Map(); // id -> { sendAt, resolve }
let nextId = 1;
let totalSent = 0;
let totalReceived = 0;
let totalErrors = 0;
const latencies = []; // ms

const rl = createInterface({ input: proxy.stdout });
rl.on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id == null) return;
  const entry = inflight.get(msg.id);
  if (!entry) return;
  inflight.delete(msg.id);
  const elapsed = performance.now() - entry.sendAt;
  latencies.push(elapsed);
  totalReceived++;
  if (msg.error) totalErrors++;
  entry.resolve();
});

function sendRequest() {
  if (proxyCrashed) return null;
  const id = nextId++;
  const req = { jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'ping', arguments: {} } };
  const sendAt = performance.now();
  return new Promise((resolve) => {
    inflight.set(id, { sendAt, resolve });
    proxy.stdin.write(JSON.stringify(req) + '\n');
    totalSent++;
  });
}

// ────────────────────────────────────────────────────────────────────────────────
// Initialize handshake (best-effort; not strictly required for tools/call to be
// answered by the fixture, but we do it anyway to mirror real usage)
// ────────────────────────────────────────────────────────────────────────────────
async function handshake() {
  const id = 0;
  proxy.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'initialize', params: {} }) + '\n');
  // Wait briefly for proxy + fixture to settle
  await new Promise((r) => setTimeout(r, 1000));
}

// Compute p50/p95/p99 from a sample array (mutates sort; pass copies if needed).
function quantiles(arr) {
  if (arr.length === 0) return { p50: 0, p95: 0, p99: 0, max: 0 };
  const a = arr.slice().sort((x, y) => x - y);
  const q = (p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
  return { p50: q(0.5), p95: q(0.95), p99: q(0.99), max: a[a.length - 1] };
}

// Measure RSS of the proxy process via ps. Returns KB (number).
import { execSync } from 'node:child_process';
function rssKb(pid) {
  try {
    const out = execSync(`ps -o rss= -p ${pid}`, { encoding: 'utf8' }).trim();
    return Number(out) || 0;
  } catch {
    return 0;
  }
}
function cpuPct(pid) {
  try {
    const out = execSync(`ps -o %cpu= -p ${pid}`, { encoding: 'utf8' }).trim();
    return Number(out) || 0;
  } catch {
    return 0;
  }
}

// Samples taken every SAMPLE_EVERY_S seconds.
const samples = []; // { tSec, sent, received, errors, inflight, p50, p95, p99, rssKb, cpuPct }
let stopReason = null;

async function runLoad() {
  await handshake();
  console.log(`[loadtest] target ${TARGET_RPS} rps for ${DURATION_S}s, sampling every ${SAMPLE_EVERY_S}s`);
  const tStart = performance.now();
  const tEnd = tStart + DURATION_S * 1000;
  const intervalMs = 1000 / TARGET_RPS;
  let nextSendAt = tStart;
  let lastSampleAt = tStart;
  let lastLatenciesLen = 0;

  while (performance.now() < tEnd && !proxyCrashed) {
    const now = performance.now();
    if (now >= nextSendAt) {
      sendRequest();
      nextSendAt += intervalMs;
      if (now - nextSendAt > 1000) nextSendAt = now + intervalMs;
    } else {
      const sleepMs = Math.max(0, nextSendAt - now);
      await new Promise((r) => setTimeout(r, Math.min(sleepMs, 2)));
    }

    if (performance.now() - lastSampleAt >= SAMPLE_EVERY_S * 1000) {
      const tSec = Math.round((performance.now() - tStart) / 1000);
      const windowLatencies = latencies.slice(lastLatenciesLen);
      lastLatenciesLen = latencies.length;
      const wq = quantiles(windowLatencies);
      const sample = {
        tSec,
        sent: totalSent,
        received: totalReceived,
        errors: totalErrors,
        inflight: inflight.size,
        p50: Number(wq.p50.toFixed(1)),
        p95: Number(wq.p95.toFixed(1)),
        p99: Number(wq.p99.toFixed(1)),
        max: Number(wq.max.toFixed(1)),
        rssKb: rssKb(proxy.pid),
        cpuPct: cpuPct(proxy.pid),
      };
      samples.push(sample);
      console.log(
        `[${String(tSec).padStart(4, ' ')}s] sent=${sample.sent} recv=${sample.received} ` +
          `inflight=${sample.inflight} errors=${sample.errors} ` +
          `p50=${sample.p50}ms p95=${sample.p95}ms p99=${sample.p99}ms ` +
          `rss=${(sample.rssKb / 1024).toFixed(1)}MB cpu=${sample.cpuPct}%`,
      );
      lastSampleAt = performance.now();

      if (sample.p99 > 5000 && samples.length >= 4) {
        const last4 = samples.slice(-4);
        if (last4.every((s) => s.p99 > 5000)) {
          stopReason = `p99 > 5s sustained for >30s (last 4 samples: ${last4.map((s) => s.p99).join(', ')} ms)`;
          console.error(`[loadtest] cliff detected: ${stopReason}`);
          break;
        }
      }
    }
  }

  if (proxyCrashed) {
    stopReason = stopReason ?? `proxy exited (${proxyCrashCode})`;
  }

  // Drain any inflight responses for up to 10s
  console.log('[loadtest] draining inflight responses (up to 10s)...');
  const drainStart = performance.now();
  while (inflight.size > 0 && performance.now() - drainStart < 10000 && !proxyCrashed) {
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log(`[loadtest] inflight after drain: ${inflight.size}`);
}

async function main() {
  await runLoad();

  const overall = quantiles(latencies);
  const actualRps = totalReceived / DURATION_S;

  const report = renderReport({
    target: { rps: TARGET_RPS, durationS: DURATION_S, sampleEveryS: SAMPLE_EVERY_S },
    overall,
    actualRps,
    totalSent,
    totalReceived,
    totalErrors,
    samples,
    stopReason,
    cmd: `${proxyCmd} ${proxyArgs.join(' ')}`,
    env: Object.entries(env).map(([k, v]) => `${k}=${v}`).join(' '),
  });

  writeFileSync(REPORT_PATH, report);
  console.log(`[loadtest] wrote report to ${REPORT_PATH}`);

  try { proxy.stdin.end(); } catch {}
  try { proxy.kill(); } catch {}
  process.exit(0);
}

function renderReport(r) {
  const memMin = Math.min(...r.samples.map((s) => s.rssKb)) || 0;
  const memMax = Math.max(...r.samples.map((s) => s.rssKb)) || 0;
  const memFirst = r.samples[0]?.rssKb ?? 0;
  const memLast = r.samples[r.samples.length - 1]?.rssKb ?? 0;
  const memGrowthMb = ((memLast - memFirst) / 1024).toFixed(2);

  return `# Vault proxy load-test report

Generated ${new Date().toISOString()}

## Setup

\`\`\`
${r.cmd}
${r.env}
\`\`\`

- Target rate: **${r.target.rps} req/s**
- Duration: **${r.target.durationS} s**
- Sample interval: ${r.target.sampleEveryS} s
- Upstream: fixture-server (stub MCP server, ~200B clean response, no I/O)
- Proxy: single instance, JSON-RPC over stdio, all detection layers (L1+L2; L3 unconfigured)

## Results

| metric | value |
|---|---|
| sent | ${r.totalSent} |
| received | ${r.totalReceived} |
| errors | ${r.totalErrors} |
| sustained throughput | **${r.actualRps.toFixed(1)} req/s** (received / duration) |
| stop reason | ${r.stopReason ?? 'completed full duration'} |

### Latency (all samples, ms)

| metric | value |
|---|---|
| p50 | ${r.overall.p50.toFixed(1)} |
| p95 | ${r.overall.p95.toFixed(1)} |
| p99 | ${r.overall.p99.toFixed(1)} |
| max | ${r.overall.max.toFixed(1)} |

### Memory

- First sample RSS: ${(memFirst / 1024).toFixed(1)} MB
- Last sample RSS:  ${(memLast / 1024).toFixed(1)} MB
- Min RSS:          ${(memMin / 1024).toFixed(1)} MB
- Max RSS:          ${(memMax / 1024).toFixed(1)} MB
- Growth over run:  ${memGrowthMb} MB

### Per-sample data

| t (s) | sent | recv | errors | inflight | p50 | p95 | p99 | RSS (MB) | CPU% |
|---|---|---|---|---|---|---|---|---|---|
${r.samples
  .map(
    (s) =>
      `| ${s.tSec} | ${s.sent} | ${s.received} | ${s.errors} | ${s.inflight} | ${s.p50} | ${s.p95} | ${s.p99} | ${(s.rssKb / 1024).toFixed(1)} | ${s.cpuPct} |`,
  )
  .join('\n')}

## Recommendation

Vault is tested up to ${Math.round(r.actualRps)} req/s; beyond that, run multiple proxy instances behind a router or accept the latency curve above.
`;
}

main().catch((err) => {
  console.error('[loadtest] fatal:', err);
  try { proxy.kill(); } catch {}
  process.exit(1);
});
