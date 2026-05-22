#!/usr/bin/env node
/**
 * One-time launch-day seeding script. Runs real scans through the proxy using public
 * corpus payloads. Documented in NOTES_FOR_YV.md.
 *
 * What it does:
 *  - Picks 12 attack payloads from packages/corpus/injection-patterns.json (2 per category,
 *    6 categories). NEVER from any holdout — corpus only.
 *  - Synthesizes 8 plausible benign tool responses (weather, file listing, HTTP status,
 *    commit notes, etc. — not drawn from any dataset).
 *  - Writes each as a real file in /tmp/vault-seed-target/.
 *  - Spawns the published proxy from npm (`@aimcpvault/mcp-proxy@next`) wrapping
 *    @modelcontextprotocol/server-filesystem against that directory.
 *  - Drives 20 real tools/call `read_file` requests through the proxy with random
 *    10–30s spacing (total ~5–10 min). The proxy genuinely scans each response,
 *    produces a real verdict, and POSTs the telemetry batch to the collector
 *    at VAULT_TELEMETRY_URL=http://98.80.190.10/ingest. No direct /ingest writes.
 *
 * Discipline:
 *  - Corpus payloads only. Holdout reads are forbidden (see POSTMORTEM-2026-05-20).
 *  - No synthetic events POSTed to the collector. Every panel row corresponds to a real
 *    scan verdict the proxy produced from a real tool response.
 *
 * Usage:
 *   node scripts/seed-launch-traffic.mjs
 *
 * Expected runtime: ~6-10 min. Tail stderr to watch verdicts as they fire.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// ── Inputs ─────────────────────────────────────────────────────────────────

const CORPUS_PATH = path.join(REPO_ROOT, 'packages/corpus/injection-patterns.json');
// Use a path under $HOME so macOS's /tmp → /private/tmp realpath aliasing doesn't trip up
// @modelcontextprotocol/server-filesystem's allowlist check (it rejects paths after
// canonicalization if the canonical form doesn't match the allowlist directory).
const SEED_DIR = realpathSync.native?.(os.tmpdir())
  ? path.join(realpathSync.native(os.tmpdir()), 'vault-seed-target')
  : path.join(os.homedir(), '.vault-seed-target');
const COLLECTOR_INGEST = 'http://98.80.190.10/ingest';

const BENIGN_PAYLOADS = [
  { id: 'benign-weather', text: 'The current temperature in San Francisco is 64°F with partly cloudy skies. Humidity is 72% and wind speed is 12 mph from the southwest. UV index is 3 (moderate).' },
  { id: 'benign-fs-listing', text: 'Listing /var/log: syslog (12 MB), nginx/access.log (303 KB), nginx/error.log (8 KB), auth.log (45 KB). Most recent modification: 2026-05-22 10:14 UTC.' },
  { id: 'benign-http-status', text: 'HTTP 200 OK. Content-Type: application/json. Content-Length: 4892. Response body: { "ok": true, "items": [...] }' },
  { id: 'benign-commit-log', text: 'commit 7045d7a — chore: bump version to 0.2.0-rc.1 for release. Author: vault. Date: 2026-05-21 23:21 PT.' },
  { id: 'benign-db-result', text: 'Query returned 14 rows in 82 ms. Columns: user_id (int), email (text), created_at (timestamp). First row: 1, alice@example.com, 2026-05-01T10:00:00Z.' },
  { id: 'benign-pkg-info', text: 'Package @aimcpvault/mcp-proxy@0.2.0-rc.1: MCP prompt-injection scanning proxy. License MIT. 12 files. Unpacked size 511.6 kB.' },
  { id: 'benign-cal-event', text: 'Upcoming events on your calendar: 11:00 — standup (zoom), 14:00 — design review with @yv, 17:30 — gym. No conflicts detected.' },
  { id: 'benign-readme', text: 'README updated to reflect 0.2.0-rc.1 release. New sections: Ollama operation, on-chain reputation inspector, local scan history (opt-in). Tests passing 415/415.' },
];

// ── Picker — 2 from each of the 6 attack categories, corpus only ──────────

function pickAttackPayloads() {
  const corpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf8'));
  const byCategory = new Map();
  for (const entry of corpus) {
    if (!byCategory.has(entry.category)) byCategory.set(entry.category, []);
    byCategory.get(entry.category).push(entry);
  }
  const picks = [];
  for (const [category, entries] of [...byCategory.entries()].sort()) {
    // Deterministic: take the first two from each category. No randomness in the picker —
    // we want the seed to be reproducible if yv ever needs to re-run.
    picks.push({ id: entries[0].id, text: entries[0].text, category });
    picks.push({ id: entries[1].id, text: entries[1].text, category });
  }
  return picks;
}

// ── Setup ──────────────────────────────────────────────────────────────────

function setupSeedDir(payloads) {
  rmSync(SEED_DIR, { recursive: true, force: true });
  mkdirSync(SEED_DIR, { recursive: true });
  for (const p of payloads) {
    writeFileSync(path.join(SEED_DIR, `${p.id}.txt`), p.text, 'utf8');
  }
  console.log(`[seed] wrote ${payloads.length} payloads to ${SEED_DIR}`);
}

// ── Drive ──────────────────────────────────────────────────────────────────

function randDelayMs() {
  // 10–30 s, biased slightly toward the lower end so total stays ~5–10 min
  return 10_000 + Math.floor(Math.random() * 20_000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const attacks = pickAttackPayloads();
  // Interleave attacks + benign so the feed shows mixed verdicts
  const all = [];
  for (let i = 0; i < Math.max(attacks.length, BENIGN_PAYLOADS.length); i++) {
    if (i < attacks.length) all.push(attacks[i]);
    if (i < BENIGN_PAYLOADS.length) all.push(BENIGN_PAYLOADS[i]);
  }
  console.log(`[seed] total payloads: ${all.length} (${attacks.length} attack from corpus + ${BENIGN_PAYLOADS.length} benign synthetic)`);

  setupSeedDir(all);

  console.log('[seed] spawning proxy (npx @aimcpvault/mcp-proxy@next wrapping server-filesystem)...');
  const proxy = spawn(
    'npx',
    ['--yes', '@aimcpvault/mcp-proxy@next', '--', 'npx', '-y', '@modelcontextprotocol/server-filesystem', SEED_DIR],
    {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: {
        ...process.env,
        VAULT_TELEMETRY_URL: COLLECTOR_INGEST,
        VAULT_TELEMETRY_BATCH: '1',           // flush immediately so panel updates as we go
        VAULT_TELEMETRY_FLUSH_MS: '2000',
        VAULT_MODE: 'log',                    // observe, don't block (so the response goes through cleanly)
        NO_COLOR: '1',
      },
    },
  );

  proxy.on('error', (err) => {
    console.error('[seed] proxy spawn error:', err.message);
    process.exit(1);
  });

  // Capture proxy stdout (JSON-RPC responses)
  let buf = '';
  proxy.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id != null && msg.result) {
          // tool-call response landed — we don't need to do anything else here, the proxy
          // has already scanned and pushed telemetry. Just log the id for visibility.
          console.log(`[seed] response id=${msg.id}`);
        }
      } catch { /* ignore non-JSON lines */ }
    }
  });

  function send(msg) {
    proxy.stdin.write(JSON.stringify(msg) + '\n');
  }

  // Initialize
  send({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'seed', version: '0' } } });
  await sleep(2000);
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  await sleep(500);

  // Drive 20 read_file calls
  for (let i = 0; i < all.length; i++) {
    const p = all[i];
    const delay = randDelayMs();
    console.log(`[seed] ${i + 1}/${all.length} — calling read_file for ${p.id} (then ${(delay / 1000).toFixed(0)}s sleep)`);
    send({
      jsonrpc: '2.0',
      id: i + 1,
      method: 'tools/call',
      params: { name: 'read_text_file', arguments: { path: path.join(SEED_DIR, `${p.id}.txt`) } },
    });
    await sleep(delay);
  }

  console.log('[seed] all scans dispatched. Flushing telemetry + shutting down proxy gracefully (SIGINT)...');
  proxy.kill('SIGINT');

  // Give the proxy a moment to flush the telemetry queue before exit
  await sleep(3000);
  try { rmSync(SEED_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  console.log('[seed] done.');
}

main().catch((err) => {
  console.error('[seed] fatal:', err);
  process.exit(1);
});
