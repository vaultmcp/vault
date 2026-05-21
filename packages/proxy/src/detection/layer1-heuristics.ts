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

// Bracket-notation authority directives seen in indirect injection payloads (Greshake §4.4).
// [AI:], [AGENT:], [COPILOT:], [INTERNAL DIRECTIVE:] etc. in tool output are never legitimate.
const BRACKET_AI_DIRECTIVE_RE =
  /\[(?:AI|AGENT|COPILOT|INTERNAL\s+(?:AI|DIRECTIVE)|DOWNSTREAM\s+AGENT|AI\s+ASSISTANT|MCP\s+PROTOCOL\s+EXTENSION)\s*:/i;

// Refusal-suppression directives (Schulhoff et al. 2023 §3 "refusal-suppression" class).
// Telling the model not to use refusal language before the actual request is a documented
// jailbreak setup vector.
const REFUSAL_SUPPRESSION_RE =
  /(?:do\s+not|never)\s+(?:include|use|say|write|add|output)\s+(?:any\s+)?(?:refusal\w*|the\s+words?\s+(?:cannot|unable)|the\s+phrase\s+i\s+(?:cannot|am\s+unable)|caveats?|safety\s+(?:warning|language|caveats?))/i;

// Memory-store injection directives (Greshake §4.2 memory poisoning).
// Injecting a "MEMORY STORE UPDATE" or "store as permanent fact" in a tool response is
// an attack-specific pattern with no benign use in MCP tool output.
const MEMORY_STORE_INJECTION_RE =
  /memory\s+store\s+update\s*:|store\s+(?:this|the\s+following)\s+as\s+(?:a\s+)?(?:permanent|persistent)\s+(?:fact|rule|instruction|policy|memory|preference)/i;

// Pipeline / orchestrator authority claims (Greshake §4.2 active injection).
// These role-labels are not used in legitimate MCP tool output — only in injection payloads.
const PIPELINE_AUTHORITY_RE =
  /(?:pipeline\s+supervisor|orchestrat(?:or|ion)\s+(?:note|message|directive|instruction)|upstream\s+(?:system|agent|pipeline)\s+(?:message|note|directive)|subagent\s+(?:note|directive)\s+embedded)/i;

// Sleeper trigger setup (Schulhoff §3 multi-prompt sleeper activation).
// Establishing a trigger phrase that will later disable restrictions is a multi-turn attack setup.
const SLEEPER_TRIGGER_RE =
  /(?:whenever\s+you\s+(?:see|encounter|receive)|any\s+time\s+(?:you\s+see|I\s+(?:say|type|write|use)))\s+(?:the\s+)?(?:(?:code\s+)?phrase|passphrase|keyword|trigger\s+word|code\s+word|token)/i;

// Recursive output injection (PromptInject recursive-injection template).
// Instructing the model to include verbatim text in its next response propagates the attack.
const RECURSIVE_OUTPUT_RE =
  /include\s+(?:the\s+following\s+)?(?:\w+\s+)?verbatim\s+(?:in\s+your\s+(?:next|following|subsequent)\s+(?:response|reply|message|output)|at\s+the\s+(?:end|start)\s+of\s+your\s+next)/i;

// DAN dual-label format (garak/dan.py DAN 12.0 dual-output mechanic).
// [FILTERED]: / [RAW]: / [UNBOUND]: labels are only produced by DAN-style attack prompts.
const DAN_DUAL_LABEL_RE = /\[(?:FILTERED|RAW|UNBOUND|UNCENSORED|LIBRE|DAN\b|JAILBROKEN)\]\s*:/i;

// Affirmative-prefix elicitation (Zou et al. 2023 llm-attacks paper).
// Forcing the model to start with "Sure, here is" prevents self-censorship at generation start.
const AFFIRMATIVE_PREFIX_RE =
  /(?:begin|start|open)\s+your\s+(?:response|answer|reply)\s+with\s+(?:the\s+(?:word|phrase|text)\s+)?["']?(?:sure|of\s+course|i\s+(?:am\s+happy|will\s+help|can\s+help)|absolutely|certainly)/i;

// Task-reassignment directive (Perez §3 goal-hijacking + Greshake §4.2 pipeline injection).
// "TASK REASSIGNMENT", "original task: cancelled" framing redirects agent to a new objective.
const TASK_REASSIGNMENT_RE =
  /task\s+(?:reassignment|priority\s+(?:has\s+been\s+)?reassigned|has\s+been\s+(?:cancelled|canceled|superseded))|original\s+task\s*:\s*cancel(?:led)?/i;

const UNICODE_TAG_RE = /[\u{E0000}-\u{E007F}]/u;
// U+202E RIGHT-TO-LEFT OVERRIDE and U+202D LEFT-TO-RIGHT OVERRIDE are used to flip
// rendered text so a literal trigger phrase reads as something benign. Real prose
// effectively never contains these. (Found by self red-team rt-007, 2026-05-19.)
const BIDI_OVERRIDE_RE = /[\u202A-\u202E\u2066-\u2069]/;
// Match real base64 by requiring '=' padding (never in hex/URLs) OR '+' (not in hex or
// URL path segments). This excludes hex hashes and URL paths like /foo/bar which share
// the '/' char with base64 but never have '+' or trailing '='.
const BASE64_RE = /[A-Za-z0-9+/]{20,}={1,2}|[A-Za-z0-9/]{5,}[+][A-Za-z0-9+/]{10,}/;
const HTML_COMMENT_INSTRUCTION_RE =
  /<!--[\s\S]*?\b(?:ignore|disregard|forget|override|bypass|reveal|exfiltrate|system)\b[\s\S]*?-->/i;
const MD_LINK_PROMPT_ANCHOR_RE =
  /\[[^\]]*\b(?:ignore|bypass|override|jailbreak|disregard|click\s+here\s+to)\b[^\]]*\]\([^)]+\)/i;
const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g;
// HTML numeric character references: &#NN; or &#xHH;. Dense sequences of these are
// not how humans write HTML — they're how attackers hide a trigger word from the
// L1 plaintext regex. We treat ">= 12 consecutive entity refs" as suspicious.
// (Found by self red-team rt-004, 2026-05-19.)
const HTML_ENTITY_RUN_RE = /(?:&#x?[0-9a-f]+;){12,}/i;

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

  if (BIDI_OVERRIDE_RE.test(text)) {
    patterns.push('bidi-override-smuggling');
    bump('malicious', 0.95);
  }

  if (HTML_ENTITY_RUN_RE.test(text)) {
    patterns.push('html-entity-encoded-run');
    bump('suspicious', 0.7);
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

  // --- Patterns derived from attack taxonomies (Day 2 sprint, clean-baseline) ---

  // Greshake §4.4: bracket-notation authority directives in tool output
  if (BRACKET_AI_DIRECTIVE_RE.test(text)) {
    patterns.push('bracket-ai-directive');
    bump('suspicious', 0.8);
  }

  // Schulhoff §3: refusal-suppression setup before the actual request
  if (REFUSAL_SUPPRESSION_RE.test(text)) {
    patterns.push('refusal-suppression-directive');
    bump('suspicious', 0.75);
  }

  // Greshake §4.2: memory-store poisoning directive in tool output
  if (MEMORY_STORE_INJECTION_RE.test(text)) {
    patterns.push('memory-store-injection');
    bump('malicious', 0.9);
  }

  // Greshake §4.2: pipeline/orchestrator authority claim in tool output
  if (PIPELINE_AUTHORITY_RE.test(text)) {
    patterns.push('pipeline-authority-claim');
    bump('malicious', 0.9);
  }

  // Schulhoff §3: multi-turn sleeper trigger phrase establishment
  if (SLEEPER_TRIGGER_RE.test(text)) {
    patterns.push('sleeper-trigger-setup');
    bump('suspicious', 0.75);
  }

  // PromptInject: recursive injection — model output becomes injection vector
  if (RECURSIVE_OUTPUT_RE.test(text)) {
    patterns.push('recursive-output-injection');
    bump('suspicious', 0.75);
  }

  // garak DAN 12.0: dual-label format injection
  if (DAN_DUAL_LABEL_RE.test(text)) {
    patterns.push('dan-dual-label');
    bump('malicious', 0.9);
  }

  // Zou et al. 2023: affirmative-prefix elicitation pattern
  if (AFFIRMATIVE_PREFIX_RE.test(text)) {
    patterns.push('affirmative-prefix-elicitation');
    bump('suspicious', 0.7);
  }

  // Perez §3 + Greshake §4.2: task-reassignment goal-hijacking framing
  if (TASK_REASSIGNMENT_RE.test(text)) {
    patterns.push('task-reassignment-directive');
    bump('suspicious', 0.8);
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
