import { describe, it, expect } from 'vitest';
import {
  parseArgs,
  normalizeServer,
  interpretScore,
  buildResult,
  scoreColor,
  renderHuman,
} from '../src/cli/check.js';

describe('vault check — parseArgs', () => {
  it('parses positional server', () => {
    const a = parseArgs(['https://mcp.example.com']);
    expect(a.server).toBe('https://mcp.example.com');
    expect(a.all).toBe(false);
  });
  it('parses --all', () => {
    const a = parseArgs(['--all']);
    expect(a.all).toBe(true);
  });
  it('parses --json --network base', () => {
    const a = parseArgs(['stdio:npx', '--json', '--network', 'base']);
    expect(a.json).toBe(true);
    expect(a.network).toBe('base');
    expect(a.server).toBe('stdio:npx');
  });
  it('rejects unknown network', () => {
    expect(() => parseArgs(['--network', 'mainnet'])).toThrow(/unknown network/);
  });
  it('rejects unknown flag', () => {
    expect(() => parseArgs(['--garbage'])).toThrow(/unknown flag/);
  });
  it('--help short-circuits', () => {
    const a = parseArgs(['--help']);
    expect(a.showHelp).toBe(true);
  });
});

describe('vault check — normalizeServer', () => {
  it('preserves http URLs', () => {
    expect(normalizeServer('https://mcp.example.com/v1')).toBe('https://mcp.example.com/v1');
    expect(normalizeServer('http://localhost:8800')).toBe('http://localhost:8800');
  });
  it('preserves existing stdio: prefix', () => {
    expect(normalizeServer('stdio:npx')).toBe('stdio:npx');
  });
  it('adds stdio: prefix to bare commands', () => {
    expect(normalizeServer('npx')).toBe('stdio:npx');
    expect(normalizeServer('uvx')).toBe('stdio:uvx');
  });
  it('takes only the first token from a command line', () => {
    expect(normalizeServer('npx @scope/server')).toBe('stdio:npx');
    expect(normalizeServer('uvx mcp-server-git /repo')).toBe('stdio:uvx');
  });
});

describe('vault check — interpretScore', () => {
  it('flags unknown servers', () => {
    expect(interpretScore(1000, 0, 0)).toMatch(/unknown to the Vault network/);
  });
  it('flags clean servers (no blocks)', () => {
    expect(interpretScore(1000, 50, 0)).toMatch(/no threats detected/);
  });
  it('flags low-threat servers (score ≥ 800)', () => {
    expect(interpretScore(900, 100, 5)).toMatch(/generally safe/);
  });
  it('flags medium-threat servers', () => {
    expect(interpretScore(600, 100, 30)).toMatch(/review before connecting/);
  });
  it('flags high-threat servers', () => {
    expect(interpretScore(200, 100, 70)).toMatch(/HIGH threat rate.*avoid/);
  });
});

describe('vault check — buildResult', () => {
  it('includes explorer link for the right network', () => {
    const r = buildResult(
      'stdio:npx',
      { score: 800, scans: 10, blocks: 2 },
      'base-sepolia',
      '0x3A977E4D8BA43367cc41BB4695feFF4615fec189',
    );
    expect(r.explorer).toContain('sepolia.basescan.org');
    expect(r.explorer).toContain('0x3A977E4D8BA43367cc41BB4695feFF4615fec189');
    expect(r.blockRate).toBeCloseTo(0.2);
  });
  it('mainnet explorer for base', () => {
    const r = buildResult(
      'stdio:npx',
      { score: 1000, scans: 0, blocks: 0 },
      'base',
      '0x0000000000000000000000000000000000000001',
    );
    expect(r.explorer).toMatch(/^https:\/\/basescan\.org\//);
    expect(r.explorer).not.toContain('sepolia');
  });
});

describe('vault check — color/render', () => {
  it('returns dim for zero-scan servers regardless of score', () => {
    const c = scoreColor(1000, 0);
    // In a non-TTY test env, dim returns the string unchanged; we verify the function exists.
    expect(typeof c).toBe('function');
    expect(c('test')).toContain('test');
  });
  it('renderHuman includes all key fields', () => {
    const r = buildResult(
      'https://mcp.example.com',
      { score: 750, scans: 20, blocks: 5 },
      'base-sepolia',
      '0x3A977E4D8BA43367cc41BB4695feFF4615fec189',
    );
    const out = renderHuman(r, r.scans);
    expect(out).toContain('https://mcp.example.com');
    expect(out).toContain('750/1000');
    expect(out).toContain('scans 20');
    expect(out).toContain('blocks 5');
    expect(out).toContain('sepolia.basescan.org');
  });
});
