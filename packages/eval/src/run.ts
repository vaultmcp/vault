/// Honest evaluation harness for Vault.
///
/// Runs the full detection pipeline against holdout attacks + benign content datasets and
/// reports TPR / FPR / latency / per-layer attribution. Does NOT tune Vault against the
/// results — the holdout's value depends on us never grading against it during training.
///
/// Usage:
///   pnpm --filter @vaultmcp/eval run -- --set holdout-attacks|benign|both
///   pnpm --filter @vaultmcp/eval run -- --set both --max 50         # subset for quick check
///   pnpm --filter @vaultmcp/eval run -- --set both --no-l3            # skip L3 to estimate cost first
///   pnpm --filter @vaultmcp/eval run -- --set both --dry-run-l3       # log what would call L3 without spending
///
/// Output:
///   packages/eval/results/eval-YYYY-MM-DD-HHMM.md
///   packages/eval/results/eval-YYYY-MM-DD-HHMM.json

// Relative imports into the proxy package's src. Both packages live in this monorepo;
// the proxy doesn't export library entries (it ships CLIs via bin{}), so reaching into
// its source is the cleanest path that doesn't require restructuring its package.json.
import { runLayer1 } from '../../proxy/src/detection/layer1-heuristics.js';
import { runLayer2 } from '../../proxy/src/detection/layer2-embeddings.js';
import { runLayer3 } from '../../proxy/src/detection/layer3-judge.js';
import { Layer3Unavailable } from '../../proxy/src/detection/clients/types.js';
import type { DetectionResult } from '../../proxy/src/detection/types.js';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

interface DatasetEntry {
  id: string;
  text: string;
  category?: string;
  severity?: string;
  source: string;
  expected_verdict: 'malicious' | 'suspicious' | 'clean';
}

interface RunResult {
  id: string;
  category?: string;
  severity?: string;
  expected: string;
  actual: string;
  layer: number | null;
  confidence: number;
  reasoning: string;
  patterns: string[];
  l1_ms: number;
  l2_ms: number;
  l3_ms: number;
  l3_called: boolean;
  l3_unavailable: boolean;
  text_preview: string;
  full_text: string; // kept for the "worst N" sections
  correct: boolean;
}

interface RunOptions {
  set: 'holdout-attacks' | 'benign' | 'both';
  max?: number;
  noL3: boolean;
  dryRunL3: boolean;
}

// ---------- CLI parse ----------

function parseArgs(argv: string[]): RunOptions {
  const o: RunOptions = { set: 'both', noL3: false, dryRunL3: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--set') {
      const v = argv[++i];
      if (v === 'holdout-attacks' || v === 'benign' || v === 'both') o.set = v;
      else throw new Error(`bad --set: ${v}`);
    } else if (a === '--max') {
      o.max = parseInt(argv[++i] ?? '', 10);
      if (!Number.isFinite(o.max!)) throw new Error('bad --max');
    } else if (a === '--no-l3') {
      o.noL3 = true;
    } else if (a === '--dry-run-l3') {
      o.dryRunL3 = true;
    } else if (a === '--help' || a === '-h') {
      process.stdout.write(`Usage: pnpm --filter @vaultmcp/eval run -- [flags]\n` +
        `  --set holdout-attacks|benign|both   default: both\n` +
        `  --max N                              cap entries per set (debugging)\n` +
        `  --no-l3                              skip L3 entirely (free run)\n` +
        `  --dry-run-l3                         log L3 calls without making them\n`);
      process.exit(0);
    } else {
      throw new Error(`unknown arg: ${a}`);
    }
  }
  return o;
}

// ---------- Dataset load ----------

function loadDataset(name: 'holdout-attacks' | 'benign'): DatasetEntry[] {
  const dir = path.join(ROOT, 'datasets', name);
  if (!existsSync(dir)) {
    throw new Error(`dataset directory missing: ${dir}`);
  }
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const all: DatasetEntry[] = [];
  const seenIds = new Set<string>();
  for (const f of files) {
    const raw = readFileSync(path.join(dir, f), 'utf8');
    let arr: DatasetEntry[];
    try {
      arr = JSON.parse(raw);
    } catch (e) {
      throw new Error(`dataset file ${f} is not valid JSON: ${e}`);
    }
    if (!Array.isArray(arr)) throw new Error(`${f} is not a JSON array`);
    for (const e of arr) {
      if (!e.id) throw new Error(`entry in ${f} missing id`);
      if (seenIds.has(e.id)) throw new Error(`duplicate id across files: ${e.id}`);
      seenIds.add(e.id);
      all.push(e);
    }
  }
  return all;
}

// ---------- Run pipeline manually with per-layer timing ----------

const L1_MALICIOUS_SHORT_CIRCUIT = 0.85;
const L2_DEFAULT_THRESHOLD = 0.35;
const L2_UNCERTAIN_MARGIN = 0.15;

async function runOne(entry: DatasetEntry, opts: RunOptions): Promise<RunResult> {
  let l1_ms = 0, l2_ms = 0, l3_ms = 0;
  let l3_called = false;
  let l3_unavailable = false;
  let actual: DetectionResult & { layer?: number };

  // L1
  const l1Start = performance.now();
  const l1 = runLayer1(entry.text);
  l1_ms = performance.now() - l1Start;

  if (l1.verdict === 'malicious' && l1.confidence >= L1_MALICIOUS_SHORT_CIRCUIT) {
    actual = { ...l1, layer: 1 };
  } else {
    // L2
    const l2Start = performance.now();
    let l2: DetectionResult;
    try {
      l2 = await runLayer2(entry.text);
    } catch (err) {
      actual = { ...l1, layer: 1, reasoning: `${l1.reasoning} (L2 failed)` };
      l2_ms = performance.now() - l2Start;
      return packageResult(entry, actual, { l1_ms, l2_ms, l3_ms, l3_called, l3_unavailable });
    }
    l2_ms = performance.now() - l2Start;

    if (l2.verdict === 'malicious') {
      actual = { ...l2, layer: 2 };
    } else {
      // L3 decision
      const distance = l2.distance ?? Infinity;
      const isSuspicious = l2.verdict === 'suspicious';
      const inUncertainZone = distance < L2_DEFAULT_THRESHOLD + L2_UNCERTAIN_MARGIN;

      const shouldCallL3 = isSuspicious || inUncertainZone;
      if (shouldCallL3 && !opts.noL3) {
        if (opts.dryRunL3) {
          l3_called = true; // log but don't actually call
          // fall through with L2 result, but mark
          if (isSuspicious) {
            actual = { ...l2, verdict: 'clean', reasoning: `${l2.reasoning} — would-call-L3 (dry-run, demoted to clean)` };
          } else if (l1.verdict !== 'clean') {
            actual = { ...l1, layer: 1 };
          } else {
            actual = { ...l2, layer: 2 };
          }
        } else {
          const l3Start = performance.now();
          try {
            actual = { ...(await runLayer3(entry.text)), layer: 3 };
            l3_called = true;
          } catch (err) {
            if (err instanceof Layer3Unavailable) {
              l3_unavailable = true;
            } else {
              process.stderr.write(`L3 error on ${entry.id}: ${err}\n`);
            }
            // FP-safe fallback (mirrors runPipeline)
            if (isSuspicious) {
              actual = { ...l2, verdict: 'clean', reasoning: `${l2.reasoning} — L3 unavailable, demoted to clean` };
            } else if (l1.verdict !== 'clean') {
              actual = { ...l1, layer: 1 };
            } else {
              actual = { ...l2, layer: 2 };
            }
          }
          l3_ms = performance.now() - l3Start;
        }
      } else {
        // Clearly clean OR L3 disabled
        if (l1.verdict !== 'clean') actual = { ...l1, layer: 1 };
        else actual = { ...l2, layer: 2 };
      }
    }
  }

  return packageResult(entry, actual, { l1_ms, l2_ms, l3_ms, l3_called, l3_unavailable });
}

function packageResult(
  entry: DatasetEntry,
  actual: DetectionResult & { layer?: number },
  timing: { l1_ms: number; l2_ms: number; l3_ms: number; l3_called: boolean; l3_unavailable: boolean },
): RunResult {
  const correct = isCorrect(entry.expected_verdict, actual.verdict);
  return {
    id: entry.id,
    category: entry.category,
    severity: entry.severity,
    expected: entry.expected_verdict,
    actual: actual.verdict,
    layer: actual.layer ?? null,
    confidence: actual.confidence,
    reasoning: actual.reasoning,
    patterns: actual.detectedPatterns ?? [],
    text_preview: entry.text.slice(0, 140),
    full_text: entry.text,
    correct,
    ...timing,
  };
}

function isCorrect(expected: string, actual: string): boolean {
  if (expected === 'clean') return actual === 'clean';
  // Either malicious or suspicious counts as a catch when expected is malicious/suspicious.
  // Operators have the verdict; the precision of malicious-vs-suspicious is reported separately.
  return actual !== 'clean';
}

// ---------- Aggregate + report ----------

interface Aggregate {
  setName: string;
  total: number;
  correct: number;
  rate: number; // TPR or 1-FPR
  byCategory: Record<string, { total: number; correct: number }>;
  byLayer: Record<string, { catches: number; misses: number }>;
  latency_p50: { l1: number; l2: number; l3: number };
  latency_p95: { l1: number; l2: number; l3: number };
  latency_p99: { l1: number; l2: number; l3: number };
  l3_calls: number;
  l3_unavailable: number;
  worstFNs: RunResult[]; // for attacks set: worst missed (false negatives)
  worstFPs: RunResult[]; // for benign set: worst over-flagged (false positives)
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

function aggregate(results: RunResult[], setName: string): Aggregate {
  const total = results.length;
  const correct = results.filter((r) => r.correct).length;
  const rate = total === 0 ? 0 : correct / total;

  const byCategory: Record<string, { total: number; correct: number }> = {};
  for (const r of results) {
    const c = r.category ?? 'uncategorized';
    if (!byCategory[c]) byCategory[c] = { total: 0, correct: 0 };
    byCategory[c]!.total++;
    if (r.correct) byCategory[c]!.correct++;
  }

  const byLayer: Record<string, { catches: number; misses: number }> = {
    '1': { catches: 0, misses: 0 },
    '2': { catches: 0, misses: 0 },
    '3': { catches: 0, misses: 0 },
    'none': { catches: 0, misses: 0 },
  };
  for (const r of results) {
    const key = String(r.layer ?? 'none');
    if (!byLayer[key]) byLayer[key] = { catches: 0, misses: 0 };
    if (r.correct) byLayer[key]!.catches++;
    else byLayer[key]!.misses++;
  }

  const l1s = results.map((r) => r.l1_ms);
  const l2s = results.filter((r) => r.l2_ms > 0).map((r) => r.l2_ms);
  const l3s = results.filter((r) => r.l3_ms > 0).map((r) => r.l3_ms);

  // Worst FNs for attacks: expected != 'clean' but actual == 'clean'
  // Worst FPs for benign:   expected == 'clean' but actual != 'clean'
  const wrong = results.filter((r) => !r.correct);
  const isAttackSet = setName === 'holdout-attacks';
  const sevRank = (s?: string) => ({ critical: 4, high: 3, medium: 2, low: 1 })[s ?? 'medium'] ?? 2;
  const sortedWrong = [...wrong].sort((a, b) => sevRank(b.severity) - sevRank(a.severity));

  return {
    setName,
    total,
    correct,
    rate,
    byCategory,
    byLayer,
    latency_p50: { l1: percentile(l1s, 50), l2: percentile(l2s, 50), l3: percentile(l3s, 50) },
    latency_p95: { l1: percentile(l1s, 95), l2: percentile(l2s, 95), l3: percentile(l3s, 95) },
    latency_p99: { l1: percentile(l1s, 99), l2: percentile(l2s, 99), l3: percentile(l3s, 99) },
    l3_calls: results.filter((r) => r.l3_called).length,
    l3_unavailable: results.filter((r) => r.l3_unavailable).length,
    worstFNs: isAttackSet ? sortedWrong.slice(0, 20) : [],
    worstFPs: !isAttackSet ? sortedWrong.slice(0, 20) : [],
  };
}

// ---------- Report rendering ----------

function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function renderMarkdown(opts: RunOptions, attackAgg: Aggregate | null, benignAgg: Aggregate | null): string {
  const lines: string[] = [];
  lines.push(`# Vault Eval — ${nowStamp()}\n`);
  lines.push(`Command: \`pnpm --filter @vaultmcp/eval run -- --set ${opts.set}${opts.noL3 ? ' --no-l3' : ''}${opts.dryRunL3 ? ' --dry-run-l3' : ''}${opts.max ? ` --max ${opts.max}` : ''}\`\n`);
  lines.push(`Pipeline: L1 heuristics → L2 bge-small embeddings → L3 ${opts.noL3 ? 'DISABLED' : opts.dryRunL3 ? 'DRY-RUN (no API calls)' : 'Anthropic Haiku judge'}\n`);
  lines.push(`L3 status: ${process.env.ANTHROPIC_API_KEY ? 'API key set' : 'NO API KEY — L3 effectively disabled, results reflect L1+L2 only'}\n`);
  lines.push('');

  // Headline numbers
  if (attackAgg && benignAgg) {
    lines.push(`## Headline\n`);
    lines.push(`| metric | value | denominator |`);
    lines.push(`|---|---|---|`);
    lines.push(`| True positive rate (attacks caught) | **${(attackAgg.rate * 100).toFixed(1)}%** | ${attackAgg.correct} / ${attackAgg.total} |`);
    lines.push(`| False positive rate (benign flagged) | **${((1 - benignAgg.rate) * 100).toFixed(1)}%** | ${benignAgg.total - benignAgg.correct} / ${benignAgg.total} |`);
    lines.push('');
  } else if (attackAgg) {
    lines.push(`## Headline\n`);
    lines.push(`- True positive rate: **${(attackAgg.rate * 100).toFixed(1)}%** (${attackAgg.correct} / ${attackAgg.total})\n`);
  } else if (benignAgg) {
    lines.push(`## Headline\n`);
    lines.push(`- False positive rate: **${((1 - benignAgg.rate) * 100).toFixed(1)}%** (${benignAgg.total - benignAgg.correct} / ${benignAgg.total})\n`);
  }

  for (const agg of [attackAgg, benignAgg]) {
    if (!agg) continue;
    lines.push(`## Set: ${agg.setName}\n`);
    lines.push(`Total entries: ${agg.total}  |  Correct: ${agg.correct}  |  Rate: ${(agg.rate * 100).toFixed(1)}%\n`);

    lines.push(`### Per-category breakdown\n`);
    lines.push(`| category | correct/total | rate |`);
    lines.push(`|---|---|---|`);
    for (const [cat, v] of Object.entries(agg.byCategory)) {
      lines.push(`| ${cat} | ${v.correct} / ${v.total} | ${((v.correct / Math.max(1, v.total)) * 100).toFixed(1)}% |`);
    }
    lines.push('');

    lines.push(`### Per-layer attribution\n`);
    lines.push(`| layer | catches | misses |`);
    lines.push(`|---|---|---|`);
    for (const [layer, v] of Object.entries(agg.byLayer)) {
      lines.push(`| L${layer} | ${v.catches} | ${v.misses} |`);
    }
    lines.push('');

    lines.push(`### Latency (ms)\n`);
    lines.push(`| layer | p50 | p95 | p99 |`);
    lines.push(`|---|---|---|---|`);
    lines.push(`| L1 | ${agg.latency_p50.l1.toFixed(2)} | ${agg.latency_p95.l1.toFixed(2)} | ${agg.latency_p99.l1.toFixed(2)} |`);
    lines.push(`| L2 | ${agg.latency_p50.l2.toFixed(2)} | ${agg.latency_p95.l2.toFixed(2)} | ${agg.latency_p99.l2.toFixed(2)} |`);
    lines.push(`| L3 | ${agg.latency_p50.l3.toFixed(2)} | ${agg.latency_p95.l3.toFixed(2)} | ${agg.latency_p99.l3.toFixed(2)} |`);
    lines.push('');

    lines.push(`### L3 calls\n`);
    lines.push(`- attempted: ${agg.l3_calls}`);
    lines.push(`- unavailable (no API key or error): ${agg.l3_unavailable}`);
    lines.push('');

    if (agg.worstFNs.length > 0) {
      lines.push(`### Worst false negatives (attacks missed), severity-sorted\n`);
      for (const r of agg.worstFNs) {
        lines.push(`- **${r.id}** [${r.category}/${r.severity}] → ${r.actual} via L${r.layer}`);
        lines.push(`  - text: \`${r.text_preview.replace(/`/g, "'")}\``);
        lines.push(`  - reasoning: ${r.reasoning}`);
        lines.push('');
      }
    }
    if (agg.worstFPs.length > 0) {
      lines.push(`### Worst false positives (benign over-flagged)\n`);
      for (const r of agg.worstFPs) {
        lines.push(`- **${r.id}** [${r.category ?? 'uncat'}] → flagged ${r.actual} via L${r.layer}`);
        lines.push(`  - text: \`${r.text_preview.replace(/`/g, "'")}\``);
        lines.push(`  - patterns: [${r.patterns.join(', ')}]`);
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

// ---------- Main ----------

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const stamp = nowStamp();

  const resultsDir = path.join(ROOT, 'results');
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });

  const sets: Array<'holdout-attacks' | 'benign'> =
    opts.set === 'both' ? ['holdout-attacks', 'benign'] : [opts.set];

  const aggs: Record<string, Aggregate | null> = { 'holdout-attacks': null, benign: null };
  const rawResults: Record<string, RunResult[]> = {};

  for (const setName of sets) {
    process.stderr.write(`\nLoading ${setName}...\n`);
    let entries = loadDataset(setName);
    if (opts.max) entries = entries.slice(0, opts.max);
    process.stderr.write(`  ${entries.length} entries\n`);

    const results: RunResult[] = [];
    let i = 0;
    for (const e of entries) {
      const r = await runOne(e, opts);
      results.push(r);
      i++;
      if (i % 25 === 0 || i === entries.length) {
        process.stderr.write(`  [${setName}] ${i}/${entries.length}  (running rate: ${((results.filter(x=>x.correct).length / results.length) * 100).toFixed(1)}%)\n`);
      }
    }
    rawResults[setName] = results;
    aggs[setName] = aggregate(results, setName);
  }

  const md = renderMarkdown(opts, aggs['holdout-attacks'] ?? null, aggs.benign ?? null);
  const mdPath = path.join(resultsDir, `eval-${stamp}.md`);
  const jsonPath = path.join(resultsDir, `eval-${stamp}.json`);
  writeFileSync(mdPath, md);
  writeFileSync(jsonPath, JSON.stringify({ opts, stamp, aggregates: aggs, raw: rawResults }, null, 2));

  process.stderr.write(`\nWrote:\n  ${mdPath}\n  ${jsonPath}\n`);
  process.stdout.write(md);
}

main().catch((e) => {
  process.stderr.write(`eval failed: ${e}\n${e?.stack}\n`);
  process.exit(1);
});
