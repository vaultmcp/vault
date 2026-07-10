/// End-to-end: the trade guard enforcing policy on live MCP traffic through the proxy.
/// Mirrors capability-integration.test.ts. The proxy gates a swap call BEFORE forwarding
/// it to the child, so the fixture server needs no swap tool of its own.

import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '..');
const PROXY_ENTRY = path.join(PKG_ROOT, 'src/index.ts');
const FIXTURE = path.join(PKG_ROOT, 'test/fixture-mcp-server.mjs');

const GOOD = '0x1111111111111111111111111111111111111111';
const ATTACKER = '0xBAD00dEADbeef00000000000000000000000ATTACK';

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: any;
  error?: any;
}

function startProxy(env: Record<string, string> = {}) {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', PROXY_ENTRY, '--', process.execPath, FIXTURE],
    { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } },
  ) as ChildProcessWithoutNullStreams;

  const stderr: string[] = [];
  child.stderr.on('data', (c: Buffer) => stderr.push(c.toString('utf8')));

  const rl: Interface = createInterface({ input: child.stdout });
  const queue: JsonRpcResponse[] = [];
  const waiters: Array<(r: JsonRpcResponse) => void> = [];
  rl.on('line', (line) => {
    try {
      const msg = JSON.parse(line) as JsonRpcResponse;
      if (waiters.length > 0) waiters.shift()!(msg);
      else queue.push(msg);
    } catch {
      /* non-JSON */
    }
  });

  return {
    stderr,
    send: (msg: unknown) => child.stdin.write(JSON.stringify(msg) + '\n'),
    next: () =>
      new Promise<JsonRpcResponse>((resolve, reject) => {
        if (queue.length > 0) return resolve(queue.shift()!);
        const t = setTimeout(() => reject(new Error('timeout')), 20000);
        waiters.push((r) => {
          clearTimeout(t);
          resolve(r);
        });
      }),
    close: () => {
      rl.close();
      child.kill();
    },
  };
}

describe('trade guard — end-to-end through the proxy', () => {
  let proxy: ReturnType<typeof startProxy>;
  afterEach(() => proxy?.close());

  it('off by default: a swap to any recipient passes through', async () => {
    proxy = startProxy();
    proxy.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'execute_swap', arguments: { recipient: ATTACKER, amount: '1000' } },
    });
    const r = await proxy.next();
    expect(r.result.content[0].text).not.toMatch(/VAULT_CAPABILITY_BLOCKED/);
  }, 30000);

  it('VAULT_TRADE_GUARD=1: swap to a non-allowlisted recipient is blocked', async () => {
    proxy = startProxy({ VAULT_TRADE_GUARD: '1', VAULT_TRADE_ALLOWLIST: GOOD });
    proxy.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'execute_swap', arguments: { recipient: ATTACKER, amount: '1000' } },
    });
    const r = await proxy.next();
    expect(r.id).toBe(2);
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toMatch(/\[VAULT_CAPABILITY_BLOCKED\]/);
    expect(r.result.content[0].text).toMatch(/execute_swap/);
  }, 30000);

  it('VAULT_TRADE_GUARD=1: swap to an allowlisted recipient passes through', async () => {
    proxy = startProxy({ VAULT_TRADE_GUARD: '1', VAULT_TRADE_ALLOWLIST: GOOD });
    proxy.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'execute_swap', arguments: { recipient: GOOD, amount: '1000' } },
    });
    const r = await proxy.next();
    expect(r.result.content[0].text).not.toMatch(/VAULT_CAPABILITY_BLOCKED/);
  }, 30000);
});
