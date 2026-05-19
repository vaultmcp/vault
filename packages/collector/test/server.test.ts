import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createServer } from '../src/server.js';
import { createInMemoryStore } from '../src/store.js';

function startServer(opts: { secret?: string; corsOrigin?: string } = {}): {
  server: Server;
  baseUrl: string;
  store: ReturnType<typeof createInMemoryStore>;
} {
  const store = createInMemoryStore({ capacity: 100 });
  const server = createServer({ store, secret: opts.secret, corsOrigin: opts.corsOrigin });
  return new Promise<{
    server: Server;
    baseUrl: string;
    store: ReturnType<typeof createInMemoryStore>;
  }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}`, store });
    });
  }) as unknown as { server: Server; baseUrl: string; store: ReturnType<typeof createInMemoryStore> };
}

async function startServerAsync(opts: { secret?: string; corsOrigin?: string } = {}) {
  const store = createInMemoryStore({ capacity: 100 });
  const server = createServer({ store, secret: opts.secret, corsOrigin: opts.corsOrigin });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${addr.port}`, store };
}

describe('collector server', () => {
  let ctx: { server: Server; baseUrl: string; store: ReturnType<typeof createInMemoryStore> };

  afterEach(async () => {
    if (ctx?.server) await new Promise<void>((r) => ctx.server.close(() => r()));
  });

  it('GET /health returns ok', async () => {
    ctx = await startServerAsync();
    const r = await fetch(`${ctx.baseUrl}/health`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
  });

  it('POST /ingest accepts well-formed events', async () => {
    ctx = await startServerAsync();
    const r = await fetch(`${ctx.baseUrl}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        events: [
          {
            id: 'e1',
            ts: Date.now(),
            installId: 'inst',
            type: 'detection',
            verdict: 'malicious',
            toolName: 'read_file',
          },
          {
            id: 'e2',
            ts: Date.now(),
            installId: 'inst',
            type: 'capability',
            action: 'block',
            toolName: 'http_get',
          },
        ],
      }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.accepted).toBe(2);
    expect(ctx.store.size()).toBe(2);
  });

  it('POST /ingest rejects malformed payload', async () => {
    ctx = await startServerAsync();
    const r = await fetch(`${ctx.baseUrl}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wrong: 'shape' }),
    });
    expect(r.status).toBe(400);
  });

  it('GET /feed returns the most recent events newest-first', async () => {
    ctx = await startServerAsync();
    ctx.store.ingest([
      { id: 'a', ts: 1, installId: 'i', type: 'detection', verdict: 'clean' } as any,
      { id: 'b', ts: 2, installId: 'i', type: 'detection', verdict: 'malicious' } as any,
      { id: 'c', ts: 3, installId: 'i', type: 'manifest', status: 'drift' } as any,
    ]);
    const r = await fetch(`${ctx.baseUrl}/feed?limit=10`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.events.map((e: any) => e.id)).toEqual(['c', 'b', 'a']);
  });

  it('GET /feed?type=detection&verdict=malicious filters', async () => {
    ctx = await startServerAsync();
    ctx.store.ingest([
      { id: 'a', ts: 1, installId: 'i', type: 'detection', verdict: 'clean' } as any,
      { id: 'b', ts: 2, installId: 'i', type: 'detection', verdict: 'malicious' } as any,
      { id: 'c', ts: 3, installId: 'i', type: 'capability', action: 'block' } as any,
    ]);
    const r = await fetch(`${ctx.baseUrl}/feed?type=detection&verdict=malicious`);
    const body = await r.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].id).toBe('b');
  });

  it('GET /stats returns aggregates', async () => {
    ctx = await startServerAsync();
    ctx.store.ingest([
      { id: 'a', ts: Date.now(), installId: 'i', type: 'detection', verdict: 'malicious' } as any,
      { id: 'b', ts: Date.now(), installId: 'i', type: 'detection', verdict: 'clean' } as any,
    ]);
    const r = await fetch(`${ctx.baseUrl}/stats`);
    const body = await r.json();
    expect(body.total).toBe(2);
    expect(body.byType.detection).toBe(2);
    expect(body.byVerdict.malicious).toBe(1);
  });

  it('rejects unauthenticated requests when secret is configured', async () => {
    ctx = await startServerAsync({ secret: 'topsecret' });
    const unauth = await fetch(`${ctx.baseUrl}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: [] }),
    });
    expect(unauth.status).toBe(401);

    const auth = await fetch(`${ctx.baseUrl}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer topsecret' },
      body: JSON.stringify({ events: [] }),
    });
    expect(auth.status).toBe(200);
  });

  it('emits CORS headers when configured', async () => {
    ctx = await startServerAsync({ corsOrigin: 'https://demo.vault.example' });
    const r = await fetch(`${ctx.baseUrl}/health`);
    expect(r.headers.get('access-control-allow-origin')).toBe('https://demo.vault.example');
  });

  it('returns 404 for unknown routes', async () => {
    ctx = await startServerAsync();
    const r = await fetch(`${ctx.baseUrl}/does-not-exist`);
    expect(r.status).toBe(404);
  });
});
