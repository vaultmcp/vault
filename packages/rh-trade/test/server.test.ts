/// Offline tests for the rh-trade MCP server.
///
/// These run WITHOUT a live RPC: the default chain config in chain.ts is a
/// placeholder (isPlaceholderChain() === true), which routes every tool down its
/// guarded, network-free branch. In particular execute_swap only ever *builds* the
/// tx here and never broadcasts, because live mode requires RH_LIVE=1 + PRIVATE_KEY
/// + a non-placeholder RPC — none of which are set in tests.

import { describe, it, expect, vi } from 'vitest';
import { handle } from '../src/server.js';
import { TOOLS, isPlaceholderChain, executeSwap } from '../src/tools.js';
import type { ChainConfig } from '../src/chain.js';

describe('environment', () => {
  it('runs against the placeholder chain (offline)', () => {
    expect(isPlaceholderChain()).toBe(true);
  });
});

describe('tools/list', () => {
  it('returns exactly the three tools with valid JSON schemas', async () => {
    const res = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res).not.toBeNull();
    const result = (res as { result: { tools: typeof TOOLS } }).result;
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual(['execute_swap', 'get_quote', 'get_token_metadata']);

    for (const tool of result.tools) {
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.description).toBe('string');
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
      // Every required key must be declared as a property.
      for (const key of tool.inputSchema.required) {
        expect(tool.inputSchema.properties[key]).toBeDefined();
      }
    }
  });
});

describe('initialize', () => {
  it('advertises tools capability and protocol version', async () => {
    const res = await handle({ jsonrpc: '2.0', id: 0, method: 'initialize' });
    const result = (res as { result: Record<string, unknown> }).result;
    expect(result['protocolVersion']).toBeTypeOf('string');
    expect(result['capabilities']).toMatchObject({ tools: {} });
  });
});

describe('execute_swap (dry-run)', () => {
  it('returns an unsigned tx object and does NOT broadcast', async () => {
    const res = await handle({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'execute_swap',
        arguments: {
          symbol: 'tAAPL',
          amountIn: '1000',
          recipient: '0x000000000000000000000000000000000000dEaD',
          minAmountOut: '1',
        },
      },
    });
    const result = (res as { result: { isError: boolean; structuredContent: {
      mode: string;
      broadcast: boolean;
      txHash: string | null;
      tx: unknown;
      request: { recipient: string };
    } } }).result;

    expect(result.isError).toBe(false);
    const swap = result.structuredContent;
    expect(swap.mode).toBe('dry-run');
    expect(swap.broadcast).toBe(false);
    expect(swap.txHash).toBeNull();
    // Network-free dry-run (no UNISWAP_API_KEY / unconfigured chain): no tx built, no call made.
    expect(swap.tx).toBeNull();
    expect(swap.request.recipient).toBe('0x000000000000000000000000000000000000dEaD');
  });
});

describe('get_quote (offline)', () => {
  it('returns a dry quote with no live routing and no network call', async () => {
    const res = await handle({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'get_quote', arguments: { symbol: 'tAAPL', amountIn: '1000' } },
    });
    const swap = (res as { result: { structuredContent: { quote: unknown; placeholder: boolean } } })
      .result.structuredContent;
    expect(swap.placeholder).toBe(true);
    expect(swap.quote).toBeNull();
  });
});

describe('protocol errors', () => {
  it('returns -32601 for an unknown method', async () => {
    const res = await handle({ jsonrpc: '2.0', id: 9, method: 'no/such/method' });
    const error = (res as { error: { code: number } }).error;
    expect(error.code).toBe(-32601);
  });

  it('returns no response for a notification (no id)', async () => {
    const res = await handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(res).toBeNull();
  });
});

describe('execute_swap via Uniswap Trading API (mocked, still dry-run)', () => {
  const cfg: ChainConfig = {
    name: 'Robinhood Chain',
    rpcUrl: 'https://rpc.example',
    chainId: 4663,
    usdg: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
  };

  it('calls /quote then /swap and returns the built tx without broadcasting', async () => {
    const prevKey = process.env.UNISWAP_API_KEY;
    const prevTok = process.env.RH_TOKEN_TAAPL;
    process.env.UNISWAP_API_KEY = 'test-key';
    process.env.RH_TOKEN_TAAPL = '0x1111111111111111111111111111111111111111';
    delete process.env.RH_LIVE; // ensure no broadcast
    try {
      const calls: string[] = [];
      const fetchMock = vi.fn(async (url: any) => {
        calls.push(String(url));
        const body = String(url).endsWith('/quote')
          ? { quote: { id: 'q1' }, permitData: null }
          : { swap: { to: '0xrouter', from: '0xme', data: '0xabc', value: '0', chainId: 4663 } };
        return new Response(JSON.stringify(body), { status: 200 });
      }) as unknown as typeof fetch;

      const res = await executeSwap(
        { symbol: 'tAAPL', amountIn: '1', recipient: '0x2222222222222222222222222222222222222222', minAmountOut: '0' },
        cfg,
        fetchMock,
      );
      expect(calls.some((u) => u.endsWith('/quote'))).toBe(true);
      expect(calls.some((u) => u.endsWith('/swap'))).toBe(true);
      expect(res.mode).toBe('dry-run');
      expect(res.broadcast).toBe(false);
      expect(res.tx?.to).toBe('0xrouter');
      expect(res.txHash).toBeNull();
    } finally {
      if (prevKey === undefined) delete process.env.UNISWAP_API_KEY; else process.env.UNISWAP_API_KEY = prevKey;
      if (prevTok === undefined) delete process.env.RH_TOKEN_TAAPL; else process.env.RH_TOKEN_TAAPL = prevTok;
    }
  });
});
