/// vault dashboard — single-file HTTP server that renders the local scan history.
/// Reads ~/.vault/scans.db (or --db <path>). Auto-refresh every 5s by default.
/// Dark theme matching the demo site aesthetic. No build step, no external assets.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { createScanStore, defaultDbPath, type ScanStore } from '../persistence/index.js';

export interface DashboardOptions {
  port?: number;
  host?: string;
  dbPath?: string;
  refreshSeconds?: number;
  /** Open browser automatically; defaults to true when stdout is a TTY. */
  openBrowser?: boolean;
}

const HELP = `vault dashboard — local HTTP dashboard for scan history

Usage:
  vault dashboard [flags]

Flags
  --port <n>          listen port (default 9876)
  --host <addr>       listen host (default 127.0.0.1)
  --db <path>         override DB path (default ~/.vault/scans.db)
  --refresh <sec>     auto-refresh interval (default 5)
  --no-open           do not open browser automatically
  --help, -h          this help

Reads scans recorded by the proxy when run with VAULT_PERSIST=1. Local-only;
never connects to any external service.
`;

export function parseDashboardArgs(argv: string[]): DashboardOptions & { help?: boolean } {
  const out: DashboardOptions & { help?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { out.help = true; continue; }
    if (a === '--port') { out.port = Number.parseInt(argv[++i]!, 10); continue; }
    if (a === '--host') { out.host = argv[++i]; continue; }
    if (a === '--db') { out.dbPath = argv[++i]; continue; }
    if (a === '--refresh') { out.refreshSeconds = Number.parseInt(argv[++i]!, 10); continue; }
    if (a === '--no-open') { out.openBrowser = false; continue; }
    if (a && a.startsWith('--')) throw new Error(`unknown flag: ${a}`);
  }
  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function renderIndex(refreshSeconds: number): string {
  const refresh = Math.max(1, refreshSeconds | 0);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>vault dashboard</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  background: #0a0e0a;
  color: #d1f5d1;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  margin: 0; padding: 24px;
  font-size: 13px; line-height: 1.5;
}
h1, h2 { font-weight: 600; color: #5fdc7c; margin: 0 0 12px; }
h1 { font-size: 18px; }
h2 { font-size: 14px; margin-top: 24px; }
header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 20px; border-bottom: 1px solid #1a2a1a; padding-bottom: 12px; }
header .status { font-size: 12px; color: #4a7a4a; }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }
.card { background: #0f150f; border: 1px solid #1a2a1a; border-radius: 4px; padding: 16px; }
.card .label { font-size: 11px; color: #4a7a4a; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
.card .value { font-size: 24px; font-weight: 600; }
.value.malicious { color: #ff6b6b; }
.value.suspicious { color: #ffce5c; }
.value.clean { color: #5fdc7c; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #1a2a1a; }
th { font-weight: 600; color: #5fdc7c; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
tr:hover td { background: #0f150f; }
.verdict { padding: 2px 6px; border-radius: 2px; font-size: 11px; font-weight: 600; }
.verdict.malicious { background: rgba(255, 107, 107, 0.15); color: #ff6b6b; }
.verdict.suspicious { background: rgba(255, 206, 92, 0.15); color: #ffce5c; }
.verdict.clean { background: rgba(95, 220, 124, 0.15); color: #5fdc7c; }
.tool { color: #87c5ee; }
.preview { color: #6a8a6a; font-size: 11px; max-width: 600px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
svg { display: block; }
.bar-clean { fill: #5fdc7c; }
.bar-suspicious { fill: #ffce5c; }
.bar-malicious { fill: #ff6b6b; }
.day-label { fill: #4a7a4a; font-size: 10px; font-family: inherit; }
footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #1a2a1a; font-size: 11px; color: #4a7a4a; }
.empty { padding: 24px; text-align: center; color: #4a7a4a; }
</style>
</head>
<body>
<header>
  <h1>vault dashboard</h1>
  <div class="status">auto-refresh: ${refresh}s · <span id="last-update">—</span></div>
</header>
<div id="root"><div class="empty">loading…</div></div>
<footer>
  vault is a local prompt-injection scanning proxy. Scans here came from your local DB.
  Nothing on this page leaves your machine.
</footer>
<script>
const REFRESH_MS = ${refresh * 1000};
const verdictClass = (v) => v === 'malicious' ? 'malicious' : v === 'suspicious' ? 'suspicious' : 'clean';
function fmtAge(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  if (s < 86400) return Math.floor(s/3600) + 'h ago';
  return Math.floor(s/86400) + 'd ago';
}
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}
function renderBars(byDay) {
  const w = 600, h = 120, gap = 4;
  if (byDay.length === 0) return el('div', { class: 'empty' }, 'no scans in window');
  const barW = Math.max(8, (w - gap * (byDay.length - 1)) / byDay.length);
  const max = Math.max(1, ...byDay.map((d) => d.clean + d.suspicious + d.malicious));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', w); svg.setAttribute('height', h + 20);
  byDay.forEach((d, i) => {
    const x = i * (barW + gap);
    let y = h;
    for (const [cls, n] of [['clean', d.clean], ['suspicious', d.suspicious], ['malicious', d.malicious]]) {
      if (n <= 0) continue;
      const segH = (n / max) * (h - 4);
      y -= segH;
      const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      r.setAttribute('x', x); r.setAttribute('y', y);
      r.setAttribute('width', barW); r.setAttribute('height', segH);
      r.setAttribute('class', 'bar-' + cls);
      svg.appendChild(r);
    }
    if (i % Math.max(1, Math.floor(byDay.length / 6)) === 0) {
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', x + barW / 2); t.setAttribute('y', h + 14);
      t.setAttribute('text-anchor', 'middle'); t.setAttribute('class', 'day-label');
      t.textContent = d.day.slice(5); // MM-DD
      svg.appendChild(t);
    }
  });
  return svg;
}
function render(data) {
  const root = document.getElementById('root');
  root.replaceChildren();
  const v = data.summary;
  const grid = el('div', { class: 'grid' },
    el('div', { class: 'card' },
      el('div', { class: 'label' }, 'malicious'),
      el('div', { class: 'value malicious' }, v.malicious),
    ),
    el('div', { class: 'card' },
      el('div', { class: 'label' }, 'suspicious'),
      el('div', { class: 'value suspicious' }, v.suspicious),
    ),
    el('div', { class: 'card' },
      el('div', { class: 'label' }, 'clean'),
      el('div', { class: 'value clean' }, v.clean),
    ),
  );
  root.append(grid);
  root.append(el('h2', {}, 'scans by day (last 30)'));
  root.append(renderBars(data.byDay));
  root.append(el('h2', {}, 'top tools'));
  if (data.topTools.length === 0) root.append(el('div', { class: 'empty' }, 'no scans yet'));
  else {
    const t = el('table', {});
    const thead = el('thead', {}, el('tr', {}, el('th', {}, 'tool'), el('th', {}, 'total'), el('th', {}, 'malicious')));
    const tbody = el('tbody', {}, ...data.topTools.map((r) =>
      el('tr', {},
        el('td', { class: 'tool' }, r.toolName),
        el('td', {}, String(r.total)),
        el('td', {}, String(r.malicious)),
      )
    ));
    t.append(thead, tbody);
    root.append(t);
  }
  root.append(el('h2', {}, 'recent scans (50)'));
  if (data.recent.length === 0) root.append(el('div', { class: 'empty' }, 'no scans'));
  else {
    const t = el('table', {});
    const thead = el('thead', {}, el('tr', {},
      el('th', {}, 'when'), el('th', {}, 'verdict'), el('th', {}, 'tool'),
      el('th', {}, 'layer'), el('th', {}, 'conf'), el('th', {}, 'preview'),
    ));
    const tbody = el('tbody', {}, ...data.recent.map((r) =>
      el('tr', {},
        el('td', {}, fmtAge(r.ts)),
        el('td', {}, el('span', { class: 'verdict ' + verdictClass(r.verdict) }, r.verdict)),
        el('td', { class: 'tool' }, r.toolName),
        el('td', {}, r.layer == null ? '—' : 'L' + r.layer),
        el('td', {}, r.confidence.toFixed(2)),
        el('td', { class: 'preview' }, (r.contentPreview || '').replace(/\\n+/g, ' ')),
      )
    ));
    t.append(thead, tbody);
    root.append(t);
  }
  document.getElementById('last-update').textContent = new Date().toLocaleTimeString();
}
async function tick() {
  try {
    const r = await fetch('/api/data');
    const data = await r.json();
    render(data);
  } catch (e) {
    document.getElementById('root').textContent = 'failed to load: ' + e.message;
  }
}
tick();
setInterval(tick, REFRESH_MS);
</script>
</body>
</html>`;
}

export interface DashboardData {
  summary: { clean: number; suspicious: number; malicious: number; total: number; dbPath: string };
  byDay: Array<{ day: string; clean: number; suspicious: number; malicious: number }>;
  topTools: Array<{ toolName: string; total: number; malicious: number }>;
  recent: Array<{
    ts: number; verdict: string; toolName: string; layer: number | null;
    confidence: number; contentPreview: string; serverKey: string;
  }>;
}

export function buildDashboardData(store: ScanStore): DashboardData {
  const summary = store.countByVerdict();
  const total = store.total();
  return {
    summary: { ...summary, total, dbPath: store.dbPath ?? '' },
    byDay: store.countByDay(30),
    topTools: store.topTools(10),
    recent: store.list({ limit: 50 }).map((r) => ({
      ts: r.ts,
      verdict: r.verdict,
      toolName: r.toolName,
      layer: r.layer,
      confidence: r.confidence,
      contentPreview: r.contentPreview,
      serverKey: r.serverKey,
    })),
  };
}

export function makeDashboardHandler(store: ScanStore, refreshSeconds: number) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('method not allowed');
      return;
    }
    if (url === '/' || url === '/index.html') {
      const body = renderIndex(refreshSeconds);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(body);
      return;
    }
    if (url === '/api/data' || url.startsWith('/api/data?')) {
      const data = buildDashboardData(store);
      const body = JSON.stringify(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
      return;
    }
    if (url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, dbPath: store.dbPath }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  };
}

export function runDashboardCli(argv: string[]): number {
  let parsed: DashboardOptions & { help?: boolean };
  try {
    parsed = parseDashboardArgs(argv);
  } catch (err) {
    process.stderr.write(`vault dashboard: ${err instanceof Error ? err.message : String(err)}\n`);
    process.stderr.write(HELP);
    return 2;
  }
  if (parsed.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const dbPath = parsed.dbPath ?? process.env.VAULT_PERSIST_PATH ?? defaultDbPath();
  if (!existsSync(dbPath)) {
    process.stderr.write(`vault dashboard: no scan database at ${dbPath}\n`);
    process.stderr.write(`  Run vault with VAULT_PERSIST=1 first.\n`);
    return 1;
  }

  const store = createScanStore({ enabled: true, dbPath, retentionDays: 0 });
  if (!store.enabled) {
    process.stderr.write(`vault dashboard: failed to open ${dbPath}\n`);
    return 1;
  }

  const port = parsed.port ?? 9876;
  const host = parsed.host ?? '127.0.0.1';
  const refresh = parsed.refreshSeconds ?? 5;

  const server = createServer(makeDashboardHandler(store, refresh));
  server.listen(port, host, () => {
    const url = `http://${host}:${port}`;
    process.stdout.write(`vault dashboard: ${url}\n`);
    process.stdout.write(`  serving ${dbPath} (${store.total()} scans, refresh=${refresh}s)\n`);
    process.stdout.write(`  Ctrl-C to stop\n`);
  });

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      server.close(() => {
        try { store.close(); } catch { /* ignore */ }
        process.exit(0);
      });
    });
  }
  return 0;
}
