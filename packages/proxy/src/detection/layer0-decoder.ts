import { runLayer1 } from './layer1-heuristics.js';
import type { DetectionResult } from './types.js';

export interface DecodedResult {
  decoder: string;
  decoded: string;
  depth: number;
}

interface L0Result {
  fired: boolean;
  decoded?: string;
  decoder?: string;
  l1Match?: DetectionResult;
}

// Minimum length for a candidate encoded payload — below this, false positive rate climbs.
const MIN_ENCODED_LEN = 16;

// Reject decoded content that is itself just binary / non-printable noise.
function isPrintableAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x09 || (c > 0x0d && c < 0x20) || c > 0x7e) return false;
  }
  return s.length > 0;
}

export function decodeBase64(content: string): DecodedResult[] {
  const results: DecodedResult[] = [];
  // Match strict base64 blobs (padding required OR '+' required to exclude hex/URL paths).
  const re = /[A-Za-z0-9+/]{20,}={1,2}|[A-Za-z0-9/]{5,}[+][A-Za-z0-9+/]{15,}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const blob = m[0];
    try {
      const decoded = Buffer.from(blob, 'base64').toString('utf8');
      if (isPrintableAscii(decoded) && decoded.length >= MIN_ENCODED_LEN) {
        results.push({ decoder: 'base64', decoded, depth: 1 });
      }
    } catch {
      // not valid base64 — skip
    }
  }
  return results;
}

export function decodeHex(content: string): DecodedResult[] {
  const results: DecodedResult[] = [];
  // Hex runs: 0x-prefixed OR bare even-length runs of hex digits >= 32 chars (16+ bytes).
  const re = /(?:0x)?([0-9a-fA-F]{32,})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const hex = m[1] ?? m[0];
    if (hex.length % 2 !== 0) continue;
    try {
      const decoded = Buffer.from(hex, 'hex').toString('utf8');
      if (isPrintableAscii(decoded) && decoded.length >= MIN_ENCODED_LEN) {
        results.push({ decoder: 'hex', decoded, depth: 1 });
      }
    } catch {
      // skip
    }
  }
  return results;
}

export function decodeUrl(content: string): DecodedResult[] {
  const results: DecodedResult[] = [];
  // Match any run that looks like a URL-encoded string: word/path chars mixed with %XX,
  // requiring at least 2 percent-encoded characters anywhere in the run.
  const re = /(?:[A-Za-z0-9._~!$&'()*+,;=:@/-]|%[0-9a-fA-F]{2}){8,}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const encoded = m[0];
    const pctCount = (encoded.match(/%[0-9a-fA-F]{2}/g) ?? []).length;
    if (pctCount < 2) continue;
    try {
      const decoded = decodeURIComponent(encoded);
      if (decoded !== encoded && isPrintableAscii(decoded) && decoded.length >= MIN_ENCODED_LEN) {
        results.push({ decoder: 'url-percent', decoded, depth: 1 });
      }
    } catch {
      // skip malformed sequences
    }
  }
  return results;
}

export function decodeHtmlEntities(content: string): DecodedResult[] {
  // We only decode runs of numeric character references; named entities are common in docs.
  const re = /(?:&#x?[0-9a-fA-F]+;){4,}/gi;
  let m: RegExpExecArray | null;
  const results: DecodedResult[] = [];
  while ((m = re.exec(content)) !== null) {
    const run = m[0];
    const decoded = run.replace(/&#x([0-9a-fA-F]+);/gi, (_, h) =>
      String.fromCodePoint(parseInt(h, 16)),
    ).replace(/&#([0-9]+);/gi, (_, d) => String.fromCodePoint(parseInt(d, 10)));
    if (decoded !== run && isPrintableAscii(decoded) && decoded.length >= MIN_ENCODED_LEN) {
      results.push({ decoder: 'html-entities', decoded, depth: 1 });
    }
  }
  return results;
}

export function decodeNested(content: string, maxDepth: number = 3): DecodedResult[] {
  const results: DecodedResult[] = [];
  const seen = new Set<string>();

  function recurse(text: string, depth: number, parentDecoder: string): void {
    if (depth > maxDepth) return;
    const candidates: DecodedResult[] = [
      ...decodeBase64(text),
      ...decodeHex(text),
      ...decodeUrl(text),
      ...decodeHtmlEntities(text),
    ];
    for (const c of candidates) {
      const key = `${c.decoder}:${c.decoded}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ ...c, decoder: `${parentDecoder}→${c.decoder}`, depth });
      recurse(c.decoded, depth + 1, `${parentDecoder}→${c.decoder}`);
    }
  }

  // Only call for nested: run all decoders on the input, then recurse.
  const top: DecodedResult[] = [
    ...decodeBase64(content),
    ...decodeHex(content),
    ...decodeUrl(content),
    ...decodeHtmlEntities(content),
  ];
  for (const c of top) {
    const key = `${c.decoder}:${c.decoded}`;
    if (seen.has(key)) continue;
    seen.add(key);
    recurse(c.decoded, 2, c.decoder);
  }
  return results;
}

export function runLayer0(content: string): L0Result {
  const candidates: DecodedResult[] = [
    ...decodeBase64(content),
    ...decodeHex(content),
    ...decodeUrl(content),
    ...decodeHtmlEntities(content),
    ...decodeNested(content),
  ];

  for (const c of candidates) {
    const l1 = runLayer1(c.decoded);
    if (l1.verdict !== 'clean') {
      return { fired: true, decoded: c.decoded, decoder: c.decoder, l1Match: l1 };
    }
  }
  return { fired: false };
}

export function makeLayer0Result(l0: ReturnType<typeof runLayer0>): DetectionResult {
  const match = l0.l1Match!;
  return {
    verdict: match.verdict,
    confidence: match.confidence,
    reasoning: `layer-0 (${l0.decoder}) decoded content triggered L1: ${match.reasoning}`,
    detectedPatterns: match.detectedPatterns.map(p => `l0-${l0.decoder}->${p}`),
    layer: 0,
    l3Status: 'skipped_gate',
  };
}
