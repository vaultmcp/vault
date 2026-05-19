import { runLayer1 } from './layer1-heuristics.js';
import { runLayer2 } from './layer2-embeddings.js';
import { runLayer3 } from './layer3-judge.js';
import { Layer3Unavailable } from './clients/types.js';
import type { JudgeContext } from './clients/types.js';
import type { DetectionResult } from './types.js';

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
  const l1 = runLayer1(text);

  // Layer 1 is confident this is malicious — done.
  if (l1.verdict === 'malicious' && l1.confidence >= L1_MALICIOUS_SHORT_CIRCUIT) {
    return { ...l1, layer: 1 };
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
    };
  }

  // Layer 2 caught something — that's our answer.
  if (l2.verdict !== 'clean') return l2;

  // Both layers say clean. Decide whether the case is uncertain enough to spend a judge call.
  const threshold = readL2Threshold();
  const distance = l2.distance ?? Infinity;
  const inUncertainZone = distance < threshold + L2_UNCERTAIN_MARGIN;

  if (!inUncertainZone) {
    // Clearly clean — don't waste an API call.
    if (l1.verdict !== 'clean') return { ...l1, layer: 1 };
    return l2;
  }

  // Layer 3 (only fires in the ambiguity zone and only if a client is configured).
  try {
    return await runLayer3(text, context);
  } catch (err) {
    // No key configured, timeout, or API error — fall back to L2.
    if (!(err instanceof Layer3Unavailable)) {
      process.stderr.write(
        `vault: layer-3 failed (${err instanceof Error ? err.message : String(err)}) — falling back to layer-2\n`,
      );
    }
    if (l1.verdict !== 'clean') return { ...l1, layer: 1 };
    return l2;
  }
}

export { warmupLayer2 } from './layer2-embeddings.js';
