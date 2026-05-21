/// bench-encoded.ts — Task 1B: L0+L1+L2 FP rate on 70 benign-protocol-encoded fixtures.
///
/// Runs WITHOUT L3 (null client forced). Reports per-category FP rates.
///
/// Usage:
///   pnpm --filter @vaultmcp/eval tsx src/bench-encoded.ts

import { runPipeline, warmupLayer2 } from '../../proxy/src/detection/pipeline.js';
import {
  _setClientForTesting,
  _resetClientForTesting,
} from '../../proxy/src/detection/layer3-judge.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = path.resolve(
  __dirname,
  '../../proxy/test/fixtures/benign-encoded/fixtures.json',
);

interface Fixture {
  id: string;
  content: string;
  source: string;
  category: string;
  expected_verdict: string;
}

interface Result {
  id: string;
  category: string;
  verdict: string;
  layer: number | undefined;
  patterns: string[];
  l2Distance: number | null;
  bypassReason: string | undefined;
  flagged: boolean;
}

async function run() {
  // Disable L3 for this bench run
  _setClientForTesting(null);

  await warmupLayer2();

  const fixtures: Fixture[] = JSON.parse(readFileSync(FIXTURES_PATH, 'utf8'));

  console.log(`Running full pipeline (L3 disabled) on ${fixtures.length} benign-encoded fixtures\n`);

  const results: Result[] = [];

  for (const fx of fixtures) {
    const r = await runPipeline(fx.content);
    results.push({
      id: fx.id,
      category: fx.category,
      verdict: r.verdict,
      layer: r.layer,
      patterns: r.detectedPatterns,
      l2Distance: r.distance ?? null,
      bypassReason: r.bypassReason,
      flagged: r.verdict !== 'clean',
    });
  }

  _resetClientForTesting();

  // Report
  const flagged = results.filter((r) => r.flagged);
  const bypassed = results.filter((r) => r.bypassReason === 'base64_blob_only_high_l2_distance');
  const byCategory: Record<string, { total: number; flagged: number; bypassed: number; examples: Result[] }> = {};

  for (const r of results) {
    if (!byCategory[r.category])
      byCategory[r.category] = { total: 0, flagged: 0, bypassed: 0, examples: [] };
    byCategory[r.category].total++;
    if (r.bypassReason) byCategory[r.category].bypassed++;
    if (r.flagged) {
      byCategory[r.category].flagged++;
      byCategory[r.category].examples.push(r);
    }
  }

  console.log('=== OVERALL ===');
  console.log(`Total: ${fixtures.length}`);
  console.log(`Bypassed to clean: ${bypassed.length} / ${fixtures.length}`);
  console.log(`Flagged (FP): ${flagged.length} / ${fixtures.length} = ${((flagged.length / fixtures.length) * 100).toFixed(1)}%\n`);

  console.log('=== PER-CATEGORY ===');
  for (const [cat, stats] of Object.entries(byCategory)) {
    const rate = ((stats.flagged / stats.total) * 100).toFixed(1);
    console.log(`${cat}: ${stats.flagged}/${stats.total} = ${rate}% FP  (${stats.bypassed} bypassed to clean)`);
    for (const ex of stats.examples) {
      const dist = ex.l2Distance !== null ? ` L2dist=${ex.l2Distance.toFixed(3)}` : '';
      console.log(`  [${ex.id}] verdict=${ex.verdict} layer=L${ex.layer}${dist} patterns=[${ex.patterns.join(', ')}]`);
    }
  }

  console.log('\n=== RESIDUAL FPs — FULL CONTENT ===');
  for (const r of flagged) {
    const fx = fixtures.find((f) => f.id === r.id)!;
    const dist = r.l2Distance !== null ? ` L2dist=${r.l2Distance.toFixed(3)}` : '';
    console.log(`\n--- ${r.id} [${r.category}]${dist} verdict=${r.verdict} via L${r.layer} ---`);
    console.log(`Source: ${fx.source}`);
    console.log(`Content:\n${fx.content}`);
  }

  console.log('\n=== DECISION CRITERIA ===');
  const fpRate = (flagged.length / fixtures.length) * 100;
  if (fpRate < 2) {
    console.log(`FP rate ${fpRate.toFixed(1)}% < 2% — SHIP AS-IS. No additional fix needed.`);
  } else if (fpRate < 10) {
    console.log(`FP rate ${fpRate.toFixed(1)}% is 2-10% — IMPLEMENT ADDITIONAL FIX.`);
  } else {
    console.log(`FP rate ${fpRate.toFixed(1)}% > 10% — RESIDUAL FPs PRESENT. Document in LIMITATIONS.`);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
