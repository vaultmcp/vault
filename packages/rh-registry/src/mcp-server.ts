/// MCP server exposing the Vault safety registry as agent-queryable tools, over
/// stdio as JSON-RPC 2.0. Intended to be wrapped by Vault's proxy just like any
/// other MCP server:
///
///     npx @aimcpvault/mcp-proxy -- tsx src/mcp-server.ts
///
/// FRAMING (hand-implemented, no SDK): newline-delimited JSON (NDJSON) — one
/// JSON-RPC object per line on stdin, one response line per request on stdout;
/// notifications (no "id") get no reply; diagnostics go to stderr only.
///
/// Methods: initialize, tools/list, tools/call. Unknown methods → -32601.

import { createInterface } from 'node:readline';
import { loadStore, type RegistryStore } from './store.js';
import { TOOLS, callRegistryTool } from './mcp-tools.js';

const PROTOCOL_VERSION = '2024-11-05';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}
type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: string | number | null; result: unknown }
  | { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string } };

const ok = (id: string | number | null, result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id, result });
const fail = (id: string | number | null, code: number, message: string): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  error: { code, message },
});

export function handle(store: RegistryStore, req: JsonRpcRequest): JsonRpcResponse | null {
  const id = req.id ?? null;
  const isNotification = req.id === undefined;

  switch (req.method) {
    case 'initialize':
      if (isNotification) return null;
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: '@vaultmcp/rh-registry', version: '0.0.1' },
        instructions:
          'Query the Vault MCP-server safety registry. Attestation is Base/EAS roadmap — ' +
          'entries are attestation-pending unless a real EAS reference exists.',
      });
    case 'notifications/initialized':
      return null;
    case 'tools/list':
      if (isNotification) return null;
      return ok(id, { tools: TOOLS });
    case 'tools/call': {
      if (isNotification) return null;
      const params = req.params ?? {};
      const name = params['name'];
      const args = (params['arguments'] as Record<string, unknown> | undefined) ?? {};
      if (typeof name !== 'string') return fail(id, -32602, 'invalid params: "name" must be a string');
      try {
        const result = callRegistryTool(store, name, args);
        return ok(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
          isError: false,
        });
      } catch (e) {
        return ok(id, {
          content: [{ type: 'text', text: `tool error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        });
      }
    }
    default:
      if (isNotification) return null;
      return fail(id, -32601, `method not found: ${req.method}`);
  }
}

function send(res: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(res) + '\n');
}

export function main(): void {
  const store = loadStore();
  process.stderr.write(`[rh-registry] MCP server up (${store.list().length} entries). NDJSON/JSON-RPC over stdio.\n`);
  const rl = createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      send(fail(null, -32700, 'parse error: invalid JSON'));
      return;
    }
    try {
      const res = handle(store, req);
      if (res) send(res);
    } catch (e) {
      send(fail(req.id ?? null, -32603, `internal error: ${e instanceof Error ? e.message : String(e)}`));
    }
  });
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) main();
