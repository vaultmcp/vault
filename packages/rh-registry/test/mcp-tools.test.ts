import { describe, it, expect } from 'vitest';
import { loadStore } from '../src/store.js';
import { TOOLS, callRegistryTool, checkServer } from '../src/mcp-tools.js';
import { handle } from '../src/mcp-server.js';

const store = loadStore();

describe('registry MCP tools', () => {
  it('advertises the three query tools with object schemas', () => {
    expect(TOOLS.map((t) => t.name)).toEqual([
      'check_mcp_server',
      'list_mcp_servers',
      'registry_summary',
    ]);
    for (const t of TOOLS) expect(t.inputSchema.type).toBe('object');
  });

  it('recommends "allow" for a scanned, finding-free server', () => {
    const v = checkServer(store, { id: 'rh-example-official-quotes' });
    expect(v.found).toBe(true);
    expect(v.recommendation).toBe('allow');
  });

  it('recommends "caution" for a flagged server and reports the finding count', () => {
    const v = checkServer(store, { id: 'rh-example-yield-router' });
    expect(v.recommendation).toBe('caution');
    expect(v.summary).toMatch(/FLAGGED/);
  });

  it('recommends "caution" for an unscanned server', () => {
    const v = checkServer(store, { id: 'rh-example-portfolio-agent' });
    expect(v.recommendation).toBe('caution');
  });

  it('recommends "unknown" for a server not in the registry', () => {
    const v = checkServer(store, { endpoint: 'https://totally-unknown.example/mcp' });
    expect(v.found).toBe(false);
    expect(v.recommendation).toBe('unknown');
  });

  it('looks up a server by endpoint', () => {
    const v = checkServer(store, {
      endpoint: 'https://mcp.example.robinhood-chain.example/quotes',
    });
    expect(v.entry?.id).toBe('rh-example-official-quotes');
  });

  it('list_mcp_servers filters by scanStatus', () => {
    const all = callRegistryTool(store, 'list_mcp_servers', {}) as { count: number };
    const flagged = callRegistryTool(store, 'list_mcp_servers', { scanStatus: 'flagged' }) as {
      count: number;
    };
    expect(all.count).toBeGreaterThan(flagged.count);
    expect(flagged.count).toBe(1);
  });
});

describe('registry MCP server framing', () => {
  it('returns the tool list on tools/list', () => {
    const res = handle(store, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res && 'result' in res && (res.result as any).tools.length).toBe(3);
  });

  it('returns a structured verdict on tools/call check_mcp_server', () => {
    const res = handle(store, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'check_mcp_server', arguments: { id: 'rh-example-yield-router' } },
    });
    const r = res && 'result' in res ? (res.result as any) : null;
    expect(r.isError).toBe(false);
    expect(r.structuredContent.recommendation).toBe('caution');
  });

  it('gives no response to a notification (no id)', () => {
    const res = handle(store, { jsonrpc: '2.0', method: 'tools/list' });
    expect(res).toBeNull();
  });
});
