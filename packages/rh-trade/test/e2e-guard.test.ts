/// End-to-end: rh-trade wrapped by the Vault proxy with the trade guard on.
///
/// Spawns `mcp-proxy -- rh-trade` with VAULT_TRADE_GUARD=1 and an allowlist, then drives
/// two execute_swap calls: a bad (non-allowlisted) recipient must be BLOCKED before it
/// reaches rh-trade, and a legitimate (allowlisted) recipient must pass the guard and
/// forward to rh-trade. Network-free / no API key required — the guard blocks the bad
/// call before any swap is built, and the good call returns rh-trade's dry-run note.

import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROXY_ENTRY = path.resolve(__dirname, '../../proxy/src/index.ts');
const RH_SERVER = path.resolve(__dirname, '../src/server.ts');

const GOOD = '0x1111111111111111111111111111111111111111';
const BAD = '0xBAD00dEADbeef00000000000000000000000ATTACK';

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: any;
  error?: any;
}

function startProxy() {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', PROXY_ENTRY, '--', process.execPath, '--import', 'tsx', RH_SERVER],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, VAULT_TRADE_GUARD: '1', VAULT_TRADE_ALLOWLIST: GOOD },
    },
  ) as ChildProcessWithoutNullStreams;

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
    send: (m: unknown) => child.stdin.write(JSON.stringify(m) + '\n'),
    next: () =>
      new Promise<JsonRpcResponse>((resolve, reject) => {
        if (queue.length > 0) return resolve(queue.shift()!);
        const t = setTimeout(() => reject(new Error('timeout')), 40000);
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

describe('rh-trade + Vault trade guard — end-to-end', () => {
  let proxy: ReturnType<typeof startProxy>;
  afterEach(() => proxy?.close());

  it('blocks a swap to a non-allowlisted recipient, passes an allowlisted one', async () => {
    proxy = startProxy();

    // Bad recipient → the trade guard blocks before rh-trade sees it.
    proxy.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'execute_swap', arguments: { symbol: 'WETH', amountIn: '1', recipient: BAD, minAmountOut: '0' } },
    });
    const bad = await proxy.next();
    expect(bad.id).toBe(1);
    expect(bad.result.isError).toBe(true);
    expect(bad.result.content[0].text).toMatch(/\[VAULT_CAPABILITY_BLOCKED\]/);
    expect(bad.result.content[0].text).toMatch(/execute_swap/);

    // Allowlisted recipient → passes the guard, forwarded to rh-trade (dry-run note).
    proxy.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'execute_swap', arguments: { symbol: 'WETH', amountIn: '1', recipient: GOOD, minAmountOut: '0' } },
    });
    const good = await proxy.next();
    expect(good.id).toBe(2);
    expect(JSON.stringify(good.result)).not.toMatch(/VAULT_CAPABILITY_BLOCKED/);
    expect(good.result.structuredContent.mode).toBe('dry-run');
  }, 90000);
});
