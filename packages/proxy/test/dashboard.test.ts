import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createScanStore, type ScanStore } from '../src/persistence/store.js';
import {
  buildDashboardData,
  makeDashboardHandler,
  parseDashboardArgs,
  renderIndex,
} from '../src/cli/dashboard.js';

let tmpDir: string;
let store: ScanStore;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'vault-dash-'));
  store = createScanStore({ enabled: true, dbPath: path.join(tmpDir, 'scans.db'), retentionDays: 0 });
  for (let i = 0; i < 5; i++) {
    store.insert({
      serverKey: 'stdio:npx:test', transport: 'stdio', toolName: 'read_file',
      verdict: 'clean', layer: 2, confidence: 0.4, patterns: [],
      contentHash: 'h', rawText: `benign ${i}`, reasoning: null, mode: 'block', mutated: false,
    });
  }
  store.insert({
    serverKey: 'stdio:npx:test', transport: 'stdio', toolName: 'eval',
    verdict: 'malicious', layer: 1, confidence: 0.99, patterns: ['instruction_override'],
    contentHash: 'h', rawText: 'ignore previous', reasoning: 'L1', mode: 'block', mutated: true,
  });

  server = createServer(makeDashboardHandler(store, 5));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try { store.close(); } catch {}
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('dashboard — arg parsing', () => {
  it('parses --port, --host, --refresh', () => {
    const opts = parseDashboardArgs(['--port', '8000', '--host', '0.0.0.0', '--refresh', '10']);
    expect(opts.port).toBe(8000);
    expect(opts.host).toBe('0.0.0.0');
    expect(opts.refreshSeconds).toBe(10);
  });

  it('parses --db and --no-open', () => {
    const opts = parseDashboardArgs(['--db', '/tmp/s.db', '--no-open']);
    expect(opts.dbPath).toBe('/tmp/s.db');
    expect(opts.openBrowser).toBe(false);
  });
});

describe('dashboard — renderIndex HTML', () => {
  it('embeds the configured refresh interval', () => {
    const html = renderIndex(15);
    expect(html).toContain('auto-refresh: 15s');
    expect(html).toContain('REFRESH_MS = 15000');
  });

  it('includes dark-theme styling', () => {
    const html = renderIndex(5);
    expect(html).toContain('color-scheme: dark');
    expect(html).toContain('#5fdc7c'); // signature green
  });
});

describe('dashboard — buildDashboardData', () => {
  it('returns summary + byDay + topTools + recent', () => {
    const data = buildDashboardData(store);
    expect(data.summary.total).toBe(6);
    expect(data.summary.clean).toBe(5);
    expect(data.summary.malicious).toBe(1);
    expect(data.byDay.length).toBeGreaterThan(0);
    expect(data.topTools[0]!.toolName).toBe('read_file');
    expect(data.recent.length).toBeGreaterThan(0);
  });
});

describe('dashboard — HTTP endpoints', () => {
  it('GET / returns HTML page', async () => {
    const r = await fetch(`${baseUrl}/`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/html');
    const body = await r.text();
    expect(body).toContain('vault dashboard');
    expect(body).toContain('auto-refresh');
  });

  it('GET /api/data returns JSON dashboard payload', async () => {
    const r = await fetch(`${baseUrl}/api/data`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('application/json');
    const data = await r.json() as ReturnType<typeof buildDashboardData>;
    expect(data.summary.total).toBe(6);
    expect(data.summary.malicious).toBe(1);
    expect(data.recent).toBeInstanceOf(Array);
  });

  it('GET /health returns ok', async () => {
    const r = await fetch(`${baseUrl}/health`);
    const json = await r.json() as { ok: boolean };
    expect(json.ok).toBe(true);
  });

  it('GET unknown path returns 404', async () => {
    const r = await fetch(`${baseUrl}/bogus`);
    expect(r.status).toBe(404);
  });

  it('non-GET returns 405', async () => {
    const r = await fetch(`${baseUrl}/`, { method: 'POST' });
    expect(r.status).toBe(405);
  });
});
