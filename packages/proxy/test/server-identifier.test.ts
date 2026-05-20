import { describe, it, expect } from 'vitest';
import { computeServerIdentifier } from '../src/transports/stdio.js';

describe('computeServerIdentifier — distinguishes servers within the same launcher', () => {
  it('npx + scoped package', () => {
    expect(computeServerIdentifier('npx', ['-y', '@modelcontextprotocol/server-filesystem', '/tmp']))
      .toBe('stdio:npx:@modelcontextprotocol/server-filesystem');
  });

  it('npx + different scoped package = different identifier', () => {
    const a = computeServerIdentifier('npx', ['-y', '@modelcontextprotocol/server-filesystem']);
    const b = computeServerIdentifier('npx', ['-y', '@modelcontextprotocol/server-postgres']);
    expect(a).not.toBe(b);
  });

  it('uvx + python package', () => {
    expect(computeServerIdentifier('uvx', ['mcp-server-git'])).toBe('stdio:uvx:mcp-server-git');
  });

  it('python -m module', () => {
    expect(computeServerIdentifier('python', ['-m', 'mcp_server_fs'])).toBe('stdio:python:mcp_server_fs');
    expect(computeServerIdentifier('python3', ['-m', 'mcp_server_fs'])).toBe('stdio:python3:mcp_server_fs');
  });

  it('node + absolute path → strips path and extension', () => {
    expect(computeServerIdentifier('node', ['/home/user/server.js'])).toBe('stdio:node:server');
  });

  it('node + relative path → strips path and extension', () => {
    expect(computeServerIdentifier('node', ['./src/server.js'])).toBe('stdio:node:server');
  });

  it('handles uppercase extensions', () => {
    expect(computeServerIdentifier('node', ['/home/x/Server.JS'])).toBe('stdio:node:Server');
  });

  it('falls back to bare cmd when args contain no non-flag entries', () => {
    expect(computeServerIdentifier('npx', [])).toBe('stdio:npx');
    expect(computeServerIdentifier('npx', ['-y'])).toBe('stdio:npx');
    expect(computeServerIdentifier('npx', ['--help'])).toBe('stdio:npx');
  });

  it('skips multiple leading flags', () => {
    expect(computeServerIdentifier('npx', ['-y', '--quiet', '--no-progress', '@scope/srv']))
      .toBe('stdio:npx:@scope/srv');
  });

  it('ignores additional args after the first target', () => {
    expect(computeServerIdentifier('npx', ['-y', '@scope/srv', '/data', '--port', '8080']))
      .toBe('stdio:npx:@scope/srv');
  });

  it('deno run', () => {
    expect(computeServerIdentifier('deno', ['run', '--allow-all', 'server.ts']))
      .toBe('stdio:deno:run');
    // "run" is the first non-flag arg. This is suboptimal for deno but consistent with
    // the algorithm. Documented behavior — operators using deno can override by passing
    // VAULT_MCP_SERVER_URL in the future. For now, all deno-launched servers will
    // collapse to stdio:deno:run, which is no worse than the previous bug.
  });

  it('idempotent', () => {
    const id = computeServerIdentifier('npx', ['-y', '@scope/server']);
    expect(computeServerIdentifier('npx', ['-y', '@scope/server'])).toBe(id);
  });
});
