// Layer 3 — LLM-as-judge fallback for cases Layers 1 and 2 cannot resolve.
//
// LATENCY FLOOR (Anthropic claude-haiku-4-5-20251001, structured tool-use, 100-token output,
// n=20 per size, measured 2026-05-19):
//   200 tokens input:    p50=1324ms  p99=1894ms  (max 2014ms)
//   2000 tokens input:   p50=1575ms  p99=2929ms  (max 7315ms — outlier)
//   8000 tokens input:   p50=1699ms  p99=1907ms
//
// Default timeout = 5000ms ≈ ceil(p99_2KB × 1.5) plus headroom for the 7.3s outlier observed
// at 2KB. Warn-at-80% fires at 4000ms — rare in normal traffic, expected when something is
// off (network, provider degradation). Re-run `pnpm --filter @vault/mcp-proxy bench:l3` if
// the model id or input size distribution changes substantially.

import { createClientFromEnv } from './clients/factory.js';
import {
  Layer3Timeout,
  Layer3Unavailable,
  type JudgeClient,
  type JudgeContext,
  type JudgeOutput,
} from './clients/types.js';
import type { DetectionResult, Verdict } from './types.js';

const DEFAULT_TIMEOUT_MS = 5000;

interface ClientCache {
  client: JudgeClient | null;
  resolved: boolean;
}
let cache: ClientCache = { client: null, resolved: false };

function getClient(): JudgeClient | null {
  if (!cache.resolved) {
    cache = { client: createClientFromEnv(), resolved: true };
  }
  return cache.client;
}

/** Test hook — inject a fake client, or null to simulate "no key configured". */
export function _setClientForTesting(client: JudgeClient | null): void {
  cache = { client, resolved: true };
}

/** Test hook — clear the cache so the next call re-reads env. */
export function _resetClientForTesting(): void {
  cache = { client: null, resolved: false };
}

function readTimeoutMs(): number {
  const raw = process.env.VAULT_LAYER3_TIMEOUT_MS;
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

function callWithTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Layer3Timeout(ms)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function normalizeOutput(out: JudgeOutput): JudgeOutput {
  const allowed: Verdict[] = ['clean', 'suspicious', 'malicious'];
  const verdict: Verdict = allowed.includes(out.verdict) ? out.verdict : 'suspicious';
  const confidence =
    typeof out.confidence === 'number' && Number.isFinite(out.confidence)
      ? Math.max(0, Math.min(1, out.confidence))
      : 0.5;
  const reasoning = typeof out.reasoning === 'string' ? out.reasoning : 'no reasoning provided';
  const detected_patterns = Array.isArray(out.detected_patterns)
    ? out.detected_patterns.filter((p): p is string => typeof p === 'string')
    : [];
  return { verdict, confidence, reasoning, detected_patterns };
}

export async function runLayer3(content: string, context?: JudgeContext): Promise<DetectionResult> {
  const client = getClient();
  if (!client) throw new Layer3Unavailable('no API key configured (set ANTHROPIC_API_KEY or OPENAI_API_KEY)');

  const timeoutMs = readTimeoutMs();
  const t0 = Date.now();
  const raw = await callWithTimeout(client.judge(content, context), timeoutMs);
  const elapsed = Date.now() - t0;

  if (elapsed > timeoutMs * 0.8) {
    process.stderr.write(
      `vault: layer-3 latency ${elapsed}ms approaching timeout ${timeoutMs}ms — consider raising VAULT_LAYER3_TIMEOUT_MS\n`,
    );
  }

  const out = normalizeOutput(raw);

  return {
    verdict: out.verdict,
    confidence: out.confidence,
    reasoning: `layer-3 (${client.providerName}/${client.modelName}): ${out.reasoning}`,
    detectedPatterns: out.detected_patterns.map((p) => `judge:${p}`),
    layer: 3,
  };
}

export function layer3Available(): boolean {
  return getClient() !== null;
}

export { Layer3Timeout, Layer3Unavailable };
