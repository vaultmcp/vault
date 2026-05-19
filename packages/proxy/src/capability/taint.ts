/// Taint store — tracks the recent N tool responses so the capability gate can detect
/// when an agent's next tool call carries data lineage from an untrusted source.

export interface TaintEntry {
  toolName: string;
  content: string;
  addedAt: number;
}

export class TaintStore {
  private entries: TaintEntry[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries = 10) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  add(entry: TaintEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
  }

  size(): number {
    return this.entries.length;
  }

  clear(): void {
    this.entries.length = 0;
  }

  /// Returns every taint entry whose content shares a contiguous substring of at least
  /// `minOverlap` characters with `text` (case-insensitive, whitespace-collapsed).
  matches(text: string, minOverlap: number): TaintEntry[] {
    if (this.entries.length === 0 || !text || minOverlap <= 0) return [];
    const haystack = normalize(text);
    if (haystack.length < minOverlap) return [];

    const hits: TaintEntry[] = [];
    for (const entry of this.entries) {
      const needle = normalize(entry.content);
      if (needle.length < minOverlap) continue;
      if (hasSubstringOverlap(haystack, needle, minOverlap)) hits.push(entry);
    }
    return hits;
  }
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/// True if any contiguous substring of `needle` with length >= `minLen` also appears in `haystack`.
/// We slide a minLen-length window across needle; if any window is contained in haystack, return true.
/// (A longer match would imply all its minLen-length subwindows match too, so this is sufficient.)
function hasSubstringOverlap(haystack: string, needle: string, minLen: number): boolean {
  if (needle.length < minLen) return false;
  const last = needle.length - minLen;
  for (let i = 0; i <= last; i++) {
    const window = needle.slice(i, i + minLen);
    if (haystack.includes(window)) return true;
  }
  return false;
}
