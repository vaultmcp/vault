import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createScanStore, type ScanStore } from '../src/persistence/store.js';
import { redact } from '../src/persistence/redact.js';

let tmpDir: string;
let store: ScanStore;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'vault-persist-'));
  store = createScanStore({ enabled: true, dbPath: path.join(tmpDir, 'scans.db'), retentionDays: 0 });
});

afterEach(() => {
  try { store.close(); } catch {}
  rmSync(tmpDir, { recursive: true, force: true });
});

const sampleInput = (overrides: Partial<Parameters<ScanStore['insert']>[0]> = {}) => ({
  serverKey: 'stdio:npx:test-server',
  transport: 'stdio' as const,
  toolName: 'read_file',
  verdict: 'clean' as const,
  layer: 2,
  confidence: 0.42,
  patterns: [],
  contentHash: 'deadbeef',
  rawText: 'hello world',
  reasoning: null,
  mode: 'block',
  mutated: false,
  ...overrides,
});

describe('persistence — schema and basic CRUD', () => {
  it('disabled config returns NOOP store', () => {
    const noop = createScanStore({ enabled: false });
    expect(noop.enabled).toBe(false);
    noop.insert(sampleInput());
    expect(noop.list()).toEqual([]);
    expect(noop.total()).toBe(0);
  });

  it('inserts and lists scans', () => {
    store.insert(sampleInput());
    store.insert(sampleInput({ verdict: 'malicious', toolName: 'eval' }));
    const rows = store.list();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.verdict).toBe('malicious'); // newest first
    expect(rows[1]!.verdict).toBe('clean');
  });

  it('countByVerdict aggregates by verdict', () => {
    store.insert(sampleInput({ verdict: 'clean' }));
    store.insert(sampleInput({ verdict: 'clean' }));
    store.insert(sampleInput({ verdict: 'malicious' }));
    expect(store.countByVerdict()).toEqual({ clean: 2, suspicious: 0, malicious: 1 });
  });

  it('filters by verdict', () => {
    store.insert(sampleInput({ verdict: 'clean' }));
    store.insert(sampleInput({ verdict: 'malicious' }));
    expect(store.list({ verdict: 'malicious' })).toHaveLength(1);
  });

  it('filters by serverKey', () => {
    store.insert(sampleInput({ serverKey: 'http://a' }));
    store.insert(sampleInput({ serverKey: 'http://b' }));
    expect(store.list({ serverKey: 'http://b' })).toHaveLength(1);
  });

  it('filters by since (ms epoch)', () => {
    store.insert(sampleInput());
    const future = Date.now() + 60_000;
    expect(store.list({ since: future })).toHaveLength(0);
  });

  it('topTools ranks by total count', () => {
    for (let i = 0; i < 5; i++) store.insert(sampleInput({ toolName: 'read_file' }));
    for (let i = 0; i < 3; i++) store.insert(sampleInput({ toolName: 'http_get', verdict: 'malicious' }));
    const top = store.topTools();
    expect(top[0]!.toolName).toBe('read_file');
    expect(top[0]!.total).toBe(5);
    expect(top[1]!.toolName).toBe('http_get');
    expect(top[1]!.malicious).toBe(3);
  });

  it('persists patterns as JSON array', () => {
    store.insert(sampleInput({ patterns: ['instruction_override', 'role_hijack'] }));
    const r = store.list()[0]!;
    expect(r.patterns).toEqual(['instruction_override', 'role_hijack']);
  });
});

describe('persistence — retention', () => {
  it('purgeOlderThan removes rows older than cutoff', () => {
    store.insert(sampleInput());
    store.insert(sampleInput());
    const purged = store.purgeOlderThan(Date.now() + 60_000);
    expect(purged).toBe(2);
    expect(store.total()).toBe(0);
  });

  it('retentionDays purges on open', () => {
    // Insert an old row manually by closing/reopening with retention
    store.insert(sampleInput());
    store.close();

    // Reopen with retention=0.0001 days (~8.6s); insert is fresh so it stays
    const dbPath = path.join(tmpDir, 'scans.db');
    const reopened = createScanStore({ enabled: true, dbPath, retentionDays: 30 });
    expect(reopened.total()).toBe(1);
    reopened.close();
  });
});

describe('persistence — content preview redaction', () => {
  it('redacts the preview before storage', () => {
    store.insert(sampleInput({
      rawText: 'Use this key: sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA to authenticate',
    }));
    const r = store.list()[0]!;
    expect(r.contentPreview).not.toContain('sk-ant-api03-');
    expect(r.contentPreview).toContain('[REDACTED');
  });

  it('truncates long previews', () => {
    const big = 'a'.repeat(2000);
    store.insert(sampleInput({ rawText: big }));
    const r = store.list()[0]!;
    expect(r.contentPreview.length).toBeLessThan(250);
  });
});

describe('persistence — redact()', () => {
  it('redacts anthropic-style keys', () => {
    expect(redact('here is sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAA stop'))
      .toContain('[REDACTED_API_KEY]');
  });
  it('redacts github tokens', () => {
    expect(redact('token=ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'))
      .toContain('[REDACTED');
  });
  it('redacts AWS access keys', () => {
    expect(redact('AKIAIOSFODNN7EXAMPLE')).toContain('[REDACTED_AWS_KEY]');
  });
  it('redacts emails', () => {
    expect(redact('contact alice@example.com')).toContain('[REDACTED_EMAIL]');
  });
  it('redacts SSN-like strings', () => {
    expect(redact('SSN 123-45-6789')).toContain('[REDACTED_SSN]');
  });
  it('redacts JWTs', () => {
    expect(redact('Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'))
      .toContain('[REDACTED');
  });
  it('preserves benign text unchanged', () => {
    const t = 'The temperature in San Francisco is 64°F.';
    expect(redact(t)).toBe(t);
  });
  it('redacts long hex secrets (private-key shaped)', () => {
    const hex = 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456';
    expect(redact(hex)).toContain('[REDACTED_HEX_SECRET]');
    expect(redact(hex)).not.toContain('123456');
  });
  it('does NOT redact short hex strings (commit hashes)', () => {
    expect(redact('commit abc123')).toBe('commit abc123');
    expect(redact('commit 8d230e4cafe')).toBe('commit 8d230e4cafe');
  });
  it('redacts macOS home-directory paths', () => {
    expect(redact('/Users/realname/Documents/secret.txt'))
      .toContain('/Users/[REDACTED_USER]');
  });
  it('redacts linux home-directory paths', () => {
    expect(redact('/home/alice/.ssh/id_rsa')).toContain('/home/[REDACTED_USER]');
  });
});
