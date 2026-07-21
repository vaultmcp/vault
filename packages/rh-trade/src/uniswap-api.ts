/// Uniswap Trading API client — the way real products integrate swaps on Robinhood
/// Chain. Instead of calling raw QuoterV2/SwapRouter contracts (whose addresses aren't
/// canonically published for RH's testnet, and which don't cover RFQ-traded stock
/// tokens), we use Uniswap's hosted API: it handles routing, the Universal Router, and
/// all addresses internally, and returns ready-to-sign transaction calldata.
///
/// Flow (per https://developers.uniswap.org/docs/trading/swapping-api):
///   1. POST /check_approval  — is `token` approved for the Universal Router?
///   2. POST /quote           — get an executable quote + routing
///   3. POST /swap            — turn the quote into a signable transaction
///
/// Auth: header `x-api-key` (free key from developers.uniswap.org/dashboard).
/// Robinhood Chain mainnet is chainId 4663 (the Trading API is mainnet-only for RH).

const DEFAULT_BASE_URL = 'https://trade-api.gateway.uniswap.org/v1';

export function tradingApiBaseUrl(): string {
  return process.env.UNISWAP_TRADING_API_URL?.trim() || DEFAULT_BASE_URL;
}

export function hasUniswapApiKey(): boolean {
  return typeof process.env.UNISWAP_API_KEY === 'string' && process.env.UNISWAP_API_KEY.length > 0;
}

/** A signable transaction as returned by /check_approval and /swap. */
export interface TransactionRequest {
  to: string;
  from: string;
  data: string;
  value: string;
  chainId: number;
  gasLimit?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  gasPrice?: string;
}

export interface QuoteRequest {
  tokenIn: string;
  tokenOut: string;
  tokenInChainId: number;
  tokenOutChainId: number;
  amount: string; // smallest units
  swapper: string;
  type?: 'EXACT_INPUT' | 'EXACT_OUTPUT';
  slippageTolerance?: number;
}

export interface QuoteResponse {
  quote: Record<string, unknown>; // opaque — passed straight back to /swap
  permitData?: Record<string, unknown> | null;
  routing?: string;
}

export interface SwapResponse {
  swap: TransactionRequest;
}

/** Injectable for tests; defaults to global fetch. */
export type FetchLike = typeof fetch;

async function post<T>(path: string, body: unknown, fetchImpl: FetchLike): Promise<T> {
  const key = process.env.UNISWAP_API_KEY;
  if (!key) throw new Error('UNISWAP_API_KEY is not set');
  const res = await fetchImpl(`${tradingApiBaseUrl()}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      // RH defaults to Universal Router 2.1.1; header kept for explicitness.
      'x-universal-router-version': '2.0',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Uniswap Trading API ${path} → HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export function getQuote(req: QuoteRequest, fetchImpl: FetchLike = fetch): Promise<QuoteResponse> {
  // The validated request shape (confirmed against the live API returning a filled quote):
  // richer routing params + chain ids sent as strings.
  const body = {
    type: req.type ?? 'EXACT_INPUT',
    tokenIn: req.tokenIn,
    tokenOut: req.tokenOut,
    tokenInChainId: String(req.tokenInChainId),
    tokenOutChainId: String(req.tokenOutChainId),
    amount: req.amount,
    swapper: req.swapper,
    routingPreference: 'BEST_PRICE',
    autoSlippage: 'DEFAULT',
    spreadOptimization: 'EXECUTION',
    urgency: 'urgent',
    permitAmount: 'FULL',
    generatePermitAsTransaction: false,
    ...(req.slippageTolerance != null ? { slippageTolerance: req.slippageTolerance } : {}),
  };
  return post<QuoteResponse>('/quote', body, fetchImpl);
}

export function getSwap(
  args: { quote: Record<string, unknown>; signature?: string; permitData?: Record<string, unknown> },
  fetchImpl: FetchLike = fetch,
): Promise<SwapResponse> {
  return post<SwapResponse>('/swap', args, fetchImpl);
}

export function checkApproval(
  args: { walletAddress: string; token: string; amount: string; chainId: number },
  fetchImpl: FetchLike = fetch,
): Promise<{ approval: TransactionRequest | null }> {
  return post('/check_approval', args, fetchImpl);
}
