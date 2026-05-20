/// GET /api/threats/recent?n=20&network=base — recent ThreatRecord attestations.

import { NextResponse } from 'next/server';
import { readRecentThreats, parseNetwork } from '@/lib/chain';

export const runtime = 'nodejs';
export const revalidate = 30;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
};

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const n = Number.parseInt(url.searchParams.get('n') ?? '20', 10);
  const network = parseNetwork(url.searchParams.get('network'));
  try {
    const events = await readRecentThreats(Number.isFinite(n) ? n : 20, network);
    return NextResponse.json(
      { network, threats: events, lastUpdated: new Date().toISOString() },
      { headers: CORS },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'event log read failed', network },
      { status: 502, headers: CORS },
    );
  }
}
