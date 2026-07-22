/// GET /badge/robinhood.svg — "guarded on robinhood chain | N guarded" badge for READMEs.
///
/// Reads the on-chain TradeReceiptLedger and renders a shields.io-style SVG. Embed it linked
/// to the ledger on the RH explorer so the badge is verifiable, e.g.:
///   [![Guarded on Robinhood Chain](https://vaultmcp.io/badge/robinhood.svg)](https://robinhoodchain.blockscout.com/address/0x89bf75bccea833fff371fa300f7c885b5c23f103)

import { readRhLedger } from '@/lib/chain';
import { renderRhBadgeSVG } from '@/lib/badge';

export const runtime = 'nodejs';
export const revalidate = 300;

export async function GET(): Promise<Response> {
  let guarded = 0;
  try {
    const data = await readRhLedger();
    guarded = data?.totalGuarded ?? 0;
  } catch {
    // A badge that fails breaks every README it's in — render "live" instead of erroring.
  }
  return new Response(renderRhBadgeSVG(guarded), {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
