/// GET /api/score/:server — on-chain reputation score for a single MCP server.
///
/// CORS-open. Cached 60s at the edge.

import { NextResponse } from 'next/server';
import { readScore, parseNetwork } from '@/lib/chain';

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

export async function GET(
  req: Request,
  { params }: { params: Promise<{ server: string }> },
): Promise<Response> {
  const { server } = await params;
  const url = new URL(req.url);
  const network = parseNetwork(url.searchParams.get('network'));

  try {
    const decoded = decodeURIComponent(server);
    const result = await readScore(decoded, network);
    return NextResponse.json(
      {
        server: result.server,
        network: result.network,
        score: result.score,
        totalScans: result.totalScans,
        totalBlocks: result.totalBlocks,
        last30dScans: result.totalScans, // contract's score already uses 30d rolling window
        last30dBlocks: result.totalBlocks,
        blockRate: result.totalScans === 0 ? 0 : result.totalBlocks / result.totalScans,
        basescanUrl: result.basescanUrl,
        contractAddress: result.contractAddress,
        lastUpdated: new Date().toISOString(),
      },
      { headers: CORS },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'on-chain read failed' },
      { status: 502, headers: CORS },
    );
  }
}
