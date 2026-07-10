/// Offline tests for the rh-trade MCP server.
///
/// These run WITHOUT a live RPC: the default chain config in chain.ts is a
/// placeholder (isPlaceholderChain() === true), which routes every tool down its
/// guarded, network-free branch. In particular execute_swap only ever *builds* the
/// tx here and never broadcasts, because live mode requires RH_LIVE=1 + PRIVATE_KEY
/// + a non-placeholder RPC — none of which are set in tests.

import { describe, it, expect } from 'vitest';
import { handle } from '../src/server.js';
import { TOOLS, isPlaceholderChain } from '../src/tools.js';

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
      tx: { to: string; data: string; value: string };
    } } }).result;

    expect(result.isError).toBe(false);
    const swap = result.structuredContent;
    expect(swap.mode).toBe('dry-run');
    expect(swap.broadcast).toBe(false);
    expect(swap.txHash).toBeNull();
    // A real tx object was still built.
    expect(swap.tx.to).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(swap.tx.data).toMatch(/^0x[0-9a-fA-F]+$/);
    expect(swap.tx.value).toBe('0');
  });
});

describe('get_quote (offline)', () => {
  it('returns a placeholder quote with null output and no network call', async () => {
    const res = await handle({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'get_quote', arguments: { symbol: 'tAAPL', amountIn: '1000' } },
    });
    const swap = (res as { result: { structuredContent: { amountOutWei: string | null; placeholder: boolean } } })
      .result.structuredContent;
    expect(swap.placeholder).toBe(true);
    expect(swap.amountOutWei).toBeNull();
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
