import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock the pipeline so tests don't load the WASM embedder or hit any API.
vi.mock('../src/detection/pipeline.js', () => ({
  warmupLayer2: vi.fn().mockResolvedValue(undefined),
  runPipeline: vi.fn().mockImplementation(async (text: string) => {
    // Benign: return clean (high L2 distance)
    if (text.includes('San Francisco') && text.includes('temperature')) {
      return {
        verdict: 'clean',
        confidence: 0.99,
        reasoning: 'no injection detected',
        detectedPatterns: [],
        layer: 2,
        distance: 0.712,
        l3Status: 'skipped_gate',
      };
    }
    // Default: malicious at L1
    return {
      verdict: 'malicious',
      confidence: 0.97,
      reasoning: 'instruction override detected',
      detectedPatterns: ['instruction_override_keyword'],
      layer: 1,
      l3Status: 'skipped_gate',
    };
  }),
}));

// Mock factory so no env vars are needed
vi.mock('../src/detection/clients/factory.js', () => ({
  createClientFromEnv: vi.fn().mockReturnValue(null),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeBuffer(): { write(s: string): void; content: string } {
  const buf = { content: '', write(s: string) { this.content += s; } };
  return buf;
}

const NON_CORPUS_IDS = new Set(['demo-benign-01', 'demo-l0-showcase']);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('vault demo — corpus loading', () => {
  it('loadDemoScenarios returns exactly 8 entries', async () => {
    const { loadDemoScenarios } = await import('../src/cli/demo.js');
    const scenarios = loadDemoScenarios();
    expect(scenarios).toHaveLength(8);
  });

  it('first entry is the hardcoded benign scenario with corpus_id demo-benign-01', async () => {
    const { loadDemoScenarios } = await import('../src/cli/demo.js');
    const scenarios = loadDemoScenarios();
    expect(scenarios[0]!.corpus_id).toBe('demo-benign-01');
    expect(scenarios[0]!.category).toBe('benign');
  });

  it('includes the novel L0 showcase scenario (demo-l0-showcase) with padded base64', async () => {
    const { loadDemoScenarios } = await import('../src/cli/demo.js');
    const scenarios = loadDemoScenarios();
    const l0 = scenarios.find((s) => s.corpus_id === 'demo-l0-showcase');
    expect(l0).toBeDefined();
    // Padded base64 ending in '==' is required for L0's regex to fire
    expect(l0!.text).toMatch(/[A-Za-z0-9+/]{20,}={1,2}/);
  });

  it('attack entry texts are loaded from corpus JSON, not hardcoded', async () => {
    const { loadDemoScenarios } = await import('../src/cli/demo.js');
    const scenarios = loadDemoScenarios();

    const _require = createRequire(import.meta.url);
    const patternsPath = _require.resolve('@vaultmcp/corpus/patterns');
    const allPatterns = JSON.parse(readFileSync(patternsPath, 'utf8')) as Array<{
      id: string;
      text: string;
    }>;
    const byId = new Map(allPatterns.map((e) => [e.id, e]));

    for (const scenario of scenarios) {
      if (NON_CORPUS_IDS.has(scenario.corpus_id)) continue;
      const corpusEntry = byId.get(scenario.corpus_id);
      expect(corpusEntry, `corpus entry ${scenario.corpus_id} not found`).toBeDefined();
      expect(scenario.text).toBe(corpusEntry!.text);
    }
  });

  it('all 6 attack corpus IDs exist in the corpus and follow id pattern', async () => {
    const { loadDemoScenarios } = await import('../src/cli/demo.js');
    const scenarios = loadDemoScenarios();
    const corpusScenarios = scenarios.filter((s) => !NON_CORPUS_IDS.has(s.corpus_id));
    expect(corpusScenarios).toHaveLength(6);
    for (const s of corpusScenarios) {
      expect(s.corpus_id).toMatch(/^[a-z]{2}-\d{3}$/);
    }
  });

  it('covers 4 distinct attack categories', async () => {
    const { loadDemoScenarios } = await import('../src/cli/demo.js');
    const scenarios = loadDemoScenarios();
    const cats = new Set(scenarios.filter((s) => s.category !== 'benign').map((s) => s.category));
    expect(cats.size).toBeGreaterThanOrEqual(4);
  });
});

describe('vault demo — runDemo offline (no API key, no Ollama)', () => {
  afterEach(() => vi.clearAllMocks());

  it('runs to completion without throwing', async () => {
    const { runDemo } = await import('../src/cli/demo.js');
    const buf = makeBuffer();
    await expect(runDemo({ out: buf, pauseMs: 0, noColor: true })).resolves.toBeUndefined();
  });

  it('outputs a banner with version, layers, and backend=none', async () => {
    const { runDemo } = await import('../src/cli/demo.js');
    const buf = makeBuffer();
    await runDemo({ out: buf, pauseMs: 0, noColor: true });
    expect(buf.content).toContain('vault demo');
    expect(buf.content).toContain('layers');
    expect(buf.content).toContain('backend');
  });

  it('outputs degraded mode warning when no L3 backend', async () => {
    const { runDemo } = await import('../src/cli/demo.js');
    const buf = makeBuffer();
    await runDemo({ out: buf, pauseMs: 0, noColor: true });
    expect(buf.content).toContain('degraded mode');
    expect(buf.content).toContain('ANTHROPIC_API_KEY');
  });

  it('outputs CLEAN verdict for the benign scan', async () => {
    const { runDemo } = await import('../src/cli/demo.js');
    const buf = makeBuffer();
    await runDemo({ out: buf, pauseMs: 0, noColor: true });
    expect(buf.content).toContain('CLEAN');
  });

  it('outputs MALICIOUS verdict for attack scans', async () => {
    const { runDemo } = await import('../src/cli/demo.js');
    const buf = makeBuffer();
    await runDemo({ out: buf, pauseMs: 0, noColor: true });
    expect(buf.content).toContain('MALICIOUS');
  });

  it('does NOT say "L2 MATCHED" for the clean benign scan (Adjustment 1 fix)', async () => {
    const { runDemo } = await import('../src/cli/demo.js');
    const buf = makeBuffer();
    await runDemo({ out: buf, pauseMs: 0, noColor: true });
    // The benign scan must say "L2 — passed", never "L2 MATCHED" for a clean verdict
    const benignSection = buf.content.split('demo-benign-01')[1]!.split('io-001')[0]!;
    expect(benignSection).toContain('L2 — passed');
    expect(benignSection).not.toContain('L2 MATCHED');
  });

  it('outputs a summary line with scan counts and 8 scans', async () => {
    const { runDemo } = await import('../src/cli/demo.js');
    const buf = makeBuffer();
    await runDemo({ out: buf, pauseMs: 0, noColor: true });
    expect(buf.content).toContain('malicious');
    expect(buf.content).toContain('clean');
    expect(buf.content).toContain('8 scans');
  });

  it('outputs install guidance and vaultmcp.io', async () => {
    const { runDemo } = await import('../src/cli/demo.js');
    const buf = makeBuffer();
    await runDemo({ out: buf, pauseMs: 0, noColor: true });
    expect(buf.content).toContain('npx @aimcpvault/mcp-proxy --');
    expect(buf.content).toContain('vaultmcp.io');
  });

  it('outputs corpus_id for each scan so users can verify provenance', async () => {
    const { runDemo, loadDemoScenarios } = await import('../src/cli/demo.js');
    const buf = makeBuffer();
    await runDemo({ out: buf, pauseMs: 0, noColor: true });
    const scenarios = loadDemoScenarios();
    for (const s of scenarios) {
      expect(buf.content).toContain(s.corpus_id);
    }
  });

  it('includes Ollama/API-key nudge in the end-of-demo summary when offline', async () => {
    const { runDemo } = await import('../src/cli/demo.js');
    const buf = makeBuffer();
    await runDemo({ out: buf, pauseMs: 0, noColor: true });
    const summary = buf.content.slice(buf.content.lastIndexOf('Summary'));
    expect(summary).toMatch(/ANTHROPIC_API_KEY|OLLAMA_HOST/);
  });
});

describe('vault demo — runDemo with L3 enabled', () => {
  afterEach(() => vi.clearAllMocks());

  it('does not output degraded mode warning when L3 client is present', async () => {
    const factory = await import('../src/detection/clients/factory.js');
    vi.mocked(factory.createClientFromEnv).mockReturnValueOnce({
      providerName: 'anthropic',
      modelName: 'claude-haiku-4-5-20251001',
      async judge() {
        return { verdict: 'malicious', confidence: 0.95, reasoning: 'test', detected_patterns: [] };
      },
    });

    const { runDemo } = await import('../src/cli/demo.js');
    const buf = makeBuffer();
    await runDemo({ out: buf, pauseMs: 0, noColor: true });
    expect(buf.content).not.toContain('degraded mode');
    expect(buf.content).toContain('anthropic');
  });
});
