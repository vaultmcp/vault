/// Disk-backed event store using an NDJSON append log.
/// In-memory buffer serves reads; the log file provides persistence across restarts.
/// On ingest: append to file (O(1)) and push to buffer.
/// Capacity rewrite: when buffer exceeds cap, rewrite log with newest cap rows.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Store, IngestedEvent, FeedFilter, Stats } from './store.js';

export interface DiskStoreOptions {
  path: string;
  capacity: number;
}

export function createDiskStore(opts: DiskStoreOptions): Store {
  const dir = dirname(opts.path);
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });

  const cap = Math.max(16, opts.capacity);

  function isValid(e: unknown): e is IngestedEvent {
    if (!e || typeof e !== 'object') return false;
    const o = e as Record<string, unknown>;
    if (typeof o.id !== 'string' || o.id.length === 0) return false;
    if (typeof o.ts !== 'number' || !Number.isFinite(o.ts)) return false;
    if (typeof o.installId !== 'string') return false;
    if (o.type !== 'detection' && o.type !== 'capability' && o.type !== 'manifest') return false;
    return true;
  }

  // Load existing events from log, keeping only last `cap` valid lines.
  const buf: IngestedEvent[] = [];
  if (existsSync(opts.path)) {
    const lines = readFileSync(opts.path, 'utf8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const e: unknown = JSON.parse(line);
        if (isValid(e)) buf.push(e);
      } catch {
        // skip corrupt lines
      }
    }
    if (buf.length > cap) buf.splice(0, buf.length - cap);
  }

  function rewriteLog(): void {
    writeFileSync(opts.path, buf.map((e) => JSON.stringify(e)).join('\n') + (buf.length > 0 ? '\n' : ''));
  }

  return {
    ingest(events: IngestedEvent[]): number {
      let accepted = 0;
      const lines: string[] = [];
      for (const e of events) {
        if (!isValid(e)) continue;
        buf.push(e);
        lines.push(JSON.stringify(e));
        accepted++;
      }
      if (lines.length > 0) appendFileSync(opts.path, lines.join('\n') + '\n');
      if (buf.length > cap) {
        buf.splice(0, buf.length - cap);
        rewriteLog();
      }
      return accepted;
    },

    recent(filter: FeedFilter): IngestedEvent[] {
      const limit = filter.limit && filter.limit > 0 ? filter.limit : 20;
      const out: IngestedEvent[] = [];
      for (let i = buf.length - 1; i >= 0 && out.length < limit; i--) {
        const e = buf[i]!;
        if (filter.type && e.type !== filter.type) continue;
        if (filter.verdict && (e.verdict as unknown) !== filter.verdict) continue;
        out.push(e);
      }
      return out;
    },

    stats(): Stats {
      const byType: Record<string, number> = { detection: 0, capability: 0, manifest: 0 };
      const byVerdict: Record<string, number> = { clean: 0, suspicious: 0, malicious: 0 };
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      let lastHour = 0;
      let oldest: number | null = null;
      let newest: number | null = null;
      for (const e of buf) {
        byType[e.type] = (byType[e.type] ?? 0) + 1;
        const v = e.verdict;
        if (typeof v === 'string' && v in byVerdict) byVerdict[v]!++;
        if (e.ts >= oneHourAgo) lastHour++;
        if (oldest === null || e.ts < oldest) oldest = e.ts;
        if (newest === null || e.ts > newest) newest = e.ts;
      }
      return {
        total: buf.length,
        byType,
        byVerdict,
        lastHourCount: lastHour,
        oldestTs: oldest,
        newestTs: newest,
      };
    },

    size(): number {
      return buf.length;
    },
  };
}
