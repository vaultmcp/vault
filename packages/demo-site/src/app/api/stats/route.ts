/// GET /api/stats — aggregate counters for the hero counter strip.
/// Sums totalScans + totalBlocks across the top 50 tracked servers.

import { NextResponse } from 'next/server';
import { readAggregateStats, parseNetwork, explorerUrl } from '@/lib/chain';

export const runtime = 'nodejs';
export const revalidate = 10;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30',
};

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const network = parseNetwork(url.searchParams.get('network'));
  try {
    const stats = await readAggregateStats(network);
    return NextResponse.json(
      {
        ...stats,
        explorer: stats.contractAddress
          ? `${explorerUrl(network)}/address/${stats.contractAddress}`
          : null,
        lastUpdated: new Date().toISOString(),
      },
      { headers: CORS },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'aggregate stats failed', network },
      { status: 502, headers: CORS },
    );
  }
}
