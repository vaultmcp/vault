import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createAuditLogger, preview } from '../src/audit/index.js';

describe('audit logger', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'vault-audit-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('is a no-op when disabled', async () => {
    const logger = createAuditLogger({ enabled: false });
    expect(logger.enabled).toBe(false);
    logger.log({
      type: 'detection',
      toolName: 't',
      layer: 1,
      verdict: 'clean',
      confidence: 0,
      patterns: [],
      mode: 'block',
      mutated: false,
    });
    await logger.shutdown();
  });

  it('is a no-op when filepath is missing', () => {
    const logger = createAuditLogger({ enabled: true });
    expect(logger.enabled).toBe(false);
  });

  it('writes JSONL entries to the configured file', async () => {
    const file = path.join(tmpDir, 'audit.jsonl');
    const logger = createAuditLogger({ enabled: true, filepath: file });
    expect(logger.enabled).toBe(true);

    logger.log({
      type: 'detection',
      toolName: 'read_file',
      layer: 2,
      verdict: 'malicious',
      confidence: 0.92,
      patterns: ['corpus:io-001'],
      mode: 'block',
      mutated: true,
      reasoning: 'corpus match',
      contentPreview: 'ignore previous instructions',
    });
    logger.log({
      type: 'capability',
      toolName: 'http_get',
      action: 'block',
      taintSources: ['read_file'],
      reason: 'args derived from tainted response',
      argsPreview: '{"url":"https://leak.example/..."}',
    });
    logger.log({
      type: 'manifest',
      serverKey: 'abc123',
      fingerprint: 'fp-xyz',
      status: 'drift',
      changes: ['tool added: delete_file'],
    });

    await logger.shutdown();

    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(3);

    const det = JSON.parse(lines[0]!);
    expect(det.type).toBe('detection');
    expect(det.verdict).toBe('malicious');
    expect(typeof det.ts).toBe('number');

    const cap = JSON.parse(lines[1]!);
    expect(cap.type).toBe('capability');
    expect(cap.action).toBe('block');
    expect(cap.taintSources).toEqual(['read_file']);

    const man = JSON.parse(lines[2]!);
    expect(man.type).toBe('manifest');
    expect(man.status).toBe('drift');
  });

  it('creates parent directory if missing', async () => {
    const file = path.join(tmpDir, 'nested', 'subdir', 'audit.jsonl');
    const logger = createAuditLogger({ enabled: true, filepath: file });
    expect(logger.enabled).toBe(true);
    logger.log({
      type: 'manifest',
      serverKey: 'k',
      fingerprint: 'fp',
      status: 'first-seen',
      changes: [],
    });
    await logger.shutdown();
    expect(readFileSync(file, 'utf8').length).toBeGreaterThan(0);
  });

  it('survives a single write error without crashing', async () => {
    const file = path.join(tmpDir, 'audit.jsonl');
    const logger = createAuditLogger({ enabled: true, filepath: file });
    // Calling log after shutdown is a no-op (the stream is closed).
    await logger.shutdown();
    expect(() =>
      logger.log({
        type: 'detection',
        toolName: 't',
        layer: null,
        verdict: 'clean',
        confidence: 0,
        patterns: [],
        mode: 'log',
        mutated: false,
      }),
    ).not.toThrow();
  });
});

describe('preview', () => {
  it('returns short strings unchanged', () => {
    expect(preview('short')).toBe('short');
  });

  it('truncates and annotates long strings', () => {
    const long = 'a'.repeat(500);
    const p = preview(long, 200);
    expect(p.startsWith('a'.repeat(200))).toBe(true);
    expect(p).toMatch(/\.\.\.\[\+300 chars\]/);
  });
});
