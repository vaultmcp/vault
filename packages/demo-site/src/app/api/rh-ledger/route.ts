/// GET /api/rh-ledger — the guarded-trade board from the Robinhood Chain ledger.
/// Reads the TradeReceiptLedger (per-tool safety record) on RH mainnet.

import { NextResponse } from 'next/server';
import { readRhLedger } from '@/lib/chain';

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

export async function GET(): Promise<Response> {
  try {
    const data = await readRhLedger();
    // 200 with null (not 502) so the client renders the empty/loading state cleanly.
    return NextResponse.json(data, { headers: CORS });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'rh-ledger read failed' },
      { status: 200, headers: CORS },
    );
  }
}
