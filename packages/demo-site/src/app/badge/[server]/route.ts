/// GET /badge/:server.svg — shields.io-style on-chain reputation badge.
///
/// Returns a tiny SVG for embedding in MCP server READMEs. The :server param may include
/// a trailing ".svg" extension which is stripped. Servers with 0 attestations render
/// gracefully as "unranked" in neutral grey.

import { readScore, parseNetwork } from '@/lib/chain';
import { renderBadgeSVG } from '@/lib/badge';

export const runtime = 'nodejs';
export const revalidate = 300;

function stripExt(s: string): string {
  return s.endsWith('.svg') ? s.slice(0, -4) : s;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ server: string }> },
): Promise<Response> {
  const { server: raw } = await params;
  const decoded = decodeURIComponent(stripExt(raw));
  const url = new URL(req.url);
  const network = parseNetwork(url.searchParams.get('network'));

  let score: number | null = null;
  let totalScans = 0;
  try {
    const r = await readScore(decoded, network);
    score = r.score;
    totalScans = r.totalScans;
  } catch {
    // Treat any read failure as "unranked" rather than erroring — a badge that fails
    // to render breaks every README it's embedded in. Better to show "unranked".
  }

  const svg = renderBadgeSVG({ score, totalScans });
  return new Response(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
