import { describe, it, expect, vi } from 'vitest';
import { createRhLedgerClient, type RhLedgerConfig, type RhSubmitFn } from '../src/attestation/index.js';
import type { Hex } from 'viem';

const ZERO32 = `0x${'0'.repeat(64)}` as Hex;

function cfg(over: Partial<RhLedgerConfig> = {}): RhLedgerConfig {
  return {
    enabled: true,
    contract: `0x${'ab'.repeat(20)}` as Hex,
    rpcUrl: 'https://rpc.example',
    chainId: 4663,
    privateKey: `0x${'11'.repeat(32)}` as Hex,
    ...over,
  };
}

function receipt(toolName = 'execute_swap') {
  return {
    kind: 'trade' as const,
    localId: 't1',
    payload: {
      mcpServerUrl: 'stdio:rh-trade',
      toolName,
      decision: 2,
      reasonCode: 1,
      recipientHash: ZERO32,
      token: 'WETH',
      valueBucket: 4,
      guardedAt: 1_700_000_000n,
    },
  };
}

describe('createRhLedgerClient', () => {
  it('is a no-op when no contract is configured', () => {
    const submit = vi.fn();
    const client = createRhLedgerClient({ config: cfg({ contract: undefined }), submitFn: submit as unknown as RhSubmitFn });
    expect(client.enabled).toBe(false);
    client.enqueueTradeReceipt(receipt());
    expect(submit).not.toHaveBeenCalled();
  });

  it('is a no-op when disabled', () => {
    const submit = vi.fn();
    const client = createRhLedgerClient({ config: cfg({ enabled: false }), submitFn: submit as unknown as RhSubmitFn });
    expect(client.enabled).toBe(false);
  });

  it('submits an enqueued receipt with the payload', async () => {
    const submit = vi.fn(async () => (`0x${'cd'.repeat(32)}`) as Hex);
    const client = createRhLedgerClient({ config: cfg(), submitFn: submit as unknown as RhSubmitFn });
    client.enqueueTradeReceipt(receipt());
    await client.flush();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0]![1]).toMatchObject({ toolName: 'execute_swap', decision: 2, token: 'WETH' });
  });

  it('serializes submissions in order (no nonce races)', async () => {
    const order: string[] = [];
    const submit = vi.fn(async (_c: RhLedgerConfig, p: { toolName: string }) => {
      order.push(`start:${p.toolName}`);
      await new Promise((r) => setTimeout(r, p.toolName === 'a' ? 30 : 1));
      order.push(`end:${p.toolName}`);
      return ZERO32;
    });
    const client = createRhLedgerClient({ config: cfg(), submitFn: submit as unknown as RhSubmitFn });
    client.enqueueTradeReceipt(receipt('a'));
    client.enqueueTradeReceipt(receipt('b'));
    await client.flush();
    // 'a' must fully complete before 'b' starts, despite 'a' being slower.
    expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b']);
  });

  it('swallows submit failures (fire-and-forget, never throws)', async () => {
    const submit = vi.fn(async () => {
      throw new Error('rpc down');
    });
    const client = createRhLedgerClient({ config: cfg(), submitFn: submit as unknown as RhSubmitFn });
    client.enqueueTradeReceipt(receipt());
    await expect(client.flush()).resolves.not.toThrow();
  });

  it('stops accepting after shutdown', async () => {
    const submit = vi.fn(async () => ZERO32);
    const client = createRhLedgerClient({ config: cfg(), submitFn: submit as unknown as RhSubmitFn });
    await client.shutdown();
    client.enqueueTradeReceipt(receipt());
    await client.flush();
    expect(submit).not.toHaveBeenCalled();
  });
});
