/// executeSwap must refuse to broadcast when simulate-before-sign fails. The block fires
/// before any wallet/RPC call, so we can drive the full live path with a mocked Uniswap
/// API (fetch) and an injected simulator — no network, no real key.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { executeSwap } from '../src/tools.js';
import type { ChainConfig } from '../src/chain.js';
import type { SimulateFn } from '../src/preview.js';

const RECIPIENT = '0x1111111111111111111111111111111111111111';
const CFG: ChainConfig = {
  name: 'Test Chain',
  rpcUrl: 'http://127.0.0.1:1', // never actually dialed — the preview blocks first
  chainId: 4663,
  usdg: `0x${'a'.repeat(40)}`,
};

// Mocked Uniswap Trading API: /quote → a quote, /swap → a signable tx (no permit).
const mockFetch = (async (url: unknown) => {
  const u = String(url);
  let body: unknown = {};
  if (u.endsWith('/quote')) body = { quote: { output: { amount: '1000' } }, permitData: null, routing: 'CLASSIC' };
  else if (u.endsWith('/swap')) body = { swap: { to: `0x${'b'.repeat(40)}`, from: RECIPIENT, data: '0xdeadbeef', value: '0', chainId: 4663 } };
  else if (u.endsWith('/check_approval')) body = { approval: null };
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}) as typeof fetch;

describe('executeSwap — simulate-before-sign', () => {
  beforeEach(() => {
    vi.stubEnv('RH_LIVE', '1');
    vi.stubEnv('PRIVATE_KEY', '0xdummy'); // only length is checked before the preview runs
    vi.stubEnv('UNISWAP_API_KEY', 'test-key');
    vi.stubEnv('RH_TOKEN_XYZ', `0x${'c'.repeat(40)}`);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('refuses to broadcast when the simulated output is below the floor', async () => {
    const simulate: SimulateFn = async () => ({ simulatedOut: 10n, reverted: false });
    const r = await executeSwap(
      { symbol: 'XYZ', amountIn: '1000', recipient: RECIPIENT, minAmountOut: '100' },
      CFG,
      mockFetch,
      simulate,
    );
    expect(r.mode).toBe('blocked');
    expect(r.broadcast).toBe(false);
    expect(r.txHash).toBeNull();
    expect(r.preview?.action).toBe('block');
    expect(r.note).toMatch(/PREVIEW BLOCKED/);
  });

  it('refuses to broadcast when the simulated transaction reverts', async () => {
    const simulate: SimulateFn = async () => ({ simulatedOut: null, reverted: true });
    const r = await executeSwap(
      { symbol: 'XYZ', amountIn: '1000', recipient: RECIPIENT, minAmountOut: '0' },
      CFG,
      mockFetch,
      simulate,
    );
    expect(r.mode).toBe('blocked');
    expect(r.preview?.reason).toMatch(/revert/);
  });

  it('can be disabled with RH_PREVIEW=0 (falls through to the broadcast path)', async () => {
    vi.stubEnv('RH_PREVIEW', '0');
    const simulate = vi.fn<SimulateFn>();
    // With the preview off, executeSwap proceeds toward broadcast and fails at the wallet
    // step (dummy key / dead RPC) — the point is only that the simulator is never consulted.
    await executeSwap(
      { symbol: 'XYZ', amountIn: '1000', recipient: RECIPIENT, minAmountOut: '100' },
      CFG,
      mockFetch,
      simulate,
    ).catch(() => undefined);
    expect(simulate).not.toHaveBeenCalled();
  });
});
