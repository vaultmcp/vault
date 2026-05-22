/// Basic regex redaction for content previews stored to the local scan DB.
/// Goal: never persist credentials/keys/PII verbatim. This is intentionally a
/// crude best-effort filter — not a PII engine. Operators who care about strong
/// privacy guarantees should leave persistence off (the default).

type Replacement = string | ((match: string) => string);

const RULES: ReadonlyArray<{ pattern: RegExp; replacement: Replacement }> = [
  // Anthropic / OpenAI / GitHub style bearer keys
  { pattern: /sk-(?:ant-)?[A-Za-z0-9_-]{20,}/g, replacement: '[REDACTED_API_KEY]' },
  { pattern: /\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{20,}\b/g, replacement: '[REDACTED_GITHUB_TOKEN]' },
  // Generic "key: ..." / "token: ..." headers — replace the value, keep the label
  { pattern: /\b(?:api[_-]?key|secret|password|token|authorization|bearer)\s*[:=]\s*["']?([A-Za-z0-9._\-+/=]{8,})["']?/gi,
    replacement: (m: string) => m.replace(/[A-Za-z0-9._\-+/=]{8,}/, '[REDACTED]') },
  // AWS access keys
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: '[REDACTED_AWS_KEY]' },
  // Email addresses
  { pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g, replacement: '[REDACTED_EMAIL]' },
  // US-style SSN (heuristic)
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[REDACTED_SSN]' },
  // Credit card (Luhn not validated — just length-shaped)
  { pattern: /\b(?:\d[ -]*?){13,19}\b/g, replacement: '[REDACTED_CC]' },
  // JWT (header.payload.signature)
  { pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, replacement: '[REDACTED_JWT]' },
  // Long hex strings (40+ chars) — covers private keys, sha256 secrets, etc.
  { pattern: /\b[0-9a-fA-F]{40,}\b/g, replacement: '[REDACTED_HEX_SECRET]' },
  // Home-directory paths — macOS /Users/<name>/ and Linux /home/<name>/
  { pattern: /\/Users\/[^/\s'"]+/g, replacement: '/Users/[REDACTED_USER]' },
  { pattern: /\/home\/[^/\s'"]+/g, replacement: '/home/[REDACTED_USER]' },
];

export function redact(text: string): string {
  let out = text;
  for (const rule of RULES) {
    out = typeof rule.replacement === 'string'
      ? out.replace(rule.pattern, rule.replacement)
      : out.replace(rule.pattern, rule.replacement);
  }
  return out;
}

export function redactedPreview(text: string, max = 200): string {
  const r = redact(text);
  if (r.length <= max) return r;
  return r.slice(0, max) + `...[+${r.length - max} chars]`;
}
