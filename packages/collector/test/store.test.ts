import { describe, it, expect } from 'vitest';
import { createInMemoryStore, type IngestedEvent } from '../src/store.js';

function makeEvent(overrides: Partial<IngestedEvent> = {}): IngestedEvent {
  return {
    id: overrides.id ?? `e-${Math.random()}`,
    ts: overrides.ts ?? Date.now(),
    installId: overrides.installId ?? 'install-1',
    type: overrides.type ?? 'detection',
    ...overrides,
  } as IngestedEvent;
}

describe('createInMemoryStore', () => {
  it('ingests and returns events', () => {
    const s = createInMemoryStore({ capacity: 100 });
    const n = s.ingest([makeEvent(), makeEvent()]);
    expect(n).toBe(2);
    expect(s.size()).toBe(2);
  });

  it('rejects malformed events without throwing', () => {
    const s = createInMemoryStore({ capacity: 100 });
    const n = s.ingest([
      makeEvent(),
      { id: 'bad', ts: 'not a number' } as unknown as IngestedEvent,
      { id: '', ts: 0, installId: 'x', type: 'detection' } as IngestedEvent, // empty id
      makeEvent({ type: 'manifest' }),
    ]);
    expect(n).toBe(2);
    expect(s.size()).toBe(2);
  });

  it('respects capacity (ring buffer)', () => {
    const s = createInMemoryStore({ capacity: 20 });
    const evs: IngestedEvent[] = [];
    for (let i = 0; i < 100; i++) evs.push(makeEvent({ id: `e${i}`, ts: i }));
    s.ingest(evs);
    expect(s.size()).toBe(20);
    const recent = s.recent({ limit: 5 });
    expect(recent[0]!.id).toBe('e99');
  });

  it('recent() returns newest first', () => {
    const s = createInMemoryStore({ capacity: 100 });
    s.ingest([
      makeEvent({ id: 'a', ts: 1 }),
      makeEvent({ id: 'b', ts: 2 }),
      makeEvent({ id: 'c', ts: 3 }),
    ]);
    const r = s.recent({ limit: 10 });
    expect(r.map((e) => e.id)).toEqual(['c', 'b', 'a']);
  });

  it('recent() filters by type', () => {
    const s = createInMemoryStore({ capacity: 100 });
    s.ingest([
      makeEvent({ id: 'd1', type: 'detection' }),
      makeEvent({ id: 'c1', type: 'capability' }),
      makeEvent({ id: 'd2', type: 'detection' }),
      makeEvent({ id: 'm1', type: 'manifest' }),
    ]);
    const r = s.recent({ type: 'detection', limit: 10 });
    expect(r.every((e) => e.type === 'detection')).toBe(true);
    expect(r).toHaveLength(2);
  });

  it('recent() filters by verdict', () => {
    const s = createInMemoryStore({ capacity: 100 });
    s.ingest([
      makeEvent({ id: 'a', verdict: 'clean' } as IngestedEvent),
      makeEvent({ id: 'b', verdict: 'malicious' } as IngestedEvent),
      makeEvent({ id: 'c', verdict: 'malicious' } as IngestedEvent),
    ]);
    const r = s.recent({ verdict: 'malicious', limit: 10 });
    expect(r.map((e) => e.id)).toEqual(['c', 'b']);
  });

  it('stats() aggregates by type and verdict', () => {
    const s = createInMemoryStore({ capacity: 100 });
    s.ingest([
      makeEvent({ type: 'detection', verdict: 'clean' } as IngestedEvent),
      makeEvent({ type: 'detection', verdict: 'malicious' } as IngestedEvent),
      makeEvent({ type: 'detection', verdict: 'malicious' } as IngestedEvent),
      makeEvent({ type: 'capability' }),
      makeEvent({ type: 'manifest' }),
    ]);
    const st = s.stats();
    expect(st.total).toBe(5);
    expect(st.byType).toEqual({ detection: 3, capability: 1, manifest: 1 });
    expect(st.byVerdict.clean).toBe(1);
    expect(st.byVerdict.malicious).toBe(2);
  });

  it('stats() lastHourCount only counts recent events', () => {
    const s = createInMemoryStore({ capacity: 100 });
    const now = Date.now();
    s.ingest([
      makeEvent({ ts: now }),
      makeEvent({ ts: now - 30 * 60 * 1000 }),
      makeEvent({ ts: now - 2 * 60 * 60 * 1000 }), // 2h ago
    ]);
    expect(s.stats().lastHourCount).toBe(2);
  });
});
