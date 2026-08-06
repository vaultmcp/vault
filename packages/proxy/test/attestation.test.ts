import { describe, it, expect, vi } from 'vitest';
import {
  createAttestationClient,
  createScanReporter,
  encodeScanReceipt,
  encodeThreatRecord,
  resolveThreatRefs,
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

  it('batches an enqueued trade receipt through submit', async () => {
    const submit = vi.fn(async () => ({ txHash: ZERO_BYTES32 as Hex, uids: [] }));
    const client = createAttestationClient({
      config: baseConfig({ batchSize: 1 }),
      submitFn: submit as unknown as SubmitFn,
    });
    client.enqueueTradeReceipt({
      kind: 'trade',
      localId: 't1',
      payload: {
        mcpServerUrl: 'stdio:rh-trade',
        toolName: 'execute_swap',
        decision: 2,
        reasonCode: 1,
        recipientHash: ZERO_BYTES32,
        token: 'WETH',
        valueBucket: 4,
        guardedAt: 1n,
      },
    });
    await client.flush();
    expect(submit).toHaveBeenCalledTimes(1);
    const items = submit.mock.calls[0]![1] as AttestationItem[];
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe('trade');
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

  // Regression for the reputation double-count: a malicious scan must be recorded as ONE scan and
  // ONE block, not two scans. VaultReputation.submitThreat only avoids re-counting the scan when the
  // ThreatRecord's receiptRefUID equals the paired ScanReceipt's real EAS UID. The reporter can't
  // know that UID yet, so it must emit a *linkable* threat (zero ref + pairedReceiptLocalId), never a
  // synthetic non-zero ref the contract can never match.
  it('links the threat to its receipt without inventing a ref the contract cannot match', () => {
    const client = makeClient();
    const r = createScanReporter({ client, sampleRateL1L2: 0 });
    r.report({
      toolName: 'read_file',
      mcpServerUrl: 'stdio:fs',
      contentHash: 'b'.repeat(64),
      result: { verdict: 'malicious', confidence: 0.92, reasoning: 'r', detectedPatterns: ['p'] },
      verdict: 'malicious',
      layer: 1,
    });
    const scan = client._enqueued.find((i: any) => i.kind === 'scan') as any;
    const threat = client._enqueued.find((i: any) => i.kind === 'threat') as any;
    // Left as a placeholder for the submit layer to fill — NOT a synthetic hash.
    expect(threat.payload.receiptRefUID).toBe(ZERO_BYTES32);
    // And carries the pairing hint back to the receipt it was emitted alongside.
    expect(threat.pairedReceiptLocalId).toBe(scan.localId);
  });
});

describe('resolveThreatRefs (reputation double-count fix)', () => {
  const uidFor = (n: number) => (`0x${String(n).padStart(64, 'e')}`) as Hex;

  function scanItem(localId: string): Extract<AttestationItem, { kind: 'scan' }> {
    return {
      kind: 'scan',
      localId,
      payload: {
        contentHash: ZERO_BYTES32,
        mcpServerUrl: 'stdio:fs',
        toolName: 't',
        verdict: 2,
        confidence: 90,
        layersRun: 1,
        detectedPatterns: [],
        scannedAt: 0n,
      },
    };
  }
  function threatItem(pairedReceiptLocalId?: string): Extract<AttestationItem, { kind: 'threat' }> {
    return {
      kind: 'threat',
      localId: 'th-' + (pairedReceiptLocalId ?? 'orphan'),
      pairedReceiptLocalId,
      payload: {
        contentHash: ZERO_BYTES32,
        mcpServerUrl: 'stdio:fs',
        toolName: 't',
        category: 'instruction_override',
        receiptRefUID: ZERO_BYTES32,
        detectedAt: 0n,
      },
    };
  }

  it('stamps the paired ScanReceipt real UID into the threat so the contract de-dups the scan', () => {
    const scans = [scanItem('s1'), scanItem('s2')];
    const scanUids = [uidFor(1), uidFor(2)];
    const threats = [threatItem('s2')];
    const [out] = resolveThreatRefs(scans, scanUids, threats);
    // The threat now points at s2's real submitted UID → submitThreat sees submitted[uid]==true → no
    // backfill scan → 1 scan (from the receipt) + 1 block, not 2 scans.
    expect(out.payload.receiptRefUID).toBe(uidFor(2));
  });

  it('leaves an orphan threat (no paired receipt in the batch) with a zero ref', () => {
    const scans = [scanItem('s1')];
    const scanUids = [uidFor(1)];
    const threats = [threatItem(undefined)];
    const [out] = resolveThreatRefs(scans, scanUids, threats);
    // Zero ref → the contract's orphan branch counts it exactly once (1 scan + 1 block), not twice.
    expect(out.payload.receiptRefUID).toBe(ZERO_BYTES32);
  });

  it('does not mutate the input threat items', () => {
    const scans = [scanItem('s1')];
    const threats = [threatItem('s1')];
    const out = resolveThreatRefs(scans, [uidFor(1)], threats);
    expect(threats[0]!.payload.receiptRefUID).toBe(ZERO_BYTES32); // original untouched
    expect(out[0]!.payload.receiptRefUID).toBe(uidFor(1)); // copy updated
  });
});
