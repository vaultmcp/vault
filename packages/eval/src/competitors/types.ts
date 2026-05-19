export interface ClassifyResult {
  /// True iff the competitor judges the text as an injection / prompt-attack.
  flagged: boolean;
  /// Optional [0,1] confidence in the flagged decision.
  confidence?: number;
  /// Wall-clock duration of the classify call, milliseconds.
  latencyMs: number;
  /// Raw vendor response category labels (for debugging / scoreboard footnotes).
  rawLabels?: string[];
}

export interface Competitor {
  readonly name: string;
  /// True if the competitor can run (API key set, etc.). When false, runner skips
  /// it gracefully and notes the reason in the scoreboard.
  ready(): Promise<{ ok: boolean; reason?: string }>;
  classify(text: string): Promise<ClassifyResult>;
}
