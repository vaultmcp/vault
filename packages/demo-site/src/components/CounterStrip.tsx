'use client';

/// Live counter strip at the top of the homepage. Polls /api/stats every 10s.
/// Numbers count up via a small requestAnimationFrame-driven tween — no animation lib.
/// On first paint, numbers fade in from blank rather than jumping 0 → real.

import { useEffect, useRef, useState } from 'react';

interface StatsResponse {
  scansCompleted: number;
  attacksBlocked: number;
  serversTracked: number;
  network?: string;
  contractAddress?: string;
  explorer?: string | null;
  error?: string;
}

const POLL_MS = 10_000;
const TWEEN_MS = 800;

function useCountUp(target: number, ready: boolean): number {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  const startRef = useRef(0);
  const rafRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!ready) return;
    if (display === target) return;
    fromRef.current = display;
    startRef.current = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - startRef.current) / TWEEN_MS);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      const v = Math.round(fromRef.current + (target - fromRef.current) * eased);
      setDisplay(v);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, ready]);

  return display;
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

export function CounterStrip() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchStats() {
      try {
        const r = await fetch('/api/stats', { cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as StatsResponse;
        if (cancelled) return;
        setStats(data);
        setError(null);
        setReady(true);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'fetch failed');
        // Still mark ready so the strip stops looking permanently empty if the API is down
        setReady(true);
      }
    }
    fetchStats();
    const id = setInterval(fetchStats, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const scans = useCountUp(stats?.scansCompleted ?? 0, ready);
  const blocks = useCountUp(stats?.attacksBlocked ?? 0, ready);
  const servers = useCountUp(stats?.serversTracked ?? 0, ready);

  return (
    <section className="border-b border-line">
      <div
        className={`mx-auto max-w-6xl px-6 py-10 transition-opacity duration-700 ${ready ? 'opacity-100' : 'opacity-0'}`}
        aria-live="polite"
      >
        <div className="grid grid-cols-3 divide-x divide-line">
          <Cell label="scans completed" value={scans} />
          <Cell label="attacks blocked" value={blocks} />
          <Cell label="servers tracked" value={servers} />
        </div>
        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-dim">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent opacity-70" />
          {stats?.explorer ? (
            <a
              href={stats.explorer}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-accent transition-colors"
            >
              live attestations on Base Sepolia ↗
            </a>
          ) : (
            <span>attestations on Base · EAS</span>
          )}
          {error && <span className="text-bad ml-2">· (chain data unavailable)</span>}
        </div>
      </div>
    </section>
  );
}

function Cell({ label, value }: { label: string; value: number }) {
  return (
    <div className="px-8 py-2 text-center first:pl-0 last:pr-0">
      <div className="font-mono text-4xl font-bold tabular-nums text-accent md:text-5xl glow-accent-sm">
        {formatNumber(value)}
      </div>
      <div className="mt-2 text-xs uppercase tracking-widish text-dim">{label}</div>
    </div>
  );
}
