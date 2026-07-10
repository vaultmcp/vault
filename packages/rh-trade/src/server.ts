/// A minimal MCP (Model Context Protocol) server for Robinhood Chain trading, spoken
/// over stdio as JSON-RPC 2.0. Intended to be wrapped by Vault's proxy:
///
///     npx @aimcpvault/mcp-proxy -- tsx src/server.ts
///
/// FRAMING (documented, implemented by hand — no @modelcontextprotocol/sdk):
///   - Each JSON-RPC message is a single UTF-8 JSON object on ONE line, terminated
///     by a newline ('\n'). i.e. newline-delimited JSON (NDJSON) over stdin/stdout.
///   - We read stdin, split on '\n', and parse each non-empty line as one request.
///   - Every response is JSON.stringify'd (no embedded newlines) and written followed
///     by a single '\n'. One request line -> one response line.
///   - Notifications (requests without an "id") get no response, per JSON-RPC 2.0.
///   - Diagnostics go to stderr ONLY; stdout carries protocol traffic exclusively.
///
/// Methods handled: initialize, tools/list, tools/call. Unknown methods return a
/// JSON-RPC -32601 error.

import { createInterface } from 'node:readline';
import { TOOLS, callTool } from './tools.js';
import { ROBINHOOD_CHAIN, isPlaceholderChain } from './chain.js';

const PROTOCOL_VERSION = '2024-11-05';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: string | number | null;
  result: unknown;
}

interface JsonRpcError {
  jsonrpc: '2.0';
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

function ok(id: string | number | null, result: unknown): JsonRpcSuccess {
  return { jsonrpc: '2.0', id, result };
}

function err(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcError {
  return { jsonrpc: '2.0', id, error: { code, message, data } };
}

/// Routes a single parsed request to a response, or null for a notification.
async function handle(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null;
  const isNotification = req.id === undefined;

  switch (req.method) {
    case 'initialize': {
      if (isNotification) return null;
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: '@vaultmcp/rh-trade', version: '0.0.1' },
        instructions:
          isPlaceholderChain()
            ? 'Running against PLACEHOLDER Robinhood Chain config. execute_swap is dry-run only.'
            : `Connected to ${ROBINHOOD_CHAIN.name}.`,
      });
    }
    case 'notifications/initialized':
      // Client's post-initialize notification. No response.
      return null;
    case 'tools/list': {
      if (isNotification) return null;
      return ok(id, { tools: TOOLS });
    }
    case 'tools/call': {
      const params = req.params ?? {};
      const name = params['name'];
      const args = (params['arguments'] as Record<string, unknown> | undefined) ?? {};
      if (typeof name !== 'string') {
        return err(id, -32602, 'invalid params: "name" must be a string');
      }
      try {
        const result = await callTool(name, args);
        // MCP tools/call result shape: content[] plus a structured echo.
        return ok(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
          isError: false,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        // Tool errors are reported as an isError result, not a protocol error, so the
        // client/agent can read them — matching MCP's execution-error convention.
        return ok(id, {
          content: [{ type: 'text', text: `tool error: ${message}` }],
          isError: true,
        });
      }
    }
    default: {
      if (isNotification) return null;
      return err(id, -32601, `method not found: ${req.method}`);
    }
  }
}

/// Writes one response as a single NDJSON line to stdout.
function send(res: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(res) + '\n');
}

function log(msg: string): void {
  process.stderr.write(`[rh-trade] ${msg}\n`);
}

/// Starts the stdio read loop. Exported so tests can drive it if desired, but tests
/// primarily exercise tools.ts / handle() directly.
export function main(): void {
  log(
    `rh-trade MCP server up. chain=${ROBINHOOD_CHAIN.name} placeholder=${isPlaceholderChain()}. NDJSON/JSON-RPC over stdio.`,
  );
  const rl = createInterface({ input: process.stdin });

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;

    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      // Parse error: id unknown per JSON-RPC 2.0.
      send(err(null, -32700, 'parse error: invalid JSON'));
      return;
    }

    // Serialize handling per line to keep stdout ordering deterministic.
    void handle(req)
      .then((res) => {
        if (res) send(res);
      })
      .catch((e) => {
        const message = e instanceof Error ? e.message : String(e);
        send(err(req.id ?? null, -32603, `internal error: ${message}`));
      });
  });

  rl.on('close', () => {
    log('stdin closed, exiting.');
  });
}

// Run when invoked directly (tsx src/server.ts). Guarded so importing this module in
// tests does not start the read loop.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main();
}

export { handle };
