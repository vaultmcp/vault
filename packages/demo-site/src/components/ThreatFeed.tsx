'use client';

import { useEffect, useState } from 'react';

interface FeedEvent {
  id: string;
  ts: number;
  type: 'detection' | 'capability' | 'manifest';
  verdict?: 'clean' | 'suspicious' | 'malicious';
  toolName?: string;
  layer?: number;
  patterns?: string[];
  action?: 'block' | 'warn';
  status?: 'first-seen' | 'unchanged' | 'drift';
  contentHash?: string;
}

function timeAgo(ts: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function rowAccent(e: FeedEvent): string {
  if (e.type === 'manifest' && e.status === 'drift') return 'text-warn';
  if (e.verdict === 'malicious') return 'text-bad';
  if (e.verdict === 'suspicious') return 'text-warn';
  if (e.action === 'block') return 'text-bad';
  return 'text-dim';
}

function label(e: FeedEvent): string {
  if (e.type === 'detection') return e.verdict?.toUpperCase() ?? 'DETECTION';
  if (e.type === 'capability') return `CAP-${(e.action ?? '?').toUpperCase()}`;
  if (e.type === 'manifest') return `MANIFEST-${(e.status ?? '?').toUpperCase()}`;
  return 'EVENT';
}

function detail(e: FeedEvent): string {
  if (e.type === 'detection') {
    const layer = e.layer ? `L${e.layer}` : 'L?';
    const tool = e.toolName ?? 'unknown';
    const pats = e.patterns && e.patterns.length > 0 ? ` · ${e.patterns.slice(0, 2).join(', ')}` : '';
    return `${layer} · ${tool}${pats}`;
  }
  if (e.type === 'capability') return `tool=${e.toolName ?? 'unknown'}`;
  if (e.type === 'manifest') return e.status === 'drift' ? 'tool manifest changed' : 'manifest unchanged';
  return '';
}

export function ThreatFeed({ collectorUrl }: { collectorUrl: string }) {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number>(Date.now());

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const resp = await fetch(`${collectorUrl}/feed?limit=20`, { cache: 'no-store' });
        if (!resp.ok) throw new Error(`http ${resp.status}`);
        const body = await resp.json();
        if (!cancelled) {
          setEvents(body.events ?? []);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }
    tick();
    const i = setInterval(tick, 5000);
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      clearInterval(i);
      clearInterval(t);
    };
  }, [collectorUrl]);

  return (
    <section className="border-b border-line">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs uppercase tracking-widish text-dim">recent attacks blocked</h2>
          <span className="text-xs text-dim">
            {error ? <span className="text-bad">collector offline ({error})</span> : `${events.length} events`}
          </span>
        </div>
        <div className="mt-6 overflow-hidden rounded-md border border-line">
          <table className="w-full font-mono text-xs">
            <thead className="bg-panel text-dim">
              <tr>
                <th className="px-4 py-2 text-left">time</th>
                <th className="px-4 py-2 text-left">verdict</th>
                <th className="px-4 py-2 text-left">detail</th>
                <th className="px-4 py-2 text-left">content (sha256)</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 && !error && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-dim">
                    waiting for events…
                  </td>
                </tr>
              )}
              {events.map((e) => (
                <tr key={e.id} className="border-t border-line">
                  <td className="px-4 py-2 text-dim">{timeAgo(e.ts, now)}</td>
                  <td className={`px-4 py-2 ${rowAccent(e)}`}>{label(e)}</td>
                  <td className="px-4 py-2">{detail(e)}</td>
                  <td className="px-4 py-2 text-dim">
                    {e.contentHash ? <code>{e.contentHash.slice(0, 12)}…</code> : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
