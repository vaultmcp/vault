import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  parseArgs,
  isAlreadyWrapped,
  isBashShellCommand,
  resolveRelativeArgs,
  planEntry,
  planConfig,
  applyPlan,
  applyUnwrap,
  renderPlan,
} from '../src/cli/init.js';
import { writeFileSync, readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('vault init — parseArgs', () => {
  it('default is "init"', () => {
    const a = parseArgs([]);
    expect(a.command).toBe('init');
    expect(a.yes).toBe(false);
    expect(a.dryRun).toBe(false);
  });
  it('detects unwrap subcommand', () => {
    const a = parseArgs(['unwrap']);
    expect(a.command).toBe('unwrap');
  });
  it('flags', () => {
    const a = parseArgs(['--yes', '--dry-run', '--config', '/x.json']);
    expect(a.yes).toBe(true);
    expect(a.dryRun).toBe(true);
    expect(a.configOverride).toBe('/x.json');
  });
  it('rejects unknown flag', () => {
    expect(() => parseArgs(['--garbage'])).toThrow();
  });
});

describe('vault init — isAlreadyWrapped', () => {
  it('detects npx @vault/mcp-proxy wrap', () => {
    expect(isAlreadyWrapped({ command: 'npx', args: ['-y', '@vault/mcp-proxy', '--', 'x'] })).toBe(true);
  });
  it('detects npx.cmd wrap (Windows)', () => {
    expect(isAlreadyWrapped({ command: 'npx.cmd', args: ['@vault/mcp-proxy', '--', 'x'] })).toBe(true);
  });
  it('detects global mcp-proxy bin', () => {
    expect(isAlreadyWrapped({ command: 'mcp-proxy', args: ['--', 'x'] })).toBe(true);
  });
  it('does NOT flag plain npx servers', () => {
    expect(isAlreadyWrapped({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] })).toBe(false);
  });
  it('does NOT flag uvx', () => {
    expect(isAlreadyWrapped({ command: 'uvx', args: ['mcp-server-git'] })).toBe(false);
  });
});

describe('vault init — isBashShellCommand', () => {
  it('flags bash -c', () => {
    expect(isBashShellCommand({ command: 'bash', args: ['-c', 'echo hi'] })).toBe(true);
  });
  it('flags sh -c, zsh -c', () => {
    expect(isBashShellCommand({ command: 'sh', args: ['-c', 'x'] })).toBe(true);
    expect(isBashShellCommand({ command: 'zsh', args: ['-c', 'x'] })).toBe(true);
  });
  it('flags Windows cmd /c', () => {
    expect(isBashShellCommand({ command: 'cmd', args: ['/c', 'x'] })).toBe(true);
  });
  it('does NOT flag bash without -c (interactive shell wouldn\'t be in mcp config anyway)', () => {
    expect(isBashShellCommand({ command: 'bash', args: ['script.sh'] })).toBe(false);
  });
  it('does NOT flag node, python, uvx, etc.', () => {
    expect(isBashShellCommand({ command: 'node', args: ['server.js'] })).toBe(false);
    expect(isBashShellCommand({ command: 'python', args: ['-m', 'mcp_server'] })).toBe(false);
  });
});

describe('vault init — resolveRelativeArgs', () => {
  it('resolves ./ relative paths', () => {
    const r = resolveRelativeArgs(['./server.js'], '/home/user/project');
    expect(r[0]).toBe('/home/user/project/server.js');
  });
  it('resolves ../ relative paths', () => {
    const r = resolveRelativeArgs(['../other/file.js'], '/home/user/project');
    expect(r[0]).toBe('/home/user/other/file.js');
  });
  it('leaves absolute paths alone', () => {
    const r = resolveRelativeArgs(['/abs/path/server.js'], '/home/user');
    expect(r[0]).toBe('/abs/path/server.js');
  });
  it('leaves non-path flags alone', () => {
    const r = resolveRelativeArgs(['-y', '@scope/pkg', '--port', '8080'], '/home/user');
    expect(r).toEqual(['-y', '@scope/pkg', '--port', '8080']);
  });
});

describe('vault init — planEntry', () => {
  const cfgDir = '/home/user';

  it('wraps a stdio server (npx)', () => {
    const a = planEntry('fs', { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'] }, cfgDir);
    expect(a.kind).toBe('wrap-stdio');
    if (a.kind === 'wrap-stdio') {
      expect(a.after.command).toBe('npx');
      expect(a.after.args).toEqual(['-y', '@vault/mcp-proxy', '--', 'npx', '-y', '@modelcontextprotocol/server-filesystem', '/tmp']);
    }
  });

  it('wraps a uvx server', () => {
    const a = planEntry('git', { command: 'uvx', args: ['mcp-server-git'] }, cfgDir);
    expect(a.kind).toBe('wrap-stdio');
    if (a.kind === 'wrap-stdio') {
      expect(a.after.args).toEqual(['-y', '@vault/mcp-proxy', '--', 'uvx', 'mcp-server-git']);
    }
  });

  it('wraps an HTTP server as --transport http --upstream', () => {
    const a = planEntry('remote', { url: 'https://mcp.example.com/v1' }, cfgDir);
    expect(a.kind).toBe('wrap-http');
    if (a.kind === 'wrap-http') {
      expect(a.after.command).toBe('npx');
      expect(a.after.args).toEqual(['-y', '@vault/mcp-proxy', '--transport', 'http', '--upstream', 'https://mcp.example.com/v1']);
      expect(a.after.url).toBeUndefined();
    }
  });

  it('skips already-wrapped silently', () => {
    const a = planEntry(
      'fs',
      { command: 'npx', args: ['-y', '@vault/mcp-proxy', '--', 'x'] },
      cfgDir,
    );
    expect(a.kind).toBe('skip-wrapped');
  });

  it('warns + skips bash -c commands', () => {
    const a = planEntry('weird', { command: 'bash', args: ['-c', 'cd /x && node y.js'] }, cfgDir);
    expect(a.kind).toBe('skip-bash-shell');
  });

  it('skips disabled servers', () => {
    const a = planEntry('off', { command: 'node', args: ['s.js'], disabled: true }, cfgDir);
    expect(a.kind).toBe('skip-disabled');
  });

  it('preserves env block when wrapping', () => {
    const a = planEntry(
      'github',
      { command: 'npx', args: ['@scope/server'], env: { TOKEN: 'xxx' } },
      cfgDir,
    );
    expect(a.kind).toBe('wrap-stdio');
    if (a.kind === 'wrap-stdio') {
      expect(a.after.env).toEqual({ TOKEN: 'xxx' });
    }
  });

  it('resolves relative paths in args', () => {
    const a = planEntry('local', { command: 'node', args: ['./server.js'] }, '/home/u/project');
    if (a.kind === 'wrap-stdio') {
      expect(a.after.args).toContain('/home/u/project/server.js');
    }
  });

  it('skips entries with no command or url', () => {
    const a = planEntry('broken', {}, cfgDir);
    expect(a.kind).toBe('skip-invalid');
  });

  it('skips http url that is not http(s)', () => {
    const a = planEntry('bad', { url: 'file:///etc/passwd' }, cfgDir);
    expect(a.kind).toBe('skip-invalid');
  });
});

describe('vault init — planConfig + applyPlan (filesystem round-trip)', () => {
  let tmpDir: string;
  let cfgPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'vault-init-test-'));
    cfgPath = path.join(tmpDir, 'config.json');
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes wrapped config + backup + is idempotent', () => {
    writeFileSync(
      cfgPath,
      JSON.stringify({
        mcpServers: {
          fs: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'] },
          remote: { url: 'https://mcp.example.com/v1' },
        },
      }),
    );

    const plan1 = planConfig(cfgPath);
    expect(plan1.actions.filter((a) => a.kind === 'wrap-stdio')).toHaveLength(1);
    expect(plan1.actions.filter((a) => a.kind === 'wrap-http')).toHaveLength(1);

    const r1 = applyPlan(plan1);
    expect(r1.written).toBe(true);
    expect(r1.wrapped).toBe(2);
    expect(existsSync(cfgPath + '.vault-backup')).toBe(true);

    // 2nd run — fully idempotent: nothing to wrap.
    const plan2 = planConfig(cfgPath);
    expect(plan2.actions.every((a) => a.kind === 'skip-wrapped')).toBe(true);
    const r2 = applyPlan(plan2);
    expect(r2.written).toBe(false);
  });

  it('unwrap restores byte-for-byte', () => {
    const original = JSON.stringify(
      {
        mcpServers: {
          fs: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'] },
        },
      },
      null,
      2,
    );
    writeFileSync(cfgPath, original);
    applyPlan(planConfig(cfgPath));
    expect(readFileSync(cfgPath, 'utf8')).not.toBe(original); // changed

    const r = applyUnwrap(cfgPath);
    expect(r.restored).toBe(true);
    expect(readFileSync(cfgPath, 'utf8')).toBe(original); // restored exactly
  });

  it('handles malformed JSON gracefully', () => {
    writeFileSync(cfgPath, '{ this is not json');
    const plan = planConfig(cfgPath);
    expect(plan.actions[0]?.kind).toBe('skip-invalid');
  });

  it('handles missing file', () => {
    const plan = planConfig('/nonexistent/path.json');
    expect(plan.exists).toBe(false);
    expect(plan.actions).toEqual([]);
  });
});

describe('vault init — renderPlan', () => {
  it('renders all action kinds', () => {
    const plan = {
      path: '/x/config.json',
      exists: true,
      actions: [
        { kind: 'wrap-stdio' as const, name: 'a', before: { command: 'npx', args: ['x'] }, after: { command: 'npx', args: ['-y', '@vault/mcp-proxy', '--', 'npx', 'x'] } },
        { kind: 'skip-wrapped' as const, name: 'b' },
        { kind: 'skip-bash-shell' as const, name: 'c', reason: 'shell-wrapped' },
        { kind: 'skip-disabled' as const, name: 'd' },
        { kind: 'skip-invalid' as const, name: 'e', reason: 'no command' },
      ],
    };
    const out = renderPlan(plan);
    expect(out).toContain('a');
    expect(out).toContain('b');
    expect(out).toContain('already wrapped');
    expect(out).toContain('disabled');
    expect(out).toContain('shell-wrapped');
  });
});
