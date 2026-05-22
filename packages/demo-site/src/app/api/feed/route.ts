/// Server-side proxy to the collector's /feed endpoint. Resolves three problems the browser
/// hit when fetching the collector directly:
///   1. mixed-content blocking (https://vaultmcp.io → http://collector)
///   2. CORS Allow-Origin mismatch on the nginx in front of the collector
///   3. exposing the collector hostname to client bundles
///
/// The Next.js node runtime fetches the upstream server-to-server, which is not subject to
/// the browser's mixed-content policy. On upstream failure we return 200 with `events: []`
/// so the ThreatFeed component renders its empty state cleanly instead of throwing.

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COLLECTOR = process.env.COLLECTOR_URL ?? 'http://98.80.190.10';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const search = req.nextUrl.search;
  try {
    const resp = await fetch(`${COLLECTOR}/feed${search}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) {
      return NextResponse.json(
        { events: [], upstreamStatus: resp.status },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const body = await resp.json();
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return NextResponse.json(
      { events: [], upstreamError: err instanceof Error ? err.message : String(err) },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
