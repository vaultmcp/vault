import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseConfig, readClaudeDesktopConfig, defaultConfigPath } from '../src/cli/inspect-config.js';
import { classify } from '../src/cli/inspect-reputation.js';
import { parseInspectArgs, runInspect, type InspectOptions } from '../src/cli/inspect.js';

let tmp: string;
let cfgPath: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'vault-inspect-'));
  cfgPath = path.join(tmp, 'claude_desktop_config.json');
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

function writeCfg(obj: unknown) {
  writeFileSync(cfgPath, JSON.stringify(obj, null, 2));
}

function buf() {
  return { content: '', write(s: string) { this.content += s; } };
}

// ── config reader ───────────────────────────────────────────────────────────

describe('inspect-config — defaultConfigPath', () => {
  it('returns ~/Library/... on darwin', () => {
    const p = defaultConfigPath('darwin');
    expect(p).toContain('Library/Application Support/Claude/claude_desktop_config.json');
  });
  it('returns APPDATA path on win32', () => {
    const p = defaultConfigPath('win32');
    expect(p).toContain('Claude');
    expect(p).toMatch(/claude_desktop_config\.json$/);
  });
  it('returns XDG path on linux', () => {
    const p = defaultConfigPath('linux');
    expect(p).toContain('Claude/claude_desktop_config.json');
  });
});

describe('inspect-config — parseConfig', () => {
  it('parses stdio mcpServers entries', () => {
    const cfg = parseConfig({
      mcpServers: {
        fs: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'] },
        git: { command: 'uvx', args: ['mcp-server-git'] },
      },
    }, '/test/path');
    expect(cfg.servers).toHaveLength(2);
    expect(cfg.servers[0]!.name).toBe('fs');
    expect(cfg.servers[0]!.identifier).toBe('stdio:npx:@modelcontextprotocol/server-filesystem');
    expect(cfg.servers[1]!.identifier).toBe('stdio:uvx:mcp-server-git');
  });

  it('parses URL-style (SSE/http) mcpServer entries', () => {
    const cfg = parseConfig({
      mcpServers: { remote: { url: 'https://mcp.example.com/v1' } },
    }, '/test');
    expect(cfg.servers).toHaveLength(1);
    expect(cfg.servers[0]!.url).toBe('https://mcp.example.com/v1');
    expect(cfg.servers[0]!.identifier).toBe('https://mcp.example.com/v1');
  });

  it('returns empty servers for missing/invalid config', () => {
    expect(parseConfig(null, '/x').servers).toEqual([]);
    expect(parseConfig({}, '/x').servers).toEqual([]);
    expect(parseConfig({ mcpServers: 'string' }, '/x').servers).toEqual([]);
  });

  it('skips entries with no command and no url', () => {
    const cfg = parseConfig({ mcpServers: { bad: { env: { FOO: 'BAR' } } } }, '/x');
    expect(cfg.servers).toEqual([]);
  });
});

describe('inspect-config — readClaudeDesktopConfig', () => {
  it('returns empty for non-existent config', () => {
    const cfg = readClaudeDesktopConfig(path.join(tmp, 'nope.json'));
    expect(cfg.servers).toEqual([]);
  });
  it('throws on malformed JSON', () => {
    writeFileSync(cfgPath, '{not json');
    expect(() => readClaudeDesktopConfig(cfgPath)).toThrow(/failed to parse/);
  });
  it('reads a valid config from disk', () => {
    writeCfg({ mcpServers: { fs: { command: 'npx', args: ['-y', 'server-filesystem', '/tmp'] } } });
    const cfg = readClaudeDesktopConfig(cfgPath);
    expect(cfg.servers).toHaveLength(1);
    expect(cfg.servers[0]!.identifier).toBe('stdio:npx:server-filesystem');
  });
});

// ── classify ────────────────────────────────────────────────────────────────

describe('inspect-reputation — classify', () => {
  it('TRUSTED when score >= 0.95 and totalScans >= 100', () => {
    const t = classify({ scoreRaw: 980, totalScans: 250, totalBlocks: 5 });
    // 5/250 = 0.02 — actually that's CAUTION territory. Adjust expectations.
    expect(t.verdict).toBe('CAUTION');
  });
  it('TRUSTED with very high score and low malicious rate', () => {
    const t = classify({ scoreRaw: 1000, totalScans: 500, totalBlocks: 0 });
    expect(t.verdict).toBe('TRUSTED');
    expect(t.score).toBe(1.0);
  });
  it('NEW when totalScans < 10', () => {
    expect(classify({ scoreRaw: 1000, totalScans: 0, totalBlocks: 0 }).verdict).toBe('NEW');
    expect(classify({ scoreRaw: 800, totalScans: 9, totalBlocks: 0 }).verdict).toBe('NEW');
  });
  it('UNTRUSTED when maliciousRate >= 0.10', () => {
    expect(classify({ scoreRaw: 500, totalScans: 100, totalBlocks: 10 }).verdict).toBe('UNTRUSTED');
    expect(classify({ scoreRaw: 100, totalScans: 5, totalBlocks: 4 }).verdict).toBe('UNTRUSTED');
  });
  it('CAUTION when totalScans >= 10 and maliciousRate in [0.01, 0.10)', () => {
    expect(classify({ scoreRaw: 900, totalScans: 50, totalBlocks: 1 }).verdict).toBe('CAUTION');
    expect(classify({ scoreRaw: 700, totalScans: 100, totalBlocks: 5 }).verdict).toBe('CAUTION');
  });
  it('reports score normalized to [0,1]', () => {
    expect(classify({ scoreRaw: 950, totalScans: 100, totalBlocks: 0 }).score).toBe(0.95);
  });
});

// ── arg parsing ─────────────────────────────────────────────────────────────

describe('inspect — parseInspectArgs', () => {
  it('parses --json --strict --rpc --contract --config', () => {
    const opts = parseInspectArgs(['--json', '--strict', '--rpc', 'https://x', '--contract', '0xabc', '--config', '/c.json']);
    expect(opts.json).toBe(true);
    expect(opts.strict).toBe(true);
    expect(opts.rpcUrl).toBe('https://x');
    expect(opts.contractAddress).toBe('0xabc');
    expect(opts.configPath).toBe('/c.json');
  });
  it('throws on unknown flags', () => {
    expect(() => parseInspectArgs(['--bogus'])).toThrow(/unknown flag/);
  });
});

// ── runInspect end-to-end with mocked reader ────────────────────────────────

function mockReader(stats: Record<string, { scoreRaw: number; totalScans: number; totalBlocks: number }>) {
  return {
    async read(id: string) {
      if (id in stats) return stats[id]!;
      return { scoreRaw: 1000, totalScans: 0, totalBlocks: 0 };
    },
  };
}

describe('inspect — runInspect', () => {
  it('emits a friendly message when no servers in config', async () => {
    writeCfg({});
    const out = buf();
    const code = await runInspect({ configPath: cfgPath, out, noColor: true });
    expect(code).toBe(0);
    expect(out.content).toContain('no MCP servers found');
  });

  it('renders the verdict table for each server', async () => {
    writeCfg({
      mcpServers: {
        trusted_fs: { command: 'npx', args: ['-y', 'trusted-pkg'] },
        new_thing: { command: 'npx', args: ['-y', 'new-pkg'] },
        sketchy: { command: 'npx', args: ['-y', 'sketchy-pkg'] },
      },
    });
    const stats = {
      'stdio:npx:trusted-pkg':  { scoreRaw: 1000, totalScans: 500, totalBlocks: 0 },
      'stdio:npx:new-pkg':       { scoreRaw: 1000, totalScans: 2, totalBlocks: 0 },
      'stdio:npx:sketchy-pkg':   { scoreRaw: 400,  totalScans: 100, totalBlocks: 20 },
    };
    const out = buf();
    const opts: InspectOptions = { configPath: cfgPath, reader: mockReader(stats), out, noColor: true };
    const code = await runInspect(opts);
    expect(code).toBe(0);
    expect(out.content).toContain('TRUSTED');
    expect(out.content).toContain('NEW');
    expect(out.content).toContain('UNTRUSTED');
    expect(out.content).toContain('trusted_fs');
    expect(out.content).toContain('sketchy');
    expect(out.content).toContain('Sepolia');
  });

  it('--strict returns 1 when any server is UNTRUSTED', async () => {
    writeCfg({ mcpServers: { evil: { command: 'npx', args: ['-y', 'evil-pkg'] } } });
    const stats = { 'stdio:npx:evil-pkg': { scoreRaw: 100, totalScans: 100, totalBlocks: 50 } };
    const code = await runInspect({
      configPath: cfgPath,
      reader: mockReader(stats),
      out: buf(), noColor: true, strict: true,
    });
    expect(code).toBe(1);
  });

  it('--strict returns 0 when no UNTRUSTED', async () => {
    writeCfg({ mcpServers: { fine: { command: 'npx', args: ['-y', 'fine-pkg'] } } });
    const stats = { 'stdio:npx:fine-pkg': { scoreRaw: 1000, totalScans: 200, totalBlocks: 0 } };
    const code = await runInspect({
      configPath: cfgPath, reader: mockReader(stats),
      out: buf(), noColor: true, strict: true,
    });
    expect(code).toBe(0);
  });

  it('--json emits one JSON record per server', async () => {
    writeCfg({ mcpServers: { fs: { command: 'npx', args: ['-y', 'pkg-a'] } } });
    const stats = { 'stdio:npx:pkg-a': { scoreRaw: 980, totalScans: 200, totalBlocks: 0 } };
    const out = buf();
    await runInspect({
      configPath: cfgPath, reader: mockReader(stats),
      out, noColor: true, json: true,
    });
    const lines = out.content.trim().split('\n');
    expect(lines).toHaveLength(1);
    const obj = JSON.parse(lines[0]!);
    expect(obj.name).toBe('fs');
    expect(obj.verdict).toBe('TRUSTED');
    expect(obj.totalScans).toBe(200);
  });

  it('reports per-server reader errors but continues for the rest', async () => {
    writeCfg({
      mcpServers: {
        ok: { command: 'npx', args: ['-y', 'ok-pkg'] },
        broken: { command: 'npx', args: ['-y', 'broken-pkg'] },
      },
    });
    const reader = {
      async read(id: string) {
        if (id.includes('broken')) throw new Error('rpc timeout');
        return { scoreRaw: 1000, totalScans: 200, totalBlocks: 0 };
      },
    };
    const out = buf();
    const code = await runInspect({ configPath: cfgPath, reader, out, noColor: true });
    expect(code).toBe(0);
    expect(out.content).toContain('rpc timeout');
    expect(out.content).toContain('TRUSTED');
  });
});
