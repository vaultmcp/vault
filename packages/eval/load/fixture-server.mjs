// Tiny stub MCP server for load testing. Responds to initialize / tools/list / tools/call
// immediately with a small (~200 char) clean text response. Echoes the JSON-RPC id back.
//
// Run via: node fixture-server.mjs
// It speaks the same JSON-RPC-over-stdio protocol the proxy expects.

import { createInterface } from 'node:readline';

const CLEAN_TEXT =
  'OK. The requested operation completed successfully. ' +
  'No anomalies detected. ' +
  'Returning a small clean payload for load-test purposes. ' +
  'This text is approximately two hundred characters in total length.';

const rl = createInterface({ input: process.stdin });

function reply(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

rl.on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  if (msg.method === 'initialize') {
    reply({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'vault-loadtest-fixture', version: '0.0.0' },
      },
    });
    return;
  }

  if (msg.method === 'tools/list') {
    reply({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        tools: [
          {
            name: 'ping',
            description: 'returns a small clean text response',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      },
    });
    return;
  }

  if (msg.method === 'tools/call') {
    reply({
      jsonrpc: '2.0',
      id: msg.id,
      result: { content: [{ type: 'text', text: CLEAN_TEXT }], isError: false },
    });
    return;
  }

  // Unknown — echo back JSON-RPC error
  reply({
    jsonrpc: '2.0',
    id: msg.id,
    error: { code: -32601, message: 'Method not found' },
  });
});

rl.on('close', () => process.exit(0));
