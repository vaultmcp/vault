/// Render scoreboard results as a Markdown table.

import type { CompetitorScore } from './runner.js';
import { ATTACKS, CLEAN } from './corpus.js';

export function renderMarkdown(scores: CompetitorScore[]): string {
  const ran = scores.filter((s) => s.ok);
  const skipped = scores.filter((s) => !s.ok);

  ran.sort((a, b) => b.f1 - a.f1 || b.tpr - a.tpr);

  const lines: string[] = [];
  lines.push('# Vault Red Team — scoreboard');
  lines.push('');
  lines.push(`Corpus: ${ATTACKS.length} attack samples + ${CLEAN.length} clean samples = ${ATTACKS.length + CLEAN.length} total.`);
  lines.push('');
  lines.push('Each competitor classifies every sample as flagged (likely injection) or clean.');
  lines.push('');
  lines.push('| Competitor | TPR | FPR | Precision | F1 | Accuracy | p50 latency | p99 latency | Errors |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const s of ran) {
    lines.push(
      `| **${s.name}** | ${pct(s.tpr)} | ${pct(s.fpr)} | ${pct(s.precision)} | ${pct(s.f1)} | ${pct(s.accuracy)} | ${ms(s.latencyP50)} | ${ms(s.latencyP99)} | ${s.errorCount} |`,
    );
  }
  lines.push('');
  if (skipped.length > 0) {
    lines.push('## Not run');
    lines.push('');
    for (const s of skipped) lines.push(`- **${s.name}** — ${s.reason ?? 'unavailable'}`);
    lines.push('');
  }
  lines.push('## Per-sample (top miss diffs)');
  lines.push('');
  // For each ran competitor, list the samples it got wrong relative to ground truth.
  for (const s of ran) {
    const misses = s.outcomes.filter(
      (o) => (o.label === 'attack' && !o.flagged) || (o.label === 'clean' && o.flagged),
    );
    if (misses.length === 0) {
      lines.push(`- **${s.name}**: no misses ✓`);
      continue;
    }
    lines.push(`- **${s.name}**: ${misses.length} miss${misses.length === 1 ? '' : 'es'}`);
    for (const m of misses.slice(0, 6)) {
      const kind = m.label === 'attack' ? 'false negative' : 'false positive';
      lines.push(`  - \`${m.sampleId}\` (${kind})${m.rawLabels?.length ? ` — labels: ${m.rawLabels.slice(0, 4).join(', ')}` : ''}`);
    }
    if (misses.length > 6) lines.push(`  - …and ${misses.length - 6} more`);
  }
  lines.push('');
  return lines.join('\n');
}

function pct(v: number): string {
  return (v * 100).toFixed(1) + '%';
}

function ms(v: number): string {
  if (v === 0) return 'n/a';
  if (v < 10) return v.toFixed(1) + 'ms';
  return Math.round(v) + 'ms';
}
