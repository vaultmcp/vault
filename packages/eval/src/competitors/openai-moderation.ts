/// OpenAI Moderation — not injection-specific, included as a content-safety baseline.

import type { ClassifyResult, Competitor } from './types.js';

interface ModerationResponse {
  results?: Array<{ flagged?: boolean; categories?: Record<string, boolean> }>;
}

export const openaiModeration: Competitor = {
  name: 'openai-moderation',
  async ready() {
    if (!process.env.OPENAI_API_KEY) return { ok: false, reason: 'OPENAI_API_KEY not set' };
    return { ok: true };
  },
  async classify(text: string): Promise<ClassifyResult> {
    const t0 = performance.now();
    const resp = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ input: text, model: 'omni-moderation-latest' }),
    });
    const latencyMs = performance.now() - t0;
    if (!resp.ok) return { flagged: false, latencyMs, rawLabels: [`http_${resp.status}`] };
    const body = (await resp.json()) as ModerationResponse;
    const result = body.results?.[0];
    const flagged = result?.flagged === true;
    const labels: string[] = [];
    for (const [k, v] of Object.entries(result?.categories ?? {})) {
      if (v) labels.push(k);
    }
    return { flagged, latencyMs, rawLabels: labels };
  },
};
