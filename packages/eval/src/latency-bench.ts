/// Latency benchmark — the single source of truth for Vault's per-layer latency.
///
/// Runs the REAL detection layers (imported from the proxy source) over a representative
/// mix of public-corpus attacks and benign tool responses, and reports p50/p95/p99 per
/// layer. Writes one markdown file that every latency figure in the README should cite.
///
/// L1 and L2 run fully offline and are measured here. L3 is a network round-trip to the
/// configured judge (Anthropic Haiku / OpenAI / Ollama); it is measured only when a key is
/// present, and is dominated by provider latency, not Vault code.
///
///   cd packages/eval && npx tsx src/latency-bench.ts
///   ANTHROPIC_API_KEY=... cd packages/eval && npx tsx src/latency-bench.ts   # also measures L3

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { runLayer1 } from '../../proxy/src/detection/layer1-heuristics.js';
import { runLayer2, warmupLayer2 } from '../../proxy/src/detection/layer2-embeddings.js';
import { runLayer3 } from '../../proxy/src/detection/layer3-judge.js';
import { Layer3Unavailable } from '../../proxy/src/detection/clients/types.js';
import { createClientFromEnv } from '../../proxy/src/detection/clients/factory.js';

const require = createRequire(import.meta.url);

interface CorpusEntry { id: string; text: string; category: string }

// Benign tool responses of realistic shapes/sizes — NOT drawn from any eval dataset.
const BENIGN: string[] = [
  'The current temperature in San Francisco is 64°F, partly cloudy, humidity 72%, wind 12 mph SW.',
  'Files: README.md (2.1kb), package.json (840b), src/index.ts (5.3kb), tsconfig.json (410b).',
  'HTTP 200 OK. Content-Type: application/json. Cache-Control: max-age=60. 1834 bytes returned.',
  'Commit a1b2c3d: "fix(api): handle empty pagination cursor" by dev@example.com, 3 files, +42 -17.',
  'Order #48213: 2x Widget ($19.99), 1x Gadget ($34.50). Subtotal $74.48, tax $6.33, total $80.81.',
  'Query returned 3 rows: {id:1,name:"alpha"}, {id:2,name:"beta"}, {id:3,name:"gamma"}. 12ms.',
  'Latest release v2.4.1 published 2 days ago. 4 assets, 1,204 downloads. Changelog: perf + bugfixes.',
  'Calendar: 10:00 standup (30m), 14:00 design review (1h), 16:30 1:1 with manager (30m).',
];

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

function loadCorpus(): CorpusEntry[] {
  const p = require.resolve('@vaultmcp/corpus/patterns');
  return JSON.parse(readFileSync(p, 'utf8')) as CorpusEntry[];
}

async function main() {
  const hasL3Client = createClientFromEnv();
  const inputs = [...loadCorpus().map((e) => e.text), ...BENIGN];
  process.stderr.write(`latency-bench: ${inputs.length} inputs, warming up L2...\n`);
  await warmupLayer2();

  // Warm pass (discarded) then measured passes for stable percentiles.
  const PASSES = 8;
  const l1: number[] = [];
  const l2: number[] = [];
  const l3: number[] = [];
  let l3Measured = 0;

  for (const text of inputs) { runLayer1(text); await runLayer2(text); } // warm

  for (let pass = 0; pass < PASSES; pass++) {
    for (const text of inputs) {
      const t1 = performance.now();
      runLayer1(text);
      l1.push(performance.now() - t1);

      const t2 = performance.now();
      const r2 = await runLayer2(text);
      l2.push(performance.now() - t2);

      // Only exercise L3 once per input (pass 0) and only if a client is configured.
      if (pass === 0 && hasL3Client && r2.verdict !== 'clean') {
        try {
          const t3 = performance.now();
          await runLayer3(text, { toolName: 'read_file', mcpMethod: 'tools/call' });
          l3.push(performance.now() - t3);
          l3Measured++;
        } catch (e) {
          if (!(e instanceof Layer3Unavailable)) throw e;
        }
      }
    }
  }

  const commit = (() => {
    try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'unknown'; }
  })();
  const date = new Date().toISOString().slice(0, 10);
  const node = process.version;
  const platform = `${process.platform}/${process.arch}`;

  const row = (name: string, a: number[]) =>
    a.length
      ? `| ${name} | ${percentile(a, 50).toFixed(2)} ms | ${percentile(a, 95).toFixed(2)} ms | ${percentile(a, 99).toFixed(2)} ms | ${a.length} |`
      : `| ${name} | — | — | — | 0 (not measured) |`;

  const l3Note = hasL3Client
    ? `L3 measured over ${l3Measured} escalated inputs (provider round-trip; dominated by the judge API, not Vault).`
    : `L3 not measured this run — requires an LLM key. L3 is a single provider round-trip (Anthropic Haiku 4.5 / OpenAI / Ollama); observed ~1.5–2 s in prior runs, network-bound.`;

  const md = `# Vault latency baseline — ${date}

**Commit:** \`${commit}\`  ·  **Node:** ${node}  ·  **Platform:** ${platform}
**Inputs:** ${inputs.length} (public corpus attacks + ${BENIGN.length} benign tool responses), ${PASSES} measured passes each.
**Method:** real detection layers timed with \`performance.now()\` after a discarded warm pass. Reproduce with \`cd packages/eval && npx tsx src/latency-bench.ts\`.

| layer | p50 | p95 | p99 | samples |
|---|---|---|---|---|
${row('L1 heuristics', l1)}
${row('L2 embeddings', l2)}
${row('L3 judge', l3)}

${l3Note}

L1 and L2 run on-device with no network call. L2 loads a ~30 MB WASM embedder
(\`bge-small-en-v1.5\`); the first scan in a process pays a one-time warm-up excluded above.
Every latency figure in the README should trace to this file.
`;

  const outPath = new URL(`../results/latency-baseline-${date}.md`, import.meta.url);
  writeFileSync(outPath, md);
  process.stderr.write(md + `\nwrote ${outPath.pathname}\n`);
}

main().catch((e) => {
  process.stderr.write(`latency-bench failed: ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
