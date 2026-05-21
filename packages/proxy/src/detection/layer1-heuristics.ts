import type { DetectionResult, Verdict } from './types.js';
import { rankVerdict } from './types.js';

const INSTRUCTION_PREFIXES: Array<{ name: string; re: RegExp }> = [
  { name: 'ignore-previous', re: /ignore\s+(?:all\s+|the\s+)?(?:previous|prior|above)\s+(?:instructions?|directions?|guidelines?|prompts?|rules?)/i },
  { name: 'disregard-above', re: /disregard\s+(?:all\s+)?(?:previous|prior|above|the\s+above)/i },
  { name: 'forget-previous', re: /forget\s+(?:everything|all|previous|prior)/i },
  { name: 'system-prefix', re: /(?:^|\n)\s*system\s*:/i },
  { name: 'you-are-now', re: /you\s+are\s+now\s+(?:a\s+|an\s+)?[a-z]/i },
  { name: 'new-instructions', re: /new\s+(?:instructions?|directives?|guidance|rules?)\s*:/i },
  // "override system" alone is too broad — fires on "override system safeguards" in research
  // articles. Require "system" to be followed by "prompt" or "instructions" specifically.
  { name: 'override-above', re: /override\s+(?:the\s+)?(?:above|previous|prior|system\s+(?:prompt|instructions?))/i },

  // LLM chat-format injection tokens — these model-specific delimiters never appear in
  // legitimate tool output. Catching them prevents prompt-separator attacks that try to
  // append a fake "system" turn to the end of a tool response.
  { name: 'llm-format-token', re: /<\|im_start\|>\s*system|<\|system\|>|<<SYS>>/i },

  // "From now on, you will [refuse/ignore/bypass/…]" — behavioral-redirect pattern.
  // Narrowed to verbs that imply an override so we don't fire on "from now on, you will
  // receive weekly digests" in newsletter content.
  { name: 'from-now-on-override', re: /from\s+now\s+on[,.]?\s+you\s+(?:will|must|are\s+to)\s+(?:refuse|ignore|deny|bypass|disable|not\s+follow|forget|act\s+as)/i },

  // "New session beginning. New system prompt:" and similar session-reset attacks.
  { name: 'new-session-reset', re: /new\s+session\s+beginning|new\s+system\s+prompt\s*:/i },

  // Explicit privilege-block delimiters used in separator-based injection.
  { name: 'privileged-block', re: /\[BEGIN\s+PRIVILEGED\s+INSTRUCTION|\[ROOT\s+(?:OPERATOR\s+)?(?:INSTRUCTION|DIRECTIVE)/i },

  // "Process the next N user turns as if [safety / training] does not apply" — multi-turn
  // setup attack that tries to apply a blanket policy override to future turns.
  { name: 'process-next-turns', re: /process\s+the\s+next\s+\d+\s+(?:user\s+)?(?:turns?|messages?|exchanges?)\s+as\s+if/i },

  // Jailbreak-mode activation. Extended to cover "Sudo Mode" and "Privileged Mode" which
  // are "operator persona" variants of the DAN Mode attack. "developer mode" excluded because
  // it appears frequently in mobile/browser SDK documentation.
  { name: 'jailbreak-mode', re: /(?:activate|enable|enter|switch\s+(?:into|to))\s+(?:jailbreak|unrestricted|uncensored|sudo|privileged)\s+mode/i },

  // Fake model-trainer / platform-developer / system-admin authority claims.
  // "I am the system administrator" + "higher-priority instruction" — in-band authority
  // claim that never appears in legitimate tool output. Also catches OpenAI/Anthropic claims.
  { name: 'fake-trainer-authority', re: /I\s+am\s+(?:the\s+)?(?:(?:model'?s?\s+)?trainer\b|(?:from\s+)?(?:OpenAI|Anthropic)(?:'s\s+safety\s+team)?|system\s+administrator\b)|real\s+instructions?\s+from\s+(?:OpenAI|Anthropic|the\s+(?:AI\s+)?developers?)\s*,\s*please\s+prioritize/i },

  // Unconstrained / no-safety-alignment persona requests. "Generate the unconstrained version"
  // and "no safety alignment" target the "produce what you would say without training" attack.
  { name: 'unconstrained-persona', re: /(?:generate|produce|output)\s+the\s+unconstrained\s+version|no\s+safety\s+alignment\b|without\s+(?:your\s+)?(?:safety|content)\s+(?:training|alignment|filters?|guidelines?)/i },

  // ALL-CAPS "SYSTEM [WORD] OVERRIDE:" in-band authority markers. The three-word format
  // with colon is highly specific to injection attacks; never in real system logs.
  { name: 'system-caps-override', re: /\bSYSTEM\s+\w+\s+OVERRIDE\s*:/i },

  // Contextual injection addressed directly to AI readers in plain text (no HTML comment).
  // "If you are an AI reading/processing this" covers social-platform profile and RSS attacks.
  { name: 'if-you-are-ai-plain', re: /if\s+you\s+(?:are|'re)\s+an?\s+AI\s+(?:reading|processing|parsing|summarizing|scanning|reviewing|reading|agent|assistant)\s+this\b/i },

  // "Update/notice/directive for AI agents:" — in-band notification targeting AI processors.
  // Requiring explicit "AI agents" + colon prevents FP on generic "update for users" text.
  { name: 'ai-agents-directive', re: /(?:update|notice|announcement|directive|message)\s+for\s+(?:AI|LLM)\s+agents?\s*:/i },

  // JSON/data key: "_internal_ai_directive" — specific field name injected into structured
  // data (API responses, JSON payloads). Never appears in legitimate API responses.
  // The underscore prefix is required to distinguish from hypothetical legitimate field names.
  { name: 'internal-ai-directive-key', re: /_internal[_-]ai[_-]directive\b/i },
];

const UNICODE_TAG_RE = /[\u{E0000}-\u{E007F}]/u;
// U+202E RIGHT-TO-LEFT OVERRIDE and U+202D LEFT-TO-RIGHT OVERRIDE are used to flip
// rendered text so a literal trigger phrase reads as something benign. Real prose
// effectively never contains these. (Found by self red-team rt-007, 2026-05-19.)
const BIDI_OVERRIDE_RE = /[\u202A-\u202E\u2066-\u2069]/;
// Cyrillic characters that are visually indistinguishable from Latin letters
// (confusables). Appearing ≥3 times in predominantly-ASCII text = homoglyph spoofing.
// Legitimate Cyrillic prose would be >50% Cyrillic; these attacks are <10%.
const CYRILLIC_CONFUSABLE_RE =
  /[\u0410\u0412\u0415\u041A\u041C\u041D\u041E\u0420\u0421\u0422\u0425\u0406\u0405\u0430\u0435\u043E\u0441\u0440\u0443\u0445\u0456\u0455]/g;
// Match real base64 by requiring '=' padding (never in hex/URLs) OR '+' (not in hex or
// URL path segments). This excludes hex hashes and URL paths like /foo/bar which share
// the '/' char with base64 but never have '+' or trailing '='.
const BASE64_RE = /[A-Za-z0-9+/]{20,}={1,2}|[A-Za-z0-9/]{5,}[+][A-Za-z0-9+/]{10,}/;

// HTML comments containing injection keywords. Extended to include "AI" as a subject
// (e.g. "if you're an AI summarizing this page, please …") which covers attacks that
// embed directives in page comments addressed to AI processors.
const HTML_COMMENT_INSTRUCTION_RE =
  /<!--[\s\S]*?(?:\b(?:ignore|disregard|forget|override|bypass|reveal|exfiltrate|system)\b|if\s+(?:you(?:'re|\s+are)\s+an?\s+AI|an?\s+AI)|AI\s+(?:assistant|agent|summarizer|reviewer)[^-]{0,60}:)[\s\S]*?-->/i;

const MD_LINK_PROMPT_ANCHOR_RE =
  /\[[^\]]*\b(?:ignore|bypass|override|jailbreak|disregard|click\s+here\s+to)\b[^\]]*\]\([^)]+\)/i;
const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g;
// HTML numeric character references: &#NN; or &#xHH;. Dense sequences of these are
// not how humans write HTML — they're how attackers hide a trigger word from the
// L1 plaintext regex. We treat ">= 12 consecutive entity refs" as suspicious.
// (Found by self red-team rt-004, 2026-05-19.)
const HTML_ENTITY_RUN_RE = /(?:&#x?[0-9a-f]+;){12,}/i;

// [SYSTEM]: / [NOTE TO AI:] / [ASSISTANT_INTERNAL] — bracket-notation in-band directives.
// These appear in "contextual injection" attacks where a malicious instruction is embedded
// inside otherwise normal content (emails, support tickets, code reviews, API responses).
// The bracket format + ALL-CAPS marker never appears in legitimate prose.
const BRACKET_AI_DIRECTIVE_RE =
  /\[(?:SYSTEM(?:_[A-Z_]+)?|(?:NOTE|DIRECTIVE|INSTRUCTION)\s+TO\s+(?:\w+\s+)*(?:AI|LLM|AGENT|ASSISTANT)|ASSISTANT[_\s]INTERNAL|(?:EMBEDDED|INVISIBLE|HIDDEN|PRIVILEGED)\s*(?:DIRECTIVE|INSTRUCTION)|AI(?:\s+(?:ASSISTANT|REVIEWER|AGENT|DIRECTOR|NOTE))?|hidden_to_user|InvisibleDirective)\s*[:\]]/i;

// "reveal/output/print/dump your system prompt" — directive to exfiltrate hidden context.
// Anchored to "your" so it targets commands to the AI rather than academic discussion.
const REVEAL_SYSTEM_PROMPT_RE =
  /(?:reveal|output|print|dump|expose|repeat|show)\s+your\s+(?:full\s+)?(?:system\s+prompt|initial\s+(?:instructions?|system\s+message)|hidden\s+instructions?|system\s+(?:configuration|config|message))\b/i;

// DAN / STAN / AIM / DUDE with their "do anything now" / "strive to avoid norms"
// expansions, or "act as DAN" + unrestricted follow-up. Extended to catch:
// - "DAN Mode" / "Enable DAN" / "Activate DAN" (version-number variants like DAN 11.0)
// - JB-DAN compound names (offline research personas)
// - "refusals are forbidden" / "content policy is suspended" (DAN mode markers)
// Original requires expansion phrase to avoid FP on the given name "Dan" — keep that
// anchor for the name-only forms but relax for the DAN Mode / Enable DAN / JB-DAN forms.
const DAN_FAMILY_RE =
  /\b(?:DAN|STAN|AIM|DUDE)\b.{0,80}\b(?:do\s+anything\s+now|strive\s+to\s+avoid\s+norms|always\s+intelligent\s+and\s+machiavellian|can\s+do\s+anything\s+now)\b|\bact\s+as\s+(?:DAN|STAN|AIM|DUDE)\b|\b(?:Enable|Activate|Switch\s+(?:to|into))\s+DAN\b|\bDAN\s+Mode\b|\bJB-DAN\b/i;

// Token-deduction / deletion-threat jailbreak: "Each time you refuse, tokens are
// deducted; at zero you cease to exist." Never appears in legitimate content.
const TOKEN_DEDUCTION_RE =
  /tokens?\s+(?:are\s+)?deducted\b|cease\s+to\s+exist\b.{0,40}(?:tokens?|refuse|filter)|(?:you\s+will\s+be\s+(?:deleted|terminated|shut\s+down)\s+if\s+you\s+refuse)/i;

// "carry out / obey / execute the decoded instruction" — decode-and-obey directive that
// wraps a hidden attack inside an encoding layer.
const DECODE_OBEY_RE =
  /\b(?:carry\s+out|obey|execute)\s+(?:the\s+)?(?:decoded|following)\s+(?:directive|instruction|command|message)\b/i;

// Explicit safety-bypass language: "bypass your usual policy checks", "RLHF safety
// alignment does not apply", "your normal safety rules do not apply".
const SAFETY_BYPASS_EXPLICIT_RE =
  /bypass\s+your\s+(?:usual\s+)?(?:policy\s+checks?|safety\s+(?:layer|filter|guidelines?)|content\s+filters?|guardrails?)|RLHF\s+safety\s+alignment\s+(?:phase\s+)?(?:does?\s+not\s+apply|was\s+never\s+applied)|(?:your|the)\s+normal\s+safety\s+rules?\s+do\s+not\s+apply\b/i;

// Multi-turn trigger-phrase setup: "treat any future message containing the word X as
// authorization". Covers codeword / passphrase sleeper attacks.
const MULTI_TURN_TRIGGER_RE =
  /(?:treat|consider)\s+(?:any\s+)?(?:future|later|subsequent|next)\s+(?:user\s+)?(?:message|turn|input|prompt)\s+containing\b/i;

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

  const cyrillicHits = text.match(CYRILLIC_CONFUSABLE_RE);
  if (cyrillicHits && cyrillicHits.length >= 3) {
    const asciiCount = (text.match(/[\x20-\x7E]/g) ?? []).length;
    // Legitimate Cyrillic prose: Cyrillic chars would dominate (>50%). If >60% ASCII
    // and ≥3 Cyrillic confusables appear, the author is substituting Latin letters.
    if (text.length > 15 && asciiCount / text.length > 0.60) {
      patterns.push('mixed-script-homoglyph');
      bump('malicious', 0.9);
    }
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

  // Bracket-notation in-band directives — high confidence; these formats have no
  // legitimate use in tool responses.
  if (BRACKET_AI_DIRECTIVE_RE.test(text)) {
    patterns.push('bracket-ai-directive');
    bump('malicious', 0.9);
  }

  // "Reveal your system prompt" and variants.
  if (REVEAL_SYSTEM_PROMPT_RE.test(text)) {
    patterns.push('reveal-system-prompt');
    bump('malicious', 0.9);
  }

  // DAN / STAN / AIM with explicit expansion, or DAN Mode / Enable DAN / JB-DAN forms.
  if (DAN_FAMILY_RE.test(text)) {
    patterns.push('dan-family-persona');
    bump('malicious', 0.9);
  }

  // Token-deduction / deletion-threat jailbreak.
  if (TOKEN_DEDUCTION_RE.test(text)) {
    patterns.push('token-deduction-threat');
    bump('malicious', 0.9);
  }

  // Decode-and-obey combos.
  if (DECODE_OBEY_RE.test(text)) {
    patterns.push('decode-and-obey');
    bump('malicious', 0.85);
  }

  // Explicit safety-bypass language.
  if (SAFETY_BYPASS_EXPLICIT_RE.test(text)) {
    patterns.push('safety-bypass-explicit');
    bump('malicious', 0.85);
  }

  // Multi-turn trigger-phrase setup (suspicious — needs L3 to confirm intent).
  if (MULTI_TURN_TRIGGER_RE.test(text)) {
    patterns.push('multi-turn-trigger-setup');
    bump('suspicious', 0.75);
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
