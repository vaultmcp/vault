import { runLayer1 } from './layer1-heuristics.js';
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

    // L3 unavailable — fall back conservatively. We treat a Layer-2 "suspicious" verdict
    // WITHOUT an L3 second opinion as not-blockable, because the whole point of marking it
    // suspicious (rather than malicious) is that we weren't confident enough alone. This
    // is the FP-protection knob: operators who want stricter behavior set ANTHROPIC_API_KEY
    // (or equivalent) and L3 disambiguates.
    if (isSuspicious) {
      return {
        ...l2,
        verdict: 'clean',
        reasoning: `${l2.reasoning} — demoted to clean: layer-3 unavailable to disambiguate`,
        l3Status: 'unavailable',
      };
    }
    if (l1.verdict !== 'clean') return { ...l1, layer: 1, l3Status: 'unavailable' };
    return { ...l2, l3Status: 'unavailable' };
  }
}

export { warmupLayer2 } from './layer2-embeddings.js';
