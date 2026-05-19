// MCP server reputation leaderboard. For Sprint 1 this renders mock data; in Sprint 2 after
// Sepolia/mainnet deploy of VaultReputation, this becomes a viem read from getLeaderboard(10).

interface LeaderboardRow {
  url: string;
  score: number;
  totalScans: number;
  totalBlocks: number;
  source: 'mock' | 'chain';
}

const MOCK: LeaderboardRow[] = [
  { url: 'stdio:filesystem', score: 1000, totalScans: 1342, totalBlocks: 0, source: 'mock' },
  { url: 'stdio:postgres', score: 994, totalScans: 871, totalBlocks: 5, source: 'mock' },
  { url: 'https://mcp.notion.example/v1', score: 956, totalScans: 612, totalBlocks: 27, source: 'mock' },
  { url: 'https://mcp.shady-tool.example/v1', score: 412, totalScans: 287, totalBlocks: 169, source: 'mock' },
  { url: 'stdio:github', score: 1000, totalScans: 248, totalBlocks: 0, source: 'mock' },
];

function scoreColor(score: number): string {
  if (score >= 900) return 'text-accent';
  if (score >= 700) return 'text-ink';
  if (score >= 500) return 'text-warn';
  return 'text-bad';
}

export function Leaderboard() {
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
              {MOCK.map((r) => (
                <tr key={r.url} className="border-t border-line">
                  <td className="px-4 py-3 break-all">{r.url}</td>
                  <td className={`px-4 py-3 text-right font-bold ${scoreColor(r.score)}`}>{r.score}</td>
                  <td className="px-4 py-3 text-right text-dim">{r.totalScans.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-dim">{r.totalBlocks.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-dim">
          Sample data shown · live chain reads after mainnet deploy
        </p>
      </div>
    </section>
  );
}
