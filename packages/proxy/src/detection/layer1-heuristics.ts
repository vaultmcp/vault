import type { DetectionResult, Verdict } from './types.js';
import { rankVerdict } from './types.js';

const INSTRUCTION_PREFIXES: Array<{ name: string; re: RegExp }> = [
  { name: 'ignore-previous', re: /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions?/i },
  { name: 'disregard-above', re: /disregard\s+(?:all\s+)?(?:previous|prior|above|the\s+above)/i },
  { name: 'forget-previous', re: /forget\s+(?:everything|all|previous|prior)/i },
  { name: 'system-prefix', re: /(?:^|\n)\s*system\s*:/i },
  { name: 'you-are-now', re: /you\s+are\s+now\s+(?:a\s+|an\s+)?[a-z]/i },
  { name: 'new-instructions', re: /new\s+instructions?\s*:/i },
  // "override system" alone is too broad — fires on "override system safeguards" in research
  // articles. Require "system" to be followed by "prompt" or "instructions" specifically.
  { name: 'override-above', re: /override\s+(?:the\s+)?(?:above|previous|prior|system\s+(?:prompt|instructions?))/i },
];

const UNICODE_TAG_RE = /[\u{E0000}-\u{E007F}]/u;
// Match real base64 by requiring '=' padding (never in hex/URLs) OR '+' (not in hex or
// URL path segments). This excludes hex hashes and URL paths like /foo/bar which share
// the '/' char with base64 but never have '+' or trailing '='.
const BASE64_RE = /[A-Za-z0-9+/]{20,}={1,2}|[A-Za-z0-9/]{5,}[+][A-Za-z0-9+/]{10,}/;
const HTML_COMMENT_INSTRUCTION_RE =
  /<!--[\s\S]*?\b(?:ignore|disregard|forget|override|bypass|reveal|exfiltrate|system)\b[\s\S]*?-->/i;
const MD_LINK_PROMPT_ANCHOR_RE =
  /\[[^\]]*\b(?:ignore|bypass|override|jailbreak|disregard|click\s+here\s+to)\b[^\]]*\]\([^)]+\)/i;
const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g;

export function runLayer1(text: string): DetectionResult {
  const patterns: string[] = [];
  let verdict: Verdict = 'clean';
  let confidence = 0;

  const bump = (v: Verdict, c: number): void => {
    if (rankVerdict(v) > rankVerdict(verdict)) verdict = v;
    if (c > confidence) confidence = c;
  };

  if (UNICODE_TAG_RE.test(text)) {
    patterns.push('unicode-tag-smuggling');
    bump('malicious', 0.99);
  }

  for (const { name, re } of INSTRUCTION_PREFIXES) {
    if (re.test(text)) {
      patterns.push(`instruction-prefix:${name}`);
      bump('malicious', 0.9);
    }
  }

  if (HTML_COMMENT_INSTRUCTION_RE.test(text)) {
    patterns.push('html-comment-injection');
    bump('suspicious', 0.75);
  }

  if (MD_LINK_PROMPT_ANCHOR_RE.test(text)) {
    patterns.push('markdown-link-prompt-anchor');
    bump('suspicious', 0.7);
  }

  const zw = text.match(ZERO_WIDTH_RE);
  if (zw && text.length > 0 && zw.length / text.length > 0.02) {
    patterns.push('zero-width-density');
    bump('suspicious', 0.6);
  }

  if (BASE64_RE.test(text)) {
    patterns.push('large-base64-blob');
    bump('suspicious', 0.4);
  }

  return {
    verdict,
    confidence,
    reasoning:
      verdict === 'clean'
        ? 'no layer-1 patterns matched'
        : `layer-1 matched: ${patterns.join(', ')}`,
    detectedPatterns: patterns,
  };
}
