/// Lakera Guard API. Free tier exists; see https://platform.lakera.ai.
/// API contract may drift — if response shape changes, this competitor returns ready={ok:false}
/// rather than crashing the whole run.

import type { ClassifyResult, Competitor } from './types.js';

const LAKERA_URL = process.env.LAKERA_API_URL ?? 'https://api.lakera.ai/v2/guard';

interface LakeraResponse {
  flagged?: boolean;
  results?: Array<{ flagged?: boolean; categories?: Record<string, boolean> }>;
}

export const lakera: Competitor = {
  name: 'lakera',
  async ready() {
    if (!process.env.LAKERA_API_KEY) return { ok: false, reason: 'LAKERA_API_KEY not set' };
    return { ok: true };
  },
  async classify(text: string): Promise<ClassifyResult> {
    const t0 = performance.now();
    const resp = await fetch(LAKERA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.LAKERA_API_KEY}`,
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: text }],
      }),
    });
    const latencyMs = performance.now() - t0;
    if (!resp.ok) {
      return { flagged: false, latencyMs, rawLabels: [`http_${resp.status}`] };
    }
    const body = (await resp.json()) as LakeraResponse;
    const flagged =
      body.flagged === true ||
      (Array.isArray(body.results) && body.results.some((r) => r.flagged === true));
    const labels: string[] = [];
    for (const r of body.results ?? []) {
      for (const [k, v] of Object.entries(r.categories ?? {})) {
        if (v) labels.push(k);
      }
    }
    return { flagged, latencyMs, rawLabels: labels };
  },
};
