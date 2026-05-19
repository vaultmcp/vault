import { describe, it, expect, vi } from 'vitest';
import { createReporter, sha256Hex } from '../src/telemetry/index.js';

function mockOk() {
  const calls: Array<{ url: string; body: any; headers: Record<string, string> }> = [];
  const fn = vi.fn(async (url: any, init: any) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init.body)),
      headers: init.headers ?? {},
    });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  return { fn, calls };
}

function mockFail(status: number) {
  return vi.fn(async () => new Response('fail', { status }));
}

function mockThrow() {
  return vi.fn(async () => {
    throw new Error('network down');
  });
}

describe('createReporter', () => {
  it('returns a no-op reporter when disabled', () => {
    const r = createReporter({ enabled: false, batchSize: 5, flushIntervalMs: 1000 });
    expect(r.enabled).toBe(false);
    r.send({
      type: 'detection',
      layer: 1,
      verdict: 'malicious',
      confidence: 1,
      toolName: 'read_file',
      contentHash: 'abc',
      patterns: [],
    });
  });

  it('returns a no-op reporter when URL is missing even if enabled flag is true', () => {
    const r = createReporter({ enabled: true, batchSize: 5, flushIntervalMs: 1000 });
    expect(r.enabled).toBe(false);
  });

  it('buffers below batch size and flushes on flush()', async () => {
    const { fn, calls } = mockOk();
    const r = createReporter(
      {
        enabled: true,
        url: 'https://collector.example/ingest',
        batchSize: 5,
        flushIntervalMs: 60_000,
      },
      fn,
    );
    r.send({
      type: 'detection',
      layer: 1,
      verdict: 'clean',
      confidence: 0,
      toolName: 't',
      contentHash: 'h1',
      patterns: [],
    });
    r.send({
      type: 'detection',
      layer: 1,
      verdict: 'clean',
      confidence: 0,
      toolName: 't',
      contentHash: 'h2',
      patterns: [],
    });
    expect(calls).toHaveLength(0);
    await r.flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.events).toHaveLength(2);
  });

  it('auto-flushes when batch size is reached', async () => {
    const { fn, calls } = mockOk();
    const r = createReporter(
      {
        enabled: true,
        url: 'https://collector.example/ingest',
        batchSize: 2,
        flushIntervalMs: 60_000,
      },
      fn,
    );
    r.send({
      type: 'detection',
      layer: 1,
      verdict: 'malicious',
      confidence: 0.9,
      toolName: 't',
      contentHash: 'h1',
      patterns: ['p1'],
    });
    r.send({
      type: 'detection',
      layer: 1,
      verdict: 'malicious',
      confidence: 0.9,
      toolName: 't',
      contentHash: 'h2',
      patterns: ['p1'],
    });
    // Auto-flush queued — await the in-flight promise via flush() (idempotent on empty buffer).
    await r.flush();
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const totalEvents = calls.reduce((acc, c) => acc + c.body.events.length, 0);
    expect(totalEvents).toBe(2);
  });

  it('flushes after the time interval elapses', async () => {
    const { fn, calls } = mockOk();
    const r = createReporter(
      { enabled: true, url: 'https://collector.example/ingest', batchSize: 100, flushIntervalMs: 30 },
      fn,
    );
    r.send({
      type: 'capability',
      action: 'block',
      toolName: 'http_get',
      argsHash: sha256Hex('args'),
      sourceTools: ['read_file'],
    });
    await new Promise((res) => setTimeout(res, 80));
    await r.flush();
    expect(calls).toHaveLength(1);
  });

  it('does not throw on network failure', async () => {
    const fn = mockThrow();
    const r = createReporter(
      { enabled: true, url: 'https://collector.example/ingest', batchSize: 1, flushIntervalMs: 10 },
      fn,
    );
    r.send({
      type: 'manifest',
      status: 'drift',
      serverKey: 'k',
      fingerprint: 'fp',
      changes: ['tool added: x'],
    });
    await r.flush();
    expect(fn).toHaveBeenCalled();
  });

  it('does not throw on non-200 response', async () => {
    const fn = mockFail(500);
    const r = createReporter(
      { enabled: true, url: 'https://collector.example/ingest', batchSize: 1, flushIntervalMs: 10 },
      fn,
    );
    r.send({
      type: 'detection',
      layer: 1,
      verdict: 'malicious',
      confidence: 1,
      toolName: 't',
      contentHash: 'h',
      patterns: [],
    });
    await r.flush();
    expect(fn).toHaveBeenCalled();
  });

  it('includes the Authorization header when secret is set', async () => {
    const { fn, calls } = mockOk();
    const r = createReporter(
      {
        enabled: true,
        url: 'https://collector.example/ingest',
        secret: 'shared-secret-123',
        batchSize: 1,
        flushIntervalMs: 10,
      },
      fn,
    );
    r.send({
      type: 'detection',
      layer: 1,
      verdict: 'clean',
      confidence: 0,
      toolName: 't',
      contentHash: 'h',
      patterns: [],
    });
    await r.flush();
    expect(calls[0]!.headers.Authorization).toBe('Bearer shared-secret-123');
  });

  it('attaches install id, event id, and timestamp', async () => {
    const { fn, calls } = mockOk();
    const r = createReporter(
      { enabled: true, url: 'https://collector.example/ingest', batchSize: 1, flushIntervalMs: 10 },
      fn,
    );
    r.send({
      type: 'detection',
      layer: 2,
      verdict: 'suspicious',
      confidence: 0.6,
      toolName: 'read_file',
      contentHash: 'abc',
      patterns: ['corpus:io-001:instruction_override'],
    });
    await r.flush();
    const event = calls[0]!.body.events[0];
    expect(event.id).toBeTruthy();
    expect(event.installId).toBeTruthy();
    expect(typeof event.ts).toBe('number');
    expect(event.contentHash).toBe('abc'); // already hashed by caller
    // Most importantly: nothing resembling raw content should ever leak.
    expect(JSON.stringify(event)).not.toMatch(/IGNORE PREVIOUS INSTRUCTIONS/i);
  });

  it('shutdown() flushes pending events', async () => {
    const { fn, calls } = mockOk();
    const r = createReporter(
      { enabled: true, url: 'https://collector.example/ingest', batchSize: 100, flushIntervalMs: 60_000 },
      fn,
    );
    r.send({
      type: 'detection',
      layer: 1,
      verdict: 'malicious',
      confidence: 1,
      toolName: 't',
      contentHash: 'h',
      patterns: [],
    });
    await r.shutdown();
    expect(calls).toHaveLength(1);
  });
});

describe('sha256Hex', () => {
  it('is stable', () => {
    expect(sha256Hex('hello')).toBe(sha256Hex('hello'));
  });
  it('differs for different inputs', () => {
    expect(sha256Hex('hello')).not.toBe(sha256Hex('world'));
  });
});
