'use client';

import { useEffect, useState } from 'react';

interface ToolRow {
  toolName: string;
  total: number;
  blocked: number;
  cleared: number;
  score: number; // 0..1000
}
interface LedgerData {
  contract: string;
  totalGuarded: number;
  totalBlocked: number;
  tools: ToolRow[];
  explorer: string;
  lastUpdated: string;
}

function scoreColor(score: number): string {
  if (score >= 900) return 'text-accent';
  if (score >= 500) return 'text-warn';
  return 'text-bad';
}

export function RobinhoodBoard() {
  const [data, setData] = useState<LedgerData | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/rh-ledger')
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setData(d && d.contract ? (d as LedgerData) : null);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section id="robinhood" className="scroll-mt-16 border-b border-line">
      <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
        <h2 className="text-xs uppercase tracking-widish text-dim">guarded on robinhood chain</h2>
        <p className="mt-4 max-w-3xl text-2xl font-bold text-ink md:text-3xl">
          Every trade the guard clears or blocks leaves a{' '}
          <span className="text-accent glow-accent">public receipt on-chain.</span>
        </p>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-dim">
          Not a log we control. A signed record on Robinhood Chain that anyone can read. Each guarded
          trade builds a per-tool safety score, so &quot;my agent is guarded&quot; becomes something you
          can verify instead of trust.
        </p>

        {/* Headline counters */}
        <div className="mt-10 grid grid-cols-2 gap-px border border-line bg-line sm:max-w-md">
          <div className="bg-bg p-6">
            <div className="font-mono text-3xl font-bold text-ink">{data ? data.totalGuarded : '—'}</div>
            <div className="mt-1 text-xs uppercase tracking-widish text-dim">trades guarded</div>
          </div>
          <div className="bg-bg p-6">
            <div className="font-mono text-3xl font-bold text-bad">{data ? data.totalBlocked : '—'}</div>
            <div className="mt-1 text-xs uppercase tracking-widish text-dim">blocked</div>
          </div>
        </div>

        {/* Per-tool board */}
        <div className="mt-10 rounded-md border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-4 py-2">
            <span className="text-xs uppercase tracking-widish text-dim">per-tool safety record</span>
            {data && (
              <a
                href={data.explorer}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-accent transition-colors hover:opacity-80"
              >
                verify on-chain →
              </a>
            )}
          </div>
          <div className="px-4 py-3 font-mono text-sm">
            {!loaded ? (
              <div className="py-6 text-center text-xs text-dim">reading Robinhood Chain…</div>
            ) : !data || data.tools.length === 0 ? (
              <div className="py-6 text-center text-xs text-dim">no guarded trades recorded yet</div>
            ) : (
              <ul className="divide-y divide-line">
                {data.tools.map((t) => (
                  <li key={t.toolName} className="flex items-center justify-between gap-3 py-2">
                    <span className="truncate text-ink">{t.toolName}</span>
                    <span className="flex shrink-0 items-center gap-4 text-xs">
                      <span className="text-dim">{t.total} guarded</span>
                      <span className="text-bad">{t.blocked} blocked</span>
                      <span className={`${scoreColor(t.score)} font-bold`}>{t.score}/1000</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
