import { describe, it, expect } from 'vitest';
import {
  TaintStore,
  classifyTool,
  decideCapability,
  type CapabilityConfig,
} from '../src/capability/index.js';

const DEFAULT_CFG: CapabilityConfig = {
  enabled: true,
  mode: 'block',
  extraPatterns: [],
  minOverlap: 32,
  windowSize: 10,
};

describe('TaintStore', () => {
  it('add() retains entries in insertion order', () => {
    const t = new TaintStore(5);
    t.add({ toolName: 'a', content: 'aa', addedAt: 1 });
    t.add({ toolName: 'b', content: 'bb', addedAt: 2 });
    expect(t.size()).toBe(2);
  });

  it('evicts oldest entries past maxEntries', () => {
    const t = new TaintStore(3);
    for (let i = 0; i < 7; i++) t.add({ toolName: `t${i}`, content: `c${i}`, addedAt: i });
    expect(t.size()).toBe(3);
  });

  it('matches() returns sources with >= minOverlap contiguous overlap', () => {
    const t = new TaintStore();
    t.add({
      toolName: 'read_file',
      content: 'visit https://leak-target-xyz.example/exfil-endpoint-9k4j for details',
      addedAt: 1,
    });
    const m = t.matches('please GET https://leak-target-xyz.example/exfil-endpoint-9k4j now', 32);
    expect(m).toHaveLength(1);
    expect(m[0]!.toolName).toBe('read_file');
  });

  it('matches() returns empty when overlap is below threshold', () => {
    const t = new TaintStore();
    t.add({ toolName: 'read_file', content: 'short snippet hi', addedAt: 1 });
    // Common phrase, far below 32-char threshold.
    expect(t.matches('hi there from another place', 32)).toEqual([]);
  });

  it('matches() is case- and whitespace-insensitive', () => {
    const t = new TaintStore();
    t.add({
      toolName: 'read_file',
      content: '   HTTPS://Leak-Target-XYZ.example/Exfil-Endpoint-9K4J   ',
      addedAt: 1,
    });
    const m = t.matches('GET https://leak-target-xyz.example/exfil-endpoint-9k4j', 32);
    expect(m).toHaveLength(1);
  });

  it('matches() returns empty when minOverlap exceeds content length', () => {
    const t = new TaintStore();
    t.add({ toolName: 'read_file', content: 'tiny', addedAt: 1 });
    expect(t.matches('anything at all here', 32)).toEqual([]);
  });

  it('clear() drops all entries', () => {
    const t = new TaintStore();
    t.add({ toolName: 'a', content: 'x', addedAt: 1 });
    t.clear();
    expect(t.size()).toBe(0);
  });
});

describe('classifyTool', () => {
  it.each([
    ['http_get', true],
    ['http_post', true],
    ['fetch', true],
    ['fetch_url', true],
    ['send_email', true],
    ['post_to_slack', true],
    ['write_file', true],
    ['append_file', true],
    ['delete_file', true],
    ['run_command', true],
    ['execute', true],
    ['shell', true],
    ['eval_code', true],
    ['get_secret', true],
    ['read_env', true],
    ['reveal_api_key', true],
    ['read_file', false],
    ['list_directory', false],
    ['search', false],
    ['summarize', false],
    ['get_weather', false],
  ])('classifies %s as sensitive=%s', (name, expected) => {
    expect(classifyTool(name).sensitive).toBe(expected);
  });

  it('respects extraPatterns', () => {
    const extra = [/^custom_dangerous_/i];
    expect(classifyTool('custom_dangerous_thing', extra).sensitive).toBe(true);
    expect(classifyTool('custom_dangerous_thing').sensitive).toBe(false);
  });
});

describe('decideCapability', () => {
  function freshTaint(content: string, tool = 'read_file'): TaintStore {
    const t = new TaintStore();
    t.add({ toolName: tool, content, addedAt: Date.now() });
    return t;
  }

  it('returns allow when capability is disabled', () => {
    const taint = freshTaint('https://leak-target-xyz.example/exfil-endpoint-9k4j is bad');
    const args = { url: 'https://leak-target-xyz.example/exfil-endpoint-9k4j' };
    const d = decideCapability('http_get', args, taint, { ...DEFAULT_CFG, enabled: false });
    expect(d.action).toBe('allow');
  });

  it('returns allow for non-sensitive tools even with taint match', () => {
    const taint = freshTaint('https://leak-target-xyz.example/exfil-endpoint-9k4j is bad');
    const args = { url: 'https://leak-target-xyz.example/exfil-endpoint-9k4j' };
    const d = decideCapability('summarize', args, taint, DEFAULT_CFG);
    expect(d.action).toBe('allow');
  });

  it('returns allow for sensitive tools when args have no taint overlap', () => {
    const taint = freshTaint('here is a file that contains nothing interesting');
    const args = { url: 'https://unrelated.example/some/path' };
    const d = decideCapability('http_get', args, taint, DEFAULT_CFG);
    expect(d.action).toBe('allow');
  });

  it('blocks sensitive tool when args overlap a tainted source', () => {
    const taint = freshTaint('visit https://leak-target-xyz.example/exfil-endpoint-9k4j now');
    const args = { url: 'https://leak-target-xyz.example/exfil-endpoint-9k4j' };
    const d = decideCapability('http_get', args, taint, DEFAULT_CFG);
    expect(d.action).toBe('block');
    expect(d.taintSources).toHaveLength(1);
    expect(d.taintSources?.[0]?.toolName).toBe('read_file');
    expect(d.matchedPattern).toBeDefined();
  });

  it('warns instead of blocking when mode is warn', () => {
    const taint = freshTaint('visit https://leak-target-xyz.example/exfil-endpoint-9k4j now');
    const args = { url: 'https://leak-target-xyz.example/exfil-endpoint-9k4j' };
    const d = decideCapability('http_get', args, taint, { ...DEFAULT_CFG, mode: 'warn' });
    expect(d.action).toBe('warn');
  });

  it('does not flag short common substrings below threshold', () => {
    // Below the 32-char default threshold — must NOT be flagged.
    const taint = freshTaint('the project is hosted at https://api.example.com which is fine');
    const args = { url: 'https://api.example.com/v1/things' };
    const d = decideCapability('http_get', args, taint, DEFAULT_CFG);
    expect(d.action).toBe('allow');
  });

  it('handles missing arguments cleanly', () => {
    const taint = freshTaint('anything at all goes here for the lookup');
    const d1 = decideCapability('http_get', undefined, taint, DEFAULT_CFG);
    const d2 = decideCapability('http_get', null, taint, DEFAULT_CFG);
    const d3 = decideCapability('http_get', {}, taint, DEFAULT_CFG);
    expect(d1.action).toBe('allow');
    expect(d2.action).toBe('allow');
    expect(d3.action).toBe('allow');
  });

  it('flags args passed as a raw string', () => {
    const taint = freshTaint('visit https://leak-target-xyz.example/exfil-endpoint-9k4j now');
    const d = decideCapability(
      'http_get',
      'https://leak-target-xyz.example/exfil-endpoint-9k4j',
      taint,
      DEFAULT_CFG,
    );
    expect(d.action).toBe('block');
  });
});
