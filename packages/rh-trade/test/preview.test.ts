/// Unit tests for the simulate-before-sign policy. Pure logic, no network.

import { describe, it, expect } from 'vitest';
import { evaluatePreview, quotedOutput } from '../src/preview.js';

describe('evaluatePreview', () => {
  it('allows a swap whose simulated output meets the floor', () => {
    const v = evaluatePreview({ minOut: 100n, simulatedOut: 120n, reverted: false });
    expect(v.action).toBe('allow');
    expect(v.simulatedOut).toBe('120');
  });

  it('blocks a swap that would revert on-chain', () => {
    const v = evaluatePreview({ minOut: 100n, simulatedOut: null, reverted: true });
    expect(v.action).toBe('block');
    expect(v.reason).toMatch(/revert/);
  });

  it('blocks when the recipient would receive less than the floor', () => {
    const v = evaluatePreview({ minOut: 100n, simulatedOut: 90n, reverted: false });
    expect(v.action).toBe('block');
    expect(v.reason).toMatch(/below your floor/);
  });

  it('blocks a drain: simulated output is zero even though nothing reverted', () => {
    const v = evaluatePreview({ minOut: 1n, simulatedOut: 0n, reverted: false });
    expect(v.action).toBe('block');
    expect(v.reason).toMatch(/below your floor/);
  });

  it('blocks when the simulated output is far below the quoted output (sandwich/manipulation)', () => {
    // Quote said 1000, floor is a permissive 500, but the tx would actually deliver 700
    // (30% below quote) — past the default 2% drift tolerance.
    const v = evaluatePreview({ minOut: 500n, simulatedOut: 700n, expectedOut: 1000n, reverted: false });
    expect(v.action).toBe('block');
    expect(v.reason).toMatch(/below the quoted/);
    expect(v.reason).toMatch(/30%/);
  });

  it('allows when the simulated output is within the drift tolerance of the quote', () => {
    // 1% below a 1000 quote, under the 2% default.
    const v = evaluatePreview({ minOut: 500n, simulatedOut: 990n, expectedOut: 1000n, reverted: false });
    expect(v.action).toBe('allow');
  });

  it('warns (but proceeds) when simulation is unavailable and not strict', () => {
    const v = evaluatePreview({ minOut: 100n, simulatedOut: null, reverted: false });
    expect(v.action).toBe('warn');
    expect(v.reason).toMatch(/could not simulate/);
  });

  it('blocks when simulation is unavailable and strict mode is on', () => {
    const v = evaluatePreview({ minOut: 100n, simulatedOut: null, reverted: false, strict: true });
    expect(v.action).toBe('block');
    expect(v.reason).toMatch(/strict preview/);
  });

  it('skips the drift check when maxDriftBps is 0', () => {
    const v = evaluatePreview({ minOut: 1n, simulatedOut: 10n, expectedOut: 1000n, maxDriftBps: 0, reverted: false });
    expect(v.action).toBe('allow');
  });
});

describe('quotedOutput', () => {
  it('reads a nested output.amount string', () => {
    expect(quotedOutput({ output: { amount: '12345' } })).toBe(12345n);
  });

  it('reads a flat amountOut', () => {
    expect(quotedOutput({ amountOut: '999' })).toBe(999n);
  });

  it('returns null for an unrecognized shape', () => {
    expect(quotedOutput({ nothing: 'useful' })).toBeNull();
    expect(quotedOutput(null)).toBeNull();
  });
});
