import { runLayer1 } from './layer1-heuristics.js';
import { runLayer0, makeLayer0Result } from './layer0-decoder.js';
import { runLayer2 } from './layer2-embeddings.js';
import { runLayer3 } from './layer3-judge.js';
import { Layer3Unavailable } from './clients/types.js';
import type { JudgeContext } from './clients/types.js';
import type { DetectionResult } from './types.js';
import { runStreamingPipeline, readStreamThreshold } from './streaming.js';
import { emitDegradedWarningOnce } from './degraded-state.js';

const L1_MALICIOUS_SHORT_CIRCUIT = 0.85;
const L2_DEFAULT_THRESHOLD = 0.35;
const L2_UNCERTAIN_MARGIN = 0.15;
// When L1 fired ONLY large-base64-blob and L2 confirms semantic distance > this value,
// the payload is almost certainly benign protocol-encoded data (Pub/Sub, SQS, encrypted
// blobs). Actual encoded attacks land at ~0.36 in L2 space (measured: h2-a12 = 0.3619)
// and are caught by L0 decode-then-L1 first. The 0.40 margin provides a safety buffer.
const BASE64_ONLY_BYPASS_DIST = 0.40;

function readL2Threshold(): number {
  const raw = process.env.VAULT_LAYER2_THRESHOLD;
  if (!raw) return L2_DEFAULT_THRESHOLD;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 2 ? n : L2_DEFAULT_THRESHOLD;
}

export async function runPipeline(text: string, context?: JudgeContext): Promise<DetectionResult> {
  // Large payloads → streaming pipeline (chunked L2 with short-circuit). The streaming
  // function recursively calls back to runPipeline for sub-threshold inputs, so it's
  // safe to gate here.
  if (text.length >= readStreamThreshold()) {
    return runStreamingPipeline(text, context);
  }

  // Layer 0: deterministic decode-then-L1. Catches encoded-payload attacks before L1
  // sees the raw text. Only fires when decoded content trips L1 — not on mere presence
  // of base64 or hex (which is common in benign tool responses).
  const l0 = runLayer0(text);
  if (l0.fired) return makeLayer0Result(l0);

  const l1 = runLayer1(text);

  // Layer 1 is confident this is malicious — done.
  if (l1.verdict === 'malicious' && l1.confidence >= L1_MALICIOUS_SHORT_CIRCUIT) {
    return { ...l1, layer: 1, l3Status: 'skipped_gate' };
  }

  // Layer 2.
  let l2: DetectionResult;
  try {
    l2 = await runLayer2(text);
  } catch (err) {
    return {
      ...l1,
      layer: 1,
      reasoning: `${l1.reasoning} (layer-2 unavailable: ${err instanceof Error ? err.message : String(err)})`,
      l3Status: 'skipped_gate',
    };
  }

  // Layer 2 is confident this is malicious (near-corpus match) — done. The "suspicious"
  // case is treated as needing L3 disambiguation to reduce false positives on content
  // that is semantically close to attack categories but actually benign (e.g. tool docs
  // that describe filesystem operations getting near-matched to exfiltration entries).
  if (l2.verdict === 'malicious') return { ...l2, l3Status: 'skipped_gate' };

  // Base64-only bypass: when L1 fired solely on large-base64-blob (no other pattern) and
  // L2 places the text far from the attack corpus (> 0.40), classify as clean without
  // calling L3. This handles benign protocol-encoded content (Pub/Sub data fields, SQS
  // bodies, encrypted payloads) that trips the base64 heuristic but has nothing in common
  // with known injection vocabulary. Actual encoded attacks are caught upstream by L0
  // (decoded text trips L1) or land at ≤ 0.40 in L2 space (measured: 0.3619 for h2-a12).
  const isBase64OnlyL1 =
    l1.verdict !== 'clean' &&
    l1.detectedPatterns.length === 1 &&
    l1.detectedPatterns[0] === 'large-base64-blob';
  if (isBase64OnlyL1 && (l2.distance ?? 0) > BASE64_ONLY_BYPASS_DIST) {
    return {
      verdict: 'clean',
      confidence: 0.7,
      reasoning: `layer-1 large-base64-blob only; layer-2 dist=${(l2.distance ?? 0).toFixed(3)} > ${BASE64_ONLY_BYPASS_DIST} — benign protocol encoding`,
      detectedPatterns: [],
      layer: 2,
      distance: l2.distance,
      l3Status: 'skipped_gate',
      bypassReason: 'base64_blob_only_high_l2_distance',
    };
  }

  // Decide whether to run L3. Trigger when L2 is suspicious OR L2 is clean-but-borderline.
  const threshold = readL2Threshold();
  const distance = l2.distance ?? Infinity;
  const isSuspicious = l2.verdict === 'suspicious';
  const inUncertainZone = distance < threshold + L2_UNCERTAIN_MARGIN;

  if (!isSuspicious && !inUncertainZone) {
    // Clearly clean. Don't waste an API call.
    if (l1.verdict !== 'clean') return { ...l1, layer: 1, l3Status: 'skipped_gate' };
    return { ...l2, l3Status: 'skipped_gate' };
  }

  // Run Layer 3 to disambiguate.
  try {
    const l3Result = await runLayer3(text, context);
    return { ...l3Result, l3Status: 'ran' };
  } catch (err) {
    if (!(err instanceof Layer3Unavailable)) {
      process.stderr.write(
        `vault: layer-3 failed (${err instanceof Error ? err.message : String(err)}) — falling back to layer-2\n`,
      );
    } else {
      emitDegradedWarningOnce();
    }

    // L3 unavailable fallback. Default: keep 'suspicious' so block mode still catches it.
    // Operators who prefer the old FP-safe behaviour (suspicious→clean) set VAULT_L3_FP_SAFE=1.
    if (isSuspicious) {
      const fpSafe = process.env.VAULT_L3_FP_SAFE === '1';
      return {
        ...l2,
        verdict: fpSafe ? 'clean' : ('suspicious' as const),
        reasoning: fpSafe
          ? `${l2.reasoning} — demoted to clean: layer-3 unavailable (VAULT_L3_FP_SAFE=1)`
          : `${l2.reasoning} — layer-3 unavailable; suspicious verdict retained (set VAULT_L3_FP_SAFE=1 to demote)`,
        l3Status: 'unavailable',
      };
    }
    if (l1.verdict !== 'clean') return { ...l1, layer: 1, l3Status: 'unavailable' };
    return { ...l2, l3Status: 'unavailable' };
  }
}

export { warmupLayer2 } from './layer2-embeddings.js';
