import { describe, it, expect, vi } from 'vitest';
import {
  createAttestationClient,
  createScanReporter,
  encodeScanReceipt,
  encodeThreatRecord,
  type AttestationConfig,
  type AttestationItem,
  type SubmitFn,
} from '../src/attestation/index.js';
import type { Hex } from 'viem';

const ZERO_BYTES32 = '0x' + '0'.repeat(64) as Hex;

const ADDRS = {
  eas: '0x4200000000000000000000000000000000000021' as Hex,
  scanReceiptSchema: '0xaa' + 'aa'.repeat(31) as Hex,
  threatRecordSchema: '0xbb' + 'bb'.repeat(31) as Hex,
};

function baseConfig(overrides: Partial<AttestationConfig> = {}): AttestationConfig {
  return {
    enabled: true,
    rpcUrl: 'http://test/rpc',
    privateKey: ('0x' + '11'.repeat(32)) as Hex,
    addresses: ADDRS,
    batchSize: 50,
    flushIntervalMs: 5000,
    sampleRateL1L2: 0.1,
    ...overrides,
  };
}

describe('encoders', () => {
  it('encodeScanReceipt produces a non-empty hex string', () => {
    const data = encodeScanReceipt({
      contentHash: ZERO_BYTES32,
      mcpServerUrl: 'stdio:filesystem',
      toolName: 'read_file',
      verdict: 2,
      confidence: 95,
      layersRun: 0b001,
      detectedPatterns: ['unicode-tag-smuggling'],
      scannedAt: 1715000000n,
    });
    expect(data).toMatch(/^0x[0-9a-f]+$/);
    expect(data.length).toBeGreaterThan(200);
  });

  it('encodeThreatRecord produces a non-empty hex string', () => {
    const data = encodeThreatRecord({
      contentHash: ZERO_BYTES32,
      mcpServerUrl: 'stdio:filesystem',
      toolName: 'read_file',
      category: 'instruction_override',
      receiptRefUID: ZERO_BYTES32,
      detectedAt: 1715000000n,
    });
    expect(data).toMatch(/^0x[0-9a-f]+$/);
  });
});

describe('createAttestationClient', () => {
  it('is a no-op when config.enabled is false (no submitFn ever called)', () => {
    const submit = vi.fn() as unknown as SubmitFn;
    const client = createAttestationClient({
      config: baseConfig({ enabled: false }),
      submitFn: submit,
    });
    expect(client.enabled).toBe(false);
    client.enqueueScanReceipt({
      kind: 'scan',
      localId: '1',
      payload: {
        contentHash: ZERO_BYTES32,
        mcpServerUrl: 'x',
        toolName: 't',
        verdict: 0,
        confidence: 0,
        layersRun: 0,
        detectedPatterns: [],
        scannedAt: 0n,
      },
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it('is a no-op when addresses are missing', () => {
    const submit = vi.fn() as unknown as SubmitFn;
    const client = createAttestationClient({
      config: baseConfig({ addresses: undefined }),
      submitFn: submit,
    });
    expect(client.enabled).toBe(false);
  });

  it('is a no-op when private key is missing', () => {
    const submit = vi.fn() as unknown as SubmitFn;
    const client = createAttestationClient({
      config: baseConfig({ privateKey: undefined }),
      submitFn: submit,
    });
    expect(client.enabled).toBe(false);
  });

  it('flushes at batch size threshold', async () => {
    const submit = vi.fn(async () => ({ txHash: ZERO_BYTES32 as Hex, uids: [] }));
    const client = createAttestationClient({
      config: baseConfig({ batchSize: 3, flushIntervalMs: 60_000 }),
      submitFn: submit as unknown as SubmitFn,
    });
    for (let i = 0; i < 3; i++) {
      client.enqueueScanReceipt({
        kind: 'scan',
        localId: String(i),
        payload: {
          contentHash: ZERO_BYTES32,
          mcpServerUrl: 'x',
          toolName: 't',
          verdict: 0,
          confidence: 0,
          layersRun: 0,
          detectedPatterns: [],
          scannedAt: 0n,
        },
      });
    }
    await client.flush();
    expect(submit).toHaveBeenCalledTimes(1);
    const items = submit.mock.calls[0]![1] as AttestationItem[];
    expect(items).toHaveLength(3);
  });

  it('flushes at time threshold', async () => {
    const submit = vi.fn(async () => ({ txHash: ZERO_BYTES32 as Hex, uids: [] }));
    const client = createAttestationClient({
      config: baseConfig({ batchSize: 100, flushIntervalMs: 30 }),
      submitFn: submit as unknown as SubmitFn,
    });
    client.enqueueScanReceipt({
      kind: 'scan',
      localId: '1',
      payload: {
        contentHash: ZERO_BYTES32,
        mcpServerUrl: 'x',
        toolName: 't',
        verdict: 1,
        confidence: 50,
        layersRun: 1,
        detectedPatterns: [],
        scannedAt: 0n,
      },
    });
    await new Promise((r) => setTimeout(r, 80));
    await client.flush();
    expect(submit).toHaveBeenCalled();
  });

  it('handles submit failures gracefully (does not throw)', async () => {
    const submit = vi.fn(async () => {
      throw new Error('rpc down');
    });
    const client = createAttestationClient({
      config: baseConfig({ batchSize: 1 }),
      submitFn: submit as unknown as SubmitFn,
    });
    client.enqueueScanReceipt({
      kind: 'scan',
      localId: '1',
      payload: {
        contentHash: ZERO_BYTES32,
        mcpServerUrl: 'x',
        toolName: 't',
        verdict: 2,
        confidence: 90,
        layersRun: 1,
        detectedPatterns: [],
        scannedAt: 0n,
      },
    });
    await expect(client.flush()).resolves.not.toThrow();
  });

  it('shutdown() flushes pending items', async () => {
    const submit = vi.fn(async () => ({ txHash: ZERO_BYTES32 as Hex, uids: [] }));
    const client = createAttestationClient({
      config: baseConfig({ batchSize: 100, flushIntervalMs: 60_000 }),
      submitFn: submit as unknown as SubmitFn,
    });
    client.enqueueScanReceipt({
      kind: 'scan',
      localId: '1',
      payload: {
        contentHash: ZERO_BYTES32,
        mcpServerUrl: 'x',
        toolName: 't',
        verdict: 2,
        confidence: 99,
        layersRun: 1,
        detectedPatterns: ['p'],
        scannedAt: 1n,
      },
    });
    await client.shutdown();
    expect(submit).toHaveBeenCalledTimes(1);
  });
});

describe('createScanReporter', () => {
  function makeClient() {
    const enqueued: AttestationItem[] = [];
    return {
      enabled: true,
      enqueueScanReceipt: (item: any) => enqueued.push(item),
      enqueueThreatRecord: (item: any) => enqueued.push(item),
      async flush() {},
      async shutdown() {},
      _enqueued: enqueued,
    } as any;
  }

  it('returns a no-op when the client is disabled', () => {
    const client = {
      enabled: false,
      enqueueScanReceipt: vi.fn(),
      enqueueThreatRecord: vi.fn(),
      async flush() {},
      async shutdown() {},
    } as any;
    const r = createScanReporter({ client, sampleRateL1L2: 1 });
    expect(r.enabled).toBe(false);
    const out = r.report({
      toolName: 't',
      mcpServerUrl: 'x',
      contentHash: 'a'.repeat(64),
      result: null,
      verdict: 'malicious',
      layer: 1,
    });
    expect(out.emittedReceipt).toBe(false);
    expect(out.emittedThreat).toBe(false);
    expect(client.enqueueScanReceipt).not.toHaveBeenCalled();
  });

  it('emits both receipt and threat for malicious verdicts (confidence >= 0.7)', () => {
    const client = makeClient();
    const r = createScanReporter({ client, sampleRateL1L2: 0 });
    const out = r.report({
      toolName: 'read_file',
      mcpServerUrl: 'stdio:fs',
      contentHash: 'b'.repeat(64),
      result: { verdict: 'malicious', confidence: 0.92, reasoning: 'r', detectedPatterns: ['p'] },
      verdict: 'malicious',
      layer: 1,
    });
    expect(out.emittedReceipt).toBe(true);
    expect(out.emittedThreat).toBe(true);
    expect(client._enqueued.filter((i: any) => i.kind === 'scan')).toHaveLength(1);
    expect(client._enqueued.filter((i: any) => i.kind === 'threat')).toHaveLength(1);
  });

  it('emits only a receipt for suspicious verdicts', () => {
    const client = makeClient();
    const r = createScanReporter({ client, sampleRateL1L2: 0 });
    r.report({
      toolName: 'read_file',
      mcpServerUrl: 'stdio:fs',
      contentHash: 'c'.repeat(64),
      result: { verdict: 'suspicious', confidence: 0.6, reasoning: 'r', detectedPatterns: [] },
      verdict: 'suspicious',
      layer: 1,
    });
    expect(client._enqueued.filter((i: any) => i.kind === 'scan')).toHaveLength(1);
    expect(client._enqueued.filter((i: any) => i.kind === 'threat')).toHaveLength(0);
  });

  it('emits a receipt for clean from Layer 3 even at sample rate 0', () => {
    const client = makeClient();
    const r = createScanReporter({ client, sampleRateL1L2: 0 });
    r.report({
      toolName: 'read_file',
      mcpServerUrl: 'stdio:fs',
      contentHash: 'd'.repeat(64),
      result: { verdict: 'clean', confidence: 0.95, reasoning: 'r', detectedPatterns: [] },
      verdict: 'clean',
      layer: 3,
    });
    expect(client._enqueued).toHaveLength(1);
  });

  it('samples clean-from-L1/L2 events at the configured rate', () => {
    const client = makeClient();
    let rngVal = 0.05;
    const r = createScanReporter({
      client,
      sampleRateL1L2: 0.1,
      rng: () => rngVal,
    });
    // First call: rng=0.05 < 0.1 → sample in
    r.report({
      toolName: 't',
      mcpServerUrl: 'x',
      contentHash: 'e'.repeat(64),
      result: null,
      verdict: 'clean',
      layer: 1,
    });
    expect(client._enqueued).toHaveLength(1);
    // Second call: rng=0.5 > 0.1 → sample out
    rngVal = 0.5;
    r.report({
      toolName: 't',
      mcpServerUrl: 'x',
      contentHash: 'f'.repeat(64),
      result: null,
      verdict: 'clean',
      layer: 2,
    });
    expect(client._enqueued).toHaveLength(1); // unchanged
  });

  it('does not emit threat when malicious confidence is below 0.7', () => {
    const client = makeClient();
    const r = createScanReporter({ client, sampleRateL1L2: 0 });
    r.report({
      toolName: 't',
      mcpServerUrl: 'x',
      contentHash: 'a'.repeat(64),
      result: { verdict: 'malicious', confidence: 0.5, reasoning: 'r', detectedPatterns: [] },
      verdict: 'malicious',
      layer: 1,
    });
    expect(client._enqueued.filter((i: any) => i.kind === 'threat')).toHaveLength(0);
  });

  it('encodes the scan payload with verdict code and layers bitfield', () => {
    const client = makeClient();
    const r = createScanReporter({ client, sampleRateL1L2: 0 });
    r.report({
      toolName: 'read_file',
      mcpServerUrl: 'https://mcp.example.com',
      contentHash: '1'.repeat(64),
      result: { verdict: 'malicious', confidence: 0.91, reasoning: 'r', detectedPatterns: ['x'] },
      verdict: 'malicious',
      layer: 2,
    });
    const scan = client._enqueued.find((i: any) => i.kind === 'scan') as any;
    expect(scan.payload.verdict).toBe(2);
    expect(scan.payload.layersRun).toBe(0b010);
    expect(scan.payload.confidence).toBe(91);
    expect(scan.payload.detectedPatterns).toEqual(['x']);
  });
});
