import { describe, it, expect } from 'vitest';
import {
  parseArgs,
  normalizeServer,
  interpretScore,
  buildResult,
  scoreColor,
  renderHuman,
} from '../src/index';

describe('parseArgs', () => {
  it('parses positional server', () => {
    const a = parseArgs(['stdio:npx']);
    expect(a.server).toBe('stdio:npx');
  });
  it('defaults network to base-sepolia', () => {
    const a = parseArgs([]);
    expect(a.network).toBe('base-sepolia');
  });
  it('parses --json --all --network base', () => {
    const a = parseArgs(['--all', '--json', '--network', 'base']);
    expect(a.all).toBe(true);
    expect(a.json).toBe(true);
    expect(a.network).toBe('base');
  });
  it('rejects unknown network', () => {
    expect(() => parseArgs(['--network', 'arbitrum'])).toThrow(/unknown network/);
  });
  it('rejects unknown flag', () => {
    expect(() => parseArgs(['--garbage'])).toThrow();
  });
  it('--help', () => {
    expect(parseArgs(['--help']).showHelp).toBe(true);
    expect(parseArgs(['-h']).showHelp).toBe(true);
  });
  it('--version', () => {
    expect(parseArgs(['--version']).showVersion).toBe(true);
    expect(parseArgs(['-v']).showVersion).toBe(true);
  });
});

describe('normalizeServer', () => {
  it('preserves http URLs', () => {
    expect(normalizeServer('https://mcp.example.com/v1')).toBe('https://mcp.example.com/v1');
    expect(normalizeServer('http://localhost:8800')).toBe('http://localhost:8800');
  });
  it('preserves existing stdio: prefix', () => {
    expect(normalizeServer('stdio:npx:@modelcontextprotocol/server-filesystem')).toBe(
      'stdio:npx:@modelcontextprotocol/server-filesystem',
    );
  });
  it('prefixes bare commands', () => {
    expect(normalizeServer('npx')).toBe('stdio:npx');
    expect(normalizeServer('uvx')).toBe('stdio:uvx');
  });
});

describe('interpretScore', () => {
  it('zero scans = unknown', () => {
    expect(interpretScore(1000, 0, 0)).toMatch(/unknown/);
  });
  it('zero blocks = no threats', () => {
    expect(interpretScore(1000, 50, 0)).toMatch(/no threats/);
  });
  it('low threat (score >= 800)', () => {
    expect(interpretScore(900, 100, 5)).toMatch(/generally safe/);
  });
  it('elevated threat (500-800)', () => {
    expect(interpretScore(600, 100, 30)).toMatch(/review before connecting/);
  });
  it('high threat (< 500)', () => {
    expect(interpretScore(200, 100, 70)).toMatch(/HIGH/);
  });
});

describe('buildResult', () => {
  it('computes blockRate and explorer URL', () => {
    const r = buildResult(
      'stdio:npx',
      { score: 800, scans: 10, blocks: 2 },
      'base-sepolia',
      '0x3A977E4D8BA43367cc41BB4695feFF4615fec189',
    );
    expect(r.blockRate).toBeCloseTo(0.2);
    expect(r.explorer).toContain('sepolia.basescan.org');
  });
  it('uses base mainnet explorer', () => {
    const r = buildResult(
      'stdio:npx',
      { score: 1000, scans: 0, blocks: 0 },
      'base',
      '0x0000000000000000000000000000000000000001',
    );
    expect(r.explorer).toMatch(/^https:\/\/basescan\.org\//);
  });
});

describe('scoreColor', () => {
  it('returns a function regardless of state', () => {
    expect(typeof scoreColor(1000, 0)).toBe('function');
    expect(typeof scoreColor(900, 50)).toBe('function');
    expect(typeof scoreColor(400, 50)).toBe('function');
  });
});

describe('renderHuman', () => {
  it('includes server, score, scans, blocks, explorer', () => {
    const r = buildResult(
      'https://mcp.example.com',
      { score: 750, scans: 20, blocks: 5 },
      'base-sepolia',
      '0x3A977E4D8BA43367cc41BB4695feFF4615fec189',
    );
    const out = renderHuman(r);
    expect(out).toContain('https://mcp.example.com');
    expect(out).toContain('750/1000');
    expect(out).toContain('scans 20');
    expect(out).toContain('blocks 5');
  });
});
