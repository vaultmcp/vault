/// Server-side proxy to the collector's /feed endpoint. Lets the client poll a same-origin URL
/// (avoiding CORS configuration on the collector) and lets us cache or transform the response
/// before sending to the browser.

import { NextRequest, NextResponse } from 'next/server';

const COLLECTOR = process.env.COLLECTOR_URL ?? 'http://127.0.0.1:8787';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const search = req.nextUrl.search;
  try {
    const resp = await fetch(`${COLLECTOR}/feed${search}`, { cache: 'no-store' });
    if (!resp.ok) {
      return NextResponse.json({ error: `collector returned ${resp.status}` }, { status: resp.status });
    }
    const body = await resp.json();
    return NextResponse.json(body);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'collector unreachable' },
      { status: 502 },
    );
  }
}
