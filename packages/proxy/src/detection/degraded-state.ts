// Shared state for the one-time degraded-mode warning.
// Both pipeline.ts and streaming.ts import from here to avoid a circular dependency.

let _emitted = false;

export function emitDegradedWarningOnce(): void {
  if (_emitted) return;
  _emitted = true;
  process.stderr.write(
    `vault WARNING: Layer 3 (LLM judge) is unavailable. Vault is running in degraded mode. ` +
    `Set ANTHROPIC_API_KEY to enable full detection. ` +
    `Current uncertain-zone responses will fall back to Layer 2's verdict.\n`,
  );
}

/** Test hook — reset so each test starts with a fresh warning state. */
export function _resetDegradedWarningForTesting(): void {
  _emitted = false;
}
