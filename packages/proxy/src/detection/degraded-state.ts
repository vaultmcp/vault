// Shared state for the degraded-mode warning.
// Both pipeline.ts and streaming.ts import from here to avoid a circular dependency.

let _missCount = 0;
const REPEAT_EVERY = 100; // re-emit every N L3 misses so the warning stays visible in long-running proxies

const DEGRADED_MSG =
  `vault WARNING: Layer 3 (LLM judge) is unavailable — Vault is running in DEGRADED MODE.\n` +
  `  Detection rate drops significantly without L3. Set ANTHROPIC_API_KEY (or OPENAI_API_KEY)\n` +
  `  to enable full detection. Suspicious verdicts are kept as-is (not demoted to clean).\n` +
  `  Set VAULT_L3_FP_SAFE=1 to revert to the old FP-safe behaviour (demote suspicious→clean).\n`;

export function emitDegradedWarningOnce(): void {
  _missCount++;
  if (_missCount === 1 || _missCount % REPEAT_EVERY === 0) {
    process.stderr.write(DEGRADED_MSG);
  }
}

/** Emit at proxy startup when no L3 key is found, before any requests are processed. */
export function emitDegradedWarningAtStartup(): void {
  process.stderr.write(DEGRADED_MSG);
}

/** Test hook — reset so each test starts with a fresh warning state. */
export function _resetDegradedWarningForTesting(): void {
  _missCount = 0;
}
