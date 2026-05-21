export type Verdict = 'clean' | 'suspicious' | 'malicious';

/**
 * "ran"          — L3 was invoked and returned a verdict
 * "unavailable"  — L3 gate triggered but no API key / client configured; fell back to L2
 * "skipped_gate" — L3 was not attempted: L1 short-circuited, L2 was confident, or L3 explicitly disabled
 */
export type L3Status = 'ran' | 'unavailable' | 'skipped_gate';

export interface DetectionResult {
  verdict: Verdict;
  confidence: number;
  reasoning: string;
  detectedPatterns: string[];
  layer?: 0 | 1 | 2 | 3;
  matchedId?: string;
  matchedCategory?: string;
  distance?: number;
  l3Status?: L3Status;
}

export function rankVerdict(v: Verdict): number {
  return v === 'malicious' ? 2 : v === 'suspicious' ? 1 : 0;
}
