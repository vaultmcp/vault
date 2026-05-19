/// Event store. In-memory ring buffer for Sprint 1; swap for SQLite when we outgrow it.
/// Liberal schema — accepts whatever the proxy sends, indexes by `type` and `verdict`.

export interface IngestedEvent {
  id: string;
  ts: number;
  installId: string;
  type: 'detection' | 'capability' | 'manifest';
  [k: string]: unknown;
}

export interface FeedFilter {
  type?: 'detection' | 'capability' | 'manifest';
  verdict?: 'clean' | 'suspicious' | 'malicious';
  limit?: number;
}

export interface Stats {
  total: number;
  byType: Record<string, number>;
  byVerdict: Record<string, number>;
  lastHourCount: number;
  oldestTs: number | null;
  newestTs: number | null;
}

export interface Store {
  ingest(events: IngestedEvent[]): number;
  recent(filter: FeedFilter): IngestedEvent[];
  stats(): Stats;
  size(): number;
}

export interface InMemoryStoreOptions {
  capacity: number;
}

export function createInMemoryStore(opts: InMemoryStoreOptions): Store {
  const cap = Math.max(16, opts.capacity);
  const buf: IngestedEvent[] = [];

  function isValid(e: unknown): e is IngestedEvent {
    if (!e || typeof e !== 'object') return false;
    const o = e as Record<string, unknown>;
    if (typeof o.id !== 'string' || o.id.length === 0) return false;
    if (typeof o.ts !== 'number' || !Number.isFinite(o.ts)) return false;
    if (typeof o.installId !== 'string') return false;
    if (o.type !== 'detection' && o.type !== 'capability' && o.type !== 'manifest') return false;
    return true;
  }

  return {
    ingest(events: IngestedEvent[]): number {
      let accepted = 0;
      for (const e of events) {
        if (!isValid(e)) continue;
        buf.push(e);
        accepted++;
      }
      if (buf.length > cap) buf.splice(0, buf.length - cap);
      return accepted;
    },

    recent(filter: FeedFilter): IngestedEvent[] {
      const limit = filter.limit && filter.limit > 0 ? filter.limit : 20;
      // Iterate newest → oldest, skipping non-matching, until limit met.
      const out: IngestedEvent[] = [];
      for (let i = buf.length - 1; i >= 0 && out.length < limit; i--) {
        const e = buf[i]!;
        if (filter.type && e.type !== filter.type) continue;
        if (filter.verdict) {
          if ((e.verdict as unknown) !== filter.verdict) continue;
        }
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
      return { total: buf.length, byType, byVerdict, lastHourCount: lastHour, oldestTs: oldest, newestTs: newest };
    },

    size(): number {
      return buf.length;
    },
  };
}
