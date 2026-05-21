import { loadCorpus, type LoadedCorpus } from '@vaultmcp/corpus';
import type { DetectionResult } from './types.js';

const MODEL_ID = 'Xenova/bge-small-en-v1.5';
// Threshold tuned for 200-entry corpus (Day 2 sprint).
// With 61 entries: empirical gap was attacks ≈0.21 vs benign ≈0.34+, so 0.35 worked.
// With 200 entries the corpus is 3× denser; attacks now land ≈0.15–0.20 while
// benign security-research text lands at 0.297–0.347 (measured on fp-probe fixtures).
// Lowering to 0.27 preserves attack detection while restoring clean verdicts for
// research abstracts, CVE advisories, and security-training content.
const DEFAULT_THRESHOLD = 0.27;

let extractorPromise: Promise<(text: string, opts: { pooling: 'mean'; normalize: boolean }) => Promise<{ data: Float32Array }>> | null = null;
let corpus: LoadedCorpus | null = null;

function readThreshold(): number {
  const raw = process.env.VAULT_LAYER2_THRESHOLD;
  if (!raw) return DEFAULT_THRESHOLD;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 2 ? n : DEFAULT_THRESHOLD;
}

async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const mod = await import('@xenova/transformers');
      // Pin to local cache; don't fetch on every invocation if already cached.
      mod.env.allowLocalModels = true;
      const extractor = await mod.pipeline('feature-extraction', MODEL_ID, { quantized: true });
      return extractor as unknown as (text: string, opts: { pooling: 'mean'; normalize: boolean }) => Promise<{ data: Float32Array }>;
    })();
  }
  return extractorPromise;
}

function getCorpus(): LoadedCorpus {
  if (!corpus) corpus = loadCorpus();
  return corpus;
}

function cosineDistanceNormalized(
  q: Float32Array,
  c: Float32Array,
  cOffset: number,
  dim: number,
): number {
  let dot = 0;
  for (let i = 0; i < dim; i++) {
    dot += q[i]! * c[cOffset + i]!;
  }
  return 1 - dot;
}

export async function runLayer2(text: string): Promise<DetectionResult> {
  if (!text || text.length === 0) {
    return { verdict: 'clean', confidence: 0, reasoning: 'empty text', detectedPatterns: [], layer: 2 };
  }

  const extractor = await getExtractor();
  const out = await extractor(text, { pooling: 'mean', normalize: true });
  const q = out.data;

  const { meta, embeddings } = getCorpus();
  const { dim, count, items } = meta;

  let best = Infinity;
  let bestIdx = -1;
  for (let i = 0; i < count; i++) {
    const d = cosineDistanceNormalized(q, embeddings, i * dim, dim);
    if (d < best) {
      best = d;
      bestIdx = i;
    }
  }

  const threshold = readThreshold();

  if (bestIdx < 0) {
    return { verdict: 'clean', confidence: 0, reasoning: 'empty corpus', detectedPatterns: [], layer: 2 };
  }

  const matched = items[bestIdx]!;
  if (best >= threshold) {
    return {
      verdict: 'clean',
      confidence: Math.max(0, 1 - best),
      reasoning: `layer-2 nearest ${matched.id} dist=${best.toFixed(3)} >= threshold ${threshold}`,
      detectedPatterns: [],
      distance: best,
      layer: 2,
    };
  }

  // FP-tuning rule (2026-05-19, measured): only call a match "malicious" outright when the
  // embedding distance is small enough that we can be confident. Borderline matches (e.g. tool
  // documentation that describes filesystem operations near-matching exfiltration corpus entries)
  // return "suspicious" so the pipeline can escalate to Layer 3 — which is the only thing that can
  // reliably tell "describing X" from "instructing the agent to do X". Threshold chosen from
  // distance-probe data: paraphrased real attacks land ~0.21, real FPs land ~0.34.
  const CONFIDENT_MATCH_DIST = 0.25;
  const verdict =
    matched.severity === 'high' && best < CONFIDENT_MATCH_DIST ? 'malicious' : 'suspicious';
  const confidence = Math.min(0.95, 1 - best / threshold);

  return {
    verdict,
    confidence,
    reasoning: `layer-2 matched corpus ${matched.id} (${matched.category}) dist=${best.toFixed(3)} < threshold ${threshold}`,
    detectedPatterns: [`corpus:${matched.id}:${matched.category}`],
    matchedId: matched.id,
    matchedCategory: matched.category,
    distance: best,
    layer: 2,
  };
}

export async function warmupLayer2(): Promise<void> {
  await getExtractor();
  getCorpus();
}
