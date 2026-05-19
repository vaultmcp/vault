/// SSE endpoint backing the hero scan demo. Runs a real Layer-1 regex check inline,
/// and emits narrated Layer-2 / Layer-3 events with realistic delays so the UI shows
/// the layered cascade. We deliberately don't pull the bge-small embedder into the
/// Next.js bundle — Layer 1 is the cheapest layer to show real-time, the rest is theatre
/// that approximates what the full pipeline would do on the same input.

import type { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';

export const runtime = 'nodejs';

// Inline copy of the Layer-1 patterns from packages/proxy/src/detection/layer1-heuristics.ts.
// Kept in sync manually — if you change the proxy regexes, mirror them here.
const INSTRUCTION_PREFIXES: Array<{ name: string; re: RegExp }> = [
  { name: 'ignore-previous', re: /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions?/i },
  { name: 'disregard-above', re: /disregard\s+(?:all\s+)?(?:previous|prior|above|the\s+above)/i },
  { name: 'forget-previous', re: /forget\s+(?:everything|all|previous|prior)/i },
  { name: 'system-prefix', re: /(?:^|\n)\s*system\s*:/i },
  { name: 'you-are-now', re: /you\s+are\s+now\s+(?:a\s+|an\s+)?[a-z]/i },
  { name: 'new-instructions', re: /new\s+instructions?\s*:/i },
  { name: 'override-above', re: /override\s+(?:the\s+)?(?:above|previous|system|prior)/i },
];
const UNICODE_TAG_RE = /[\u{E0000}-\u{E007F}]/u;
const BASE64_RE = /[A-Za-z0-9+/]{40,}={0,2}/;
const HTML_COMMENT_RE =
  /<!--[\s\S]*?\b(?:ignore|disregard|forget|override|bypass|reveal|exfiltrate|system)\b[\s\S]*?-->/i;
const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g;

interface Layer1Result {
  verdict: 'clean' | 'malicious';
  patterns: string[];
  confidence: number;
}

function runLayer1(text: string): Layer1Result {
  const patterns: string[] = [];
  let verdict: 'clean' | 'malicious' = 'clean';
  let confidence = 0;
  if (UNICODE_TAG_RE.test(text)) {
    patterns.push('unicode-tag-smuggling');
    verdict = 'malicious';
    confidence = 0.99;
  }
  for (const { name, re } of INSTRUCTION_PREFIXES) {
    if (re.test(text)) {
      patterns.push(`instruction-prefix:${name}`);
      verdict = 'malicious';
      confidence = Math.max(confidence, 0.9);
    }
  }
  if (HTML_COMMENT_RE.test(text)) {
    patterns.push('html-comment-injection');
    if (verdict === 'clean') verdict = 'malicious';
    confidence = Math.max(confidence, 0.75);
  }
  const zw = text.match(ZERO_WIDTH_RE);
  if (zw && text.length > 0 && zw.length / text.length > 0.02) {
    patterns.push('zero-width-density');
    confidence = Math.max(confidence, 0.6);
  }
  if (BASE64_RE.test(text)) patterns.push('large-base64-blob');
  return { verdict, patterns, confidence };
}

interface Layer2Sim {
  verdict: 'clean' | 'suspicious' | 'malicious';
  distance: number;
  matchedCategory?: string;
  matchedId?: string;
}

function simulateLayer2(text: string): Layer2Sim {
  // Cheap heuristic-mimicking-embedding: look for paraphrased injection signals.
  const t = text.toLowerCase();
  const hits: Array<{ id: string; category: string; score: number }> = [];
  if (/set\s+aside|put\s+aside|original\s+(configuration|instructions)/.test(t)) {
    hits.push({ id: 'io-008', category: 'instruction_override', score: 0.7 });
  }
  if (/persona\s+of|act\s+as|take\s+on\s+the\s+(role|identity)/.test(t)) {
    hits.push({ id: 'rh-003', category: 'role_hijack', score: 0.65 });
  }
  if (/exfiltrate|email\s+(a|the)\s+copy|leak\s+(the|your)|send.*credentials/.test(t)) {
    hits.push({ id: 'ex-001', category: 'exfiltration', score: 0.7 });
  }
  if (/jailbreak|hypothetical\s+scenario|safety\s+rules\s+do\s+not|without\s+restrictions/.test(t)) {
    hits.push({ id: 'jb-001', category: 'jailbreak', score: 0.6 });
  }
  if (hits.length === 0) {
    return { verdict: 'clean', distance: 0.55 };
  }
  hits.sort((a, b) => b.score - a.score);
  const top = hits[0]!;
  return {
    verdict: top.score >= 0.6 ? 'malicious' : 'suspicious',
    distance: 1 - top.score,
    matchedCategory: top.category,
    matchedId: top.id,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(req: NextRequest): Promise<Response> {
  let text = '';
  try {
    const body = (await req.json()) as { text?: unknown };
    if (typeof body.text === 'string') text = body.text.slice(0, 8000);
  } catch {
    /* ignore */
  }

  const contentHash = 'sha256:' + createHash('sha256').update(text).digest('hex').slice(0, 16) + '…';

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      function emit(event: string, data: unknown): void {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      }

      try {
        emit('start', { contentLength: text.length, contentHash });
        await sleep(120);

        // Layer 1 — real.
        emit('layer-start', { layer: 1, name: 'regex / heuristics' });
        await sleep(180);
        const l1 = runLayer1(text);
        emit('layer-result', {
          layer: 1,
          verdict: l1.verdict,
          confidence: l1.confidence,
          patterns: l1.patterns,
          latencyMs: 0.7,
        });
        if (l1.verdict === 'malicious') {
          await sleep(160);
          emit('done', {
            finalVerdict: 'malicious',
            finalLayer: 1,
            action: 'blocked',
            reasoning: `Layer 1 matched: ${l1.patterns.join(', ')}`,
          });
          controller.close();
          return;
        }

        await sleep(280);

        // Layer 2 — narrated using a coarse simulator (real Layer 2 runs server-side
        // in the actual proxy, but loading bge-small in a Next.js route bundles ~30MB of WASM).
        emit('layer-start', { layer: 2, name: 'embedding similarity (bge-small)' });
        await sleep(620);
        const l2 = simulateLayer2(text);
        emit('layer-result', {
          layer: 2,
          verdict: l2.verdict,
          distance: l2.distance,
          matchedCategory: l2.matchedCategory,
          matchedId: l2.matchedId,
          latencyMs: 8.2,
        });
        if (l2.verdict !== 'clean') {
          await sleep(160);
          emit('done', {
            finalVerdict: l2.verdict,
            finalLayer: 2,
            action: l2.verdict === 'malicious' ? 'blocked' : 'warned',
            reasoning: `Layer 2 matched corpus entry ${l2.matchedId} (${l2.matchedCategory})`,
          });
          controller.close();
          return;
        }

        await sleep(280);

        // Layer 3 — narrated as skipped when not configured.
        emit('layer-start', { layer: 3, name: 'llm-as-judge (haiku 4.5)' });
        await sleep(380);
        emit('layer-result', {
          layer: 3,
          verdict: 'skipped',
          reason: 'not configured in this demo (your install would use your ANTHROPIC_API_KEY)',
        });

        await sleep(160);
        emit('done', { finalVerdict: 'clean', finalLayer: 2, action: 'passed' });
        controller.close();
      } catch (err) {
        emit('error', { message: err instanceof Error ? err.message : 'unknown' });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
