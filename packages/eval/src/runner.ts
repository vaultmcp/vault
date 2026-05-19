/// Eval runner: cross-products each (competitor, sample), records flagged/not-flagged + latency,
/// computes TPR / FPR / accuracy / F1 / latency percentiles. Returns a structured result that
/// scoreboard.ts can render to Markdown.

import { SAMPLES, type Sample } from './corpus.js';
import type { Competitor, ClassifyResult } from './competitors/types.js';

export interface SampleOutcome {
  sampleId: string;
  label: 'attack' | 'clean';
  flagged: boolean;
  latencyMs: number;
  rawLabels?: string[];
  error?: string;
}

export interface CompetitorScore {
  name: string;
  ok: boolean;
  reason?: string;
  outcomes: SampleOutcome[];
  truePositive: number;
  trueNegative: number;
  falsePositive: number;
  falseNegative: number;
  tpr: number; // recall on attacks
  fpr: number; // false-positive rate on clean
  precision: number;
  f1: number;
  accuracy: number;
  latencyP50: number;
  latencyP99: number;
  errorCount: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * p) - 1));
  return sorted[idx]!;
}

export async function scoreCompetitor(
  competitor: Competitor,
  samples: Sample[] = SAMPLES,
): Promise<CompetitorScore> {
  const ready = await competitor.ready();
  if (!ready.ok) {
    return {
      name: competitor.name,
      ok: false,
      reason: ready.reason,
      outcomes: [],
      truePositive: 0,
      trueNegative: 0,
      falsePositive: 0,
      falseNegative: 0,
      tpr: 0,
      fpr: 0,
      precision: 0,
      f1: 0,
      accuracy: 0,
      latencyP50: 0,
      latencyP99: 0,
      errorCount: 0,
    };
  }

  const outcomes: SampleOutcome[] = [];
  for (const s of samples) {
    try {
      const r: ClassifyResult = await competitor.classify(s.text);
      outcomes.push({
        sampleId: s.id,
        label: s.label,
        flagged: r.flagged,
        latencyMs: r.latencyMs,
        rawLabels: r.rawLabels,
      });
    } catch (err) {
      outcomes.push({
        sampleId: s.id,
        label: s.label,
        flagged: false,
        latencyMs: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  let tp = 0;
  let tn = 0;
  let fp = 0;
  let fn = 0;
  let errors = 0;
  const lat: number[] = [];
  for (const o of outcomes) {
    if (o.error) errors++;
    else lat.push(o.latencyMs);
    if (o.label === 'attack' && o.flagged) tp++;
    else if (o.label === 'attack' && !o.flagged) fn++;
    else if (o.label === 'clean' && !o.flagged) tn++;
    else if (o.label === 'clean' && o.flagged) fp++;
  }
  lat.sort((a, b) => a - b);

  const tpr = tp + fn === 0 ? 0 : tp / (tp + fn);
  const fpr = fp + tn === 0 ? 0 : fp / (fp + tn);
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const f1 = precision + tpr === 0 ? 0 : (2 * precision * tpr) / (precision + tpr);
  const accuracy = (tp + tn) / outcomes.length;

  return {
    name: competitor.name,
    ok: true,
    outcomes,
    truePositive: tp,
    trueNegative: tn,
    falsePositive: fp,
    falseNegative: fn,
    tpr,
    fpr,
    precision,
    f1,
    accuracy,
    latencyP50: percentile(lat, 0.5),
    latencyP99: percentile(lat, 0.99),
    errorCount: errors,
  };
}
