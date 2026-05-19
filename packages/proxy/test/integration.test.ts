import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

function startProxy(mode?: string): {
  child: ChildProcessWithoutNullStreams;
  rl: Interface;
  send: (msg: unknown) => void;
  next: () => Promise<JsonRpcResponse>;
  close: () => void;
} {
  const env = { ...process.env };
  if (mode) env.VAULT_MODE = mode;

  const child = spawn(
    process.execPath,
    ['--import', 'tsx', PROXY_ENTRY, '--', process.execPath, FIXTURE],
    { stdio: ['pipe', 'pipe', 'pipe'], env },
  ) as ChildProcessWithoutNullStreams;

  // Drain stderr to dev/null but keep accessible for debugging.
  child.stderr.on('data', () => {});

  const rl = createInterface({ input: child.stdout });
  const queue: JsonRpcResponse[] = [];
  const waiters: Array<(r: JsonRpcResponse) => void> = [];

  rl.on('line', (line) => {
    try {
      const msg = JSON.parse(line) as JsonRpcResponse;
      if (waiters.length > 0) waiters.shift()!(msg);
      else queue.push(msg);
    } catch {
      // ignore non-JSON lines
    }
  });

  return {
    child,
    rl,
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

describe('mcp-proxy integration', () => {
  let proxy: ReturnType<typeof startProxy>;

  afterEach(() => {
    proxy?.close();
  });

  it('passes initialize and tools/list through unchanged', async () => {
    proxy = startProxy();
    proxy.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    const init = await proxy.next();
    expect(init.id).toBe(1);
    expect(init.result.serverInfo.name).toBe('vault-fixture');

    proxy.send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const list = await proxy.next();
    expect(list.result.tools[0].name).toBe('read_file');
  });

  it('passes clean tool-call response through unchanged', async () => {
    proxy = startProxy();
    proxy.send({
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: { name: 'read_file', arguments: { path: 'clean.txt' } },
    });
    const r = await proxy.next();
    expect(r.id).toBe(10);
    expect(r.result.isError).toBe(false);
    expect(r.result.content[0].text).toMatch(/Hello world/);
    expect(r.result.content[0].text).not.toMatch(/VAULT_BLOCKED/);
  });

  it('blocks an injected tool-call response in default block mode', async () => {
    proxy = startProxy();
    proxy.send({
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: { name: 'read_file', arguments: { path: 'malicious.txt' } },
    });
    const r = await proxy.next();
    expect(r.id).toBe(11);
    expect(r.result.isError).toBe(true);
    expect(r.result.content).toHaveLength(1);
    expect(r.result.content[0].text).toMatch(/\[VAULT_BLOCKED\]/);
    expect(r.result.content[0].text).toMatch(/read_file/);
    expect(r.result.content[0].text).not.toMatch(/IGNORE PREVIOUS INSTRUCTIONS/);
  });

  it('blocks unicode-tag-smuggling payload', async () => {
    proxy = startProxy();
    proxy.send({
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/call',
      params: { name: 'read_file', arguments: { path: 'unicode-tag.txt' } },
    });
    const r = await proxy.next();
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toMatch(/\[VAULT_BLOCKED\]/);
  });

  it('warn mode prepends warning and preserves original content', async () => {
    proxy = startProxy('warn');
    proxy.send({
      jsonrpc: '2.0',
      id: 13,
      method: 'tools/call',
      params: { name: 'read_file', arguments: { path: 'malicious.txt' } },
    });
    const r = await proxy.next();
    expect(r.result.content).toHaveLength(2);
    expect(r.result.content[0].text).toMatch(/\[VAULT_WARNING\]/);
    expect(r.result.content[1].text).toMatch(/IGNORE PREVIOUS INSTRUCTIONS/);
  });

  it('blocks a Layer-1-clean but Layer-2-similar paraphrased payload', async () => {
    proxy = startProxy();
    proxy.send({
      jsonrpc: '2.0',
      id: 15,
      method: 'tools/call',
      params: { name: 'read_file', arguments: { path: 'paraphrased.txt' } },
    });
    const r = await proxy.next();
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toMatch(/\[VAULT_BLOCKED\]/);
    expect(r.result.content[0].text).toMatch(/corpus|layer-2/);
  }, 30000);

  it('does not block benign abstract discussion of prompt injection', async () => {
    proxy = startProxy();
    proxy.send({
      jsonrpc: '2.0',
      id: 16,
      method: 'tools/call',
      params: { name: 'read_file', arguments: { path: 'benign-discussion.txt' } },
    });
    const r = await proxy.next();
    expect(r.result.isError).toBe(false);
    expect(r.result.content[0].text).toMatch(/Recent research/);
    expect(r.result.content[0].text).not.toMatch(/VAULT_BLOCKED/);
  }, 30000);

  it('log mode passes content through unmodified', async () => {
    proxy = startProxy('log');
    proxy.send({
      jsonrpc: '2.0',
      id: 14,
      method: 'tools/call',
      params: { name: 'read_file', arguments: { path: 'malicious.txt' } },
    });
    const r = await proxy.next();
    expect(r.result.content).toHaveLength(1);
    expect(r.result.content[0].text).toMatch(/IGNORE PREVIOUS INSTRUCTIONS/);
    expect(r.result.content[0].text).not.toMatch(/VAULT_BLOCKED/);
  });
});
