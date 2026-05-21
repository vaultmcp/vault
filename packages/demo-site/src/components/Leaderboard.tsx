import { readLeaderboard, readScore, defaultNetwork } from '@/lib/chain';

function scoreColor(score: number): string {
  if (score >= 900) return 'text-accent';
  if (score >= 700) return 'text-ink';
  if (score >= 500) return 'text-warn';
  return 'text-bad';
}

export async function Leaderboard() {
  const network = defaultNetwork();
  let rows: { url: string; score: number; totalScans: number; totalBlocks: number }[] = [];
  let error = false;

  try {
    const leaderboard = await readLeaderboard(10, network);
    if (leaderboard.length > 0) {
      const scores = await Promise.all(leaderboard.map(({ url }) => readScore(url, network)));
      rows = scores.map((s) => ({
        url: s.server,
        score: s.score,
        totalScans: s.totalScans,
        totalBlocks: s.totalBlocks,
      }));
    }
  } catch {
    error = true;
  }

  return (
    <section className="border-b border-line">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs uppercase tracking-widish text-dim">mcp server reputation</h2>
          <span className="text-xs text-dim">scored by 30-day block rate · on-chain via base/eas</span>
        </div>
        <div className="mt-6 overflow-hidden rounded-md border border-line">
          <table className="w-full font-mono text-sm">
            <thead className="bg-panel text-xs text-dim">
              <tr>
                <th className="px-4 py-2 text-left">server</th>
                <th className="px-4 py-2 text-right">score</th>
                <th className="px-4 py-2 text-right">scans (30d)</th>
                <th className="px-4 py-2 text-right">blocks (30d)</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-dim text-xs">
                    {error
                      ? 'chain read failed — check back soon'
                      : 'no servers tracked yet · install the proxy to appear here'}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.url} className="border-t border-line">
                    <td className="px-4 py-3 break-all">{r.url}</td>
                    <td className={`px-4 py-3 text-right font-bold ${scoreColor(r.score)}`}>{r.score}</td>
                    <td className="px-4 py-3 text-right text-dim">{r.totalScans.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-dim">{r.totalBlocks.toLocaleString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-dim">
          Live · {network} · updates every 60s
        </p>
      </div>
    </section>
  );
}
