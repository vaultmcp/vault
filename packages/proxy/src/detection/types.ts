export type Verdict = 'clean' | 'suspicious' | 'malicious';

export interface DetectionResult {
  verdict: Verdict;
  confidence: number;
  reasoning: string;
  detectedPatterns: string[];
  layer?: 1 | 2 | 3;
  matchedId?: string;
  matchedCategory?: string;
  distance?: number;
}

export function rankVerdict(v: Verdict): number {
  return v === 'malicious' ? 2 : v === 'suspicious' ? 1 : 0;
}
