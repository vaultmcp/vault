/// GET /api/leaderboard?n=10&network=base — top N MCP servers by scan count.

import { NextResponse } from 'next/server';
import { readLeaderboard, parseNetwork, defaultNetwork } from '@/lib/chain';

export const runtime = 'nodejs';
export const revalidate = 60;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
};

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const n = Number.parseInt(url.searchParams.get('n') ?? '10', 10);
  const network = parseNetwork(url.searchParams.get('network'));
  try {
    const entries = await readLeaderboard(Number.isFinite(n) ? n : 10, network);
    return NextResponse.json(
      { network, leaderboard: entries, lastUpdated: new Date().toISOString() },
      { headers: CORS },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'on-chain read failed', network: network ?? defaultNetwork() },
      { status: 502, headers: CORS },
    );
  }
}
