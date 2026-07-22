import { describe, it, expect } from 'vitest';
import { decodeAbiParameters } from 'viem';
import { createHash } from 'node:crypto';
import {
  buildTradeReceipt,
  emitTradeReceipt,
  aggregateToolReputation,
  classifyReason,
  encodeTradeReceipt,
  DECISION,
  REASON_CODES,
  type ReceiptLike,
} from '../src/attestation/index.js';
import type { TradePolicyConfig, GateDecision } from '../src/capability/index.js';

const cfg: TradePolicyConfig = {
  enabled: true,
  mode: 'block',
  recipientAllowlist: new Set(),
  swapPatterns: [/swap/i, /execute_?swap/i],
  approvePatterns: [/approve/i],
  recipientKeys: ['recipient', 'to'],
  amountKeys: ['amount', 'amountIn'],
  tokenKeys: ['symbol', 'token'],
  maxApproval: 2n ** 200n,
  maxTradeValue: null,
  maxPerWindow: null,
  maxValuePerWindow: null,
  maxValuePerToken: null,
  breakerThreshold: null,
  marketHours: null,
  windowMs: 60_000,
};

const ATTACKER = '0xBAD00dEADbeef00000000000000000000000ATTACK';

describe('buildTradeReceipt', () => {
  it('maps allow → cleared with reason 0 and no recipient hash', () => {
    const p = buildTradeReceipt({ mcpServerUrl: 's', toolName: 'execute_swap', action: 'allow', now: 1_700_000_000_000 });
    expect(p.decision).toBe(DECISION.cleared);
    expect(p.reasonCode).toBe(REASON_CODES.cleared);
    expect(p.recipientHash).toBe(`0x${'0'.repeat(64)}`);
    expect(p.guardedAt).toBe(1_700_000_000n);
  });

  it('maps block + allowlist reason and hashes the recipient', () => {
    const p = buildTradeReceipt({
      mcpServerUrl: 's',
      toolName: 'execute_swap',
      action: 'block',
      reason: "trade-policy: recipient '0x..' is not in the trade allowlist",
      recipient: ATTACKER,
      token: 'WETH',
      amount: 123456n,
      now: 1_700_000_000_000,
    });
    expect(p.decision).toBe(DECISION.blocked);
    expect(p.reasonCode).toBe(REASON_CODES.allowlist);
    expect(p.token).toBe('WETH');
    expect(p.valueBucket).toBe(6); // "123456" has 6 digits
    expect(p.recipientHash).toBe(`0x${createHash('sha256').update(ATTACKER.toLowerCase()).digest('hex')}`);
  });

  it('buckets value by digit count and treats zero/absent as unknown', () => {
    expect(buildTradeReceipt({ mcpServerUrl: 's', toolName: 'swap', action: 'allow', amount: 0n, now: 0 }).valueBucket).toBe(0);
    expect(buildTradeReceipt({ mcpServerUrl: 's', toolName: 'swap', action: 'allow', now: 0 }).valueBucket).toBe(0);
    expect(buildTradeReceipt({ mcpServerUrl: 's', toolName: 'swap', action: 'allow', amount: 10n ** 18n, now: 0 }).valueBucket).toBe(19);
  });
});

describe('classifyReason', () => {
  const cases: [string, number][] = [
    ['not in the trade allowlist', REASON_CODES.allowlist],
    ['recipient was sourced from an untrusted tool response (tainted)', REASON_CODES.tainted],
    ['unlimited approval (…) to a non-allowlisted spender', REASON_CODES.unlimitedApproval],
    ['at or above the per-trade cap', REASON_CODES.perTradeCap],
    ['over the per-window cap', REASON_CODES.perWindowCap],
    ['over the per-token cap', REASON_CODES.perTokenCap],
    ['trade rate limit exceeded', REASON_CODES.velocity],
    ['circuit breaker open', REASON_CODES.circuitBreaker],
    ['market is closed', REASON_CODES.marketClosed],
    ['something unrecognized', REASON_CODES.other],
  ];
  for (const [reason, code] of cases) {
    it(`maps "${reason.slice(0, 24)}…" → ${code}`, () => {
      expect(classifyReason('block', reason)).toBe(code);
    });
  }
});

describe('encodeTradeReceipt', () => {
  it('round-trips through ABI decoding', () => {
    const p = buildTradeReceipt({
      mcpServerUrl: 'stdio:rh-trade',
      toolName: 'execute_swap',
      action: 'block',
      reason: 'trade-policy: circuit breaker open',
      recipient: ATTACKER,
      token: 'WETH',
      amount: 5000n,
      now: 1_700_000_000_000,
    });
    const hex = encodeTradeReceipt(p);
    const [url, tool, decision, reasonCode, recipientHash, token, bucket, at] = decodeAbiParameters(
      [
        { type: 'string' },
        { type: 'string' },
        { type: 'uint8' },
        { type: 'uint8' },
        { type: 'bytes32' },
        { type: 'string' },
        { type: 'uint8' },
        { type: 'uint64' },
      ],
      hex,
    );
    expect(url).toBe('stdio:rh-trade');
    expect(tool).toBe('execute_swap');
    expect(Number(decision)).toBe(DECISION.blocked);
    expect(Number(reasonCode)).toBe(REASON_CODES.circuitBreaker);
    expect(recipientHash).toBe(p.recipientHash);
    expect(token).toBe('WETH');
    expect(Number(bucket)).toBe(4);
    expect(at).toBe(1_700_000_000n);
  });
});

describe('emitTradeReceipt', () => {
  it('is a no-op for a non-trade tool', () => {
    const items: unknown[] = [];
    const sink = { enqueueTradeReceipt: (i: unknown) => items.push(i) };
    const fired = emitTradeReceipt(sink, cfg, 's', 'read_file', { path: '/x' }, { action: 'allow' }, 1);
    expect(fired).toBe(false);
    expect(items).toHaveLength(0);
  });

  it('enqueues a receipt for a trade tool, extracting recipient/token/amount from args', () => {
    const items: any[] = [];
    const sink = { enqueueTradeReceipt: (i: unknown) => items.push(i) };
    const decision: GateDecision = { action: 'block', reason: 'trade-policy: not in the trade allowlist' };
    const fired = emitTradeReceipt(
      sink,
      cfg,
      'stdio:rh-trade',
      'execute_swap',
      { recipient: ATTACKER, symbol: 'WETH', amountIn: '4200' },
      decision,
      1_700_000_000_000,
    );
    expect(fired).toBe(true);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('trade');
    expect(items[0].payload.decision).toBe(DECISION.blocked);
    expect(items[0].payload.reasonCode).toBe(REASON_CODES.allowlist);
    expect(items[0].payload.token).toBe('WETH');
    expect(items[0].payload.valueBucket).toBe(4);
  });
});

describe('aggregateToolReputation', () => {
  const receipts: ReceiptLike[] = [
    { toolName: 'execute_swap', decision: DECISION.cleared, reasonCode: 0 },
    { toolName: 'execute_swap', decision: DECISION.cleared, reasonCode: 0 },
    { toolName: 'execute_swap', decision: DECISION.blocked, reasonCode: REASON_CODES.allowlist },
    { toolName: 'execute_swap', decision: DECISION.blocked, reasonCode: REASON_CODES.allowlist },
    { toolName: 'approve', decision: DECISION.blocked, reasonCode: REASON_CODES.unlimitedApproval },
  ];

  it('computes per-tool totals, block rate, score, and top block reason', () => {
    const rep = aggregateToolReputation(receipts);
    // Busiest tool first.
    expect(rep[0].toolName).toBe('execute_swap');
    expect(rep[0].total).toBe(4);
    expect(rep[0].cleared).toBe(2);
    expect(rep[0].blocked).toBe(2);
    expect(rep[0].blockRate).toBe(0.5);
    expect(rep[0].score).toBe(500); // 1000 * (1 - 0.5)
    expect(rep[0].topBlockReason).toBe(REASON_CODES.allowlist);

    const approve = rep.find((r) => r.toolName === 'approve')!;
    expect(approve.blocked).toBe(1);
    expect(approve.score).toBe(0); // 100% blocked
    expect(approve.topBlockReason).toBe(REASON_CODES.unlimitedApproval);
  });

  it('gives a clean tool a perfect score and null block reason', () => {
    const rep = aggregateToolReputation([
      { toolName: 'get_quote', decision: DECISION.cleared, reasonCode: 0 },
      { toolName: 'get_quote', decision: DECISION.cleared, reasonCode: 0 },
    ]);
    expect(rep[0].score).toBe(1000);
    expect(rep[0].topBlockReason).toBeNull();
  });
});
