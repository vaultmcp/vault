/// Vault × Robinhood Chain — MCP-server safety registry, browser edition.
///
/// A zero-dependency Node http server (built-in http only) that serves the
/// registry as JSON and as a static status page. Mirrors packages/rh-demo's
/// web.ts: read the HTML once via readFileSync, serve it at `/`, and expose a
/// JSON endpoint the page (or any client) can consume.
///
/// Usage:
///   pnpm --filter @vaultmcp/rh-registry serve         # http://localhost:5179
///   PORT=8080 pnpm --filter @vaultmcp/rh-registry serve

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStore } from './store.js';

const PORT = Number(process.env.PORT ?? 5179);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(HERE, 'index.html'), 'utf8');

function main(): void {
  // Load once at boot; the registry is a static directory in this build.
  const store = loadStore();

  const srv = createServer((req, res) => {
    try {
      if (req.url === '/registry.json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(store.payload()));
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
    process.stdout.write(`vault rh-registry: http://localhost:${PORT}\n`);
  });
}

main();
