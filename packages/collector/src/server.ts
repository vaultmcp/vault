/// Native Node HTTP server. Three routes plus /health. No frameworks, no deps.

import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Store } from './store.js';

export interface ServerOptions {
  store: Store;
  secret?: string;
  corsOrigin?: string;
  maxBodyBytes?: number;
}

const DEFAULT_MAX_BODY = 1024 * 1024; // 1 MB per ingest batch

function send(res: ServerResponse, status: number, body: unknown, cors?: string): void {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cors) {
    headers['Access-Control-Allow-Origin'] = cors;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage, max: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > max) {
        req.destroy();
        reject(new Error('body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (raw.length === 0) return resolve({});
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function authorized(req: IncomingMessage, secret?: string): boolean {
  if (!secret) return true;
  const header = req.headers.authorization;
  if (typeof header !== 'string') return false;
  return header === `Bearer ${secret}`;
}

function parseQuery(url: string): Record<string, string> {
  const q: Record<string, string> = {};
  const idx = url.indexOf('?');
  if (idx === -1) return q;
  for (const piece of url.slice(idx + 1).split('&')) {
    if (!piece) continue;
    const [k, v] = piece.split('=');
    if (k) q[decodeURIComponent(k)] = v ? decodeURIComponent(v) : '';
  }
  return q;
}

export function createServer(opts: ServerOptions): Server {
  const { store, secret, corsOrigin } = opts;
  const max = opts.maxBodyBytes ?? DEFAULT_MAX_BODY;

  return createHttpServer(async (req, res) => {
    const url = req.url ?? '/';
    const path = url.split('?')[0] ?? '/';

    if (req.method === 'OPTIONS') {
      send(res, 204, {}, corsOrigin);
      return;
    }

    if (path === '/health' && req.method === 'GET') {
      send(res, 200, { ok: true, size: store.size() }, corsOrigin);
      return;
    }

    if (path === '/ingest' && req.method === 'POST') {
      if (!authorized(req, secret)) {
        send(res, 401, { error: 'unauthorized' }, corsOrigin);
        return;
      }
      try {
        const body = (await readJson(req, max)) as { events?: unknown };
        if (!body || !Array.isArray(body.events)) {
          send(res, 400, { error: 'expected { events: [...] }' }, corsOrigin);
          return;
        }
        const accepted = store.ingest(body.events as any);
        send(res, 200, { accepted, rejected: body.events.length - accepted }, corsOrigin);
      } catch (err) {
        send(res, 400, { error: err instanceof Error ? err.message : String(err) }, corsOrigin);
      }
      return;
    }

    if (path === '/feed' && req.method === 'GET') {
      const q = parseQuery(url);
      const type = (q.type as 'detection' | 'capability' | 'manifest' | undefined) || undefined;
      const verdict = (q.verdict as 'clean' | 'suspicious' | 'malicious' | undefined) || undefined;
      const limit = q.limit ? Math.min(200, Math.max(1, Number.parseInt(q.limit, 10) || 20)) : 20;
      const events = store.recent({ type, verdict, limit });
      send(res, 200, { events }, corsOrigin);
      return;
    }

    if (path === '/stats' && req.method === 'GET') {
      send(res, 200, store.stats(), corsOrigin);
      return;
    }

    send(res, 404, { error: 'not found' }, corsOrigin);
  });
}
