/// Tool logic for the rh-trade MCP server.
///
/// Swaps route through the Uniswap Trading API (uniswap-api.ts) — the pattern real
/// products use on Robinhood Chain. We do NOT hand-wire QuoterV2/SwapRouter addresses;
/// the API handles routing (and RFQ for tokenized stocks) and returns signable calldata.
/// viem is used only for ERC-20 metadata reads and, in live mode, broadcasting.
///
/// The three tools:
///   get_token_metadata(symbol)                              → ERC-20 name/symbol/decimals (viem)
///   get_quote(symbol, amountIn)                             → Uniswap Trading API /quote
///   execute_swap(symbol, amountIn, recipient, minAmountOut) → /quote → /swap → (LIVE) broadcast
///
/// execute_swap DEFAULTS TO DRY-RUN. With no UNISWAP_API_KEY or an unconfigured chain it
/// makes NO network call at all (returns the request it would send). With a key it builds
/// the real signable tx via the API but only broadcasts when RH_LIVE=1 + PRIVATE_KEY.

import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ROBINHOOD_CHAIN, isPlaceholderChain, type ChainConfig } from './chain.js';
import {
  getQuote as apiGetQuote,
  getSwap as apiGetSwap,
  checkApproval as apiCheckApproval,
  hasUniswapApiKey,
  type FetchLike,
  type TransactionRequest,
} from './uniswap-api.js';
import {
  evaluatePreview,
  viemSimulate,
  quotedOutput,
  type SimulateFn,
  type PreviewVerdict,
} from './preview.js';

export { isPlaceholderChain, ROBINHOOD_CHAIN } from './chain.js';

/// Standard ERC-20 read fragments used by get_token_metadata.
export const ERC20_ABI = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
] as const;

// ---------------------------------------------------------------------------
// Token registry. USDG comes from chain.ts; tokenized-equity symbols resolve via
// RH_TOKEN_<SYMBOL> env overrides (a real deployment would use a token list).
// ---------------------------------------------------------------------------

export function resolveToken(symbol: string, cfg: ChainConfig = ROBINHOOD_CHAIN): Address | '' {
  const upper = symbol.trim().toUpperCase();
  if (upper === 'USDG') return cfg.usdg;
  const override = process.env[`RH_TOKEN_${upper}`];
  return override && override.length > 0 ? (override as Address) : '';
}

/// The swapper/quote-origin address. For a swap it's the recipient; for a bare quote
/// it's RH_WALLET_ADDRESS (or a burn address, since a quote moves nothing).
function swapperFor(recipient?: string): string {
  if (recipient) return recipient;
  return process.env.RH_WALLET_ADDRESS ?? '0x000000000000000000000000000000000000dEaD';
}

function publicClient(cfg: ChainConfig = ROBINHOOD_CHAIN): PublicClient {
  return createPublicClient({ transport: http(cfg.rpcUrl) }) as PublicClient;
}

// ---------------------------------------------------------------------------
// get_token_metadata (viem ERC-20 read; network-free stub on placeholder chain).
// ---------------------------------------------------------------------------

export interface TokenMetadata {
  symbol: string;
  address: Address | '';
  name: string;
  onChainSymbol: string;
  decimals: number;
  placeholder: boolean;
}

export async function getTokenMetadata(
  args: { symbol: string },
  cfg: ChainConfig = ROBINHOOD_CHAIN,
): Promise<TokenMetadata> {
  const address = resolveToken(args.symbol, cfg);
  if (isPlaceholderChain(cfg) || address === '') {
    return {
      symbol: args.symbol.toUpperCase(),
      address,
      name: `unresolved ${args.symbol.toUpperCase()} — configure the chain (RH_CHAIN_RPC_URL, RH_USDG_ADDRESS) and RH_TOKEN_${args.symbol.toUpperCase()}`,
      onChainSymbol: args.symbol.toUpperCase(),
      decimals: 18,
      placeholder: true,
    };
  }
  const client = publicClient(cfg);
  const [name, onChainSymbol, decimals] = await Promise.all([
    client.readContract({ address, abi: ERC20_ABI, functionName: 'name' }),
    client.readContract({ address, abi: ERC20_ABI, functionName: 'symbol' }),
    client.readContract({ address, abi: ERC20_ABI, functionName: 'decimals' }),
  ]);
  return { symbol: args.symbol.toUpperCase(), address, name, onChainSymbol, decimals: Number(decimals), placeholder: false };
}

// ---------------------------------------------------------------------------
// get_quote (Uniswap Trading API /quote).
// ---------------------------------------------------------------------------

export interface Quote {
  symbol: string;
  tokenIn: Address | '';
  tokenOut: Address | '';
  amountIn: string;
  amountInWei: string;
  /** Opaque Uniswap quote object — passed straight back to /swap. Null when dry. */
  quote: Record<string, unknown> | null;
  placeholder: boolean;
  note: string;
}

export async function getQuote(
  args: { symbol: string; amountIn: string },
  cfg: ChainConfig = ROBINHOOD_CHAIN,
  fetchImpl: FetchLike = fetch,
): Promise<Quote> {
  const tokenIn = cfg.usdg;
  const tokenOut = resolveToken(args.symbol, cfg);
  const amountInWei = parseUnits(args.amountIn, 18).toString();
  const base = { symbol: args.symbol.toUpperCase(), tokenIn, tokenOut, amountIn: args.amountIn, amountInWei };

  if (isPlaceholderChain(cfg) || tokenOut === '' || !hasUniswapApiKey()) {
    const missing = [
      isPlaceholderChain(cfg) && 'chain not configured (RH_CHAIN_RPC_URL / RH_CHAIN_ID / RH_USDG_ADDRESS)',
      tokenOut === '' && `token ${args.symbol.toUpperCase()} not resolved (set RH_TOKEN_${args.symbol.toUpperCase()})`,
      !hasUniswapApiKey() && 'no UNISWAP_API_KEY',
    ].filter(Boolean);
    return { ...base, quote: null, placeholder: true, note: `DRY (no live quote): ${missing.join('; ')}.` };
  }

  const resp = await apiGetQuote(
    {
      tokenIn,
      tokenOut,
      tokenInChainId: cfg.chainId,
      tokenOutChainId: cfg.chainId,
      amount: amountInWei,
      swapper: swapperFor(),
    },
    fetchImpl,
  );
  return { ...base, quote: resp.quote, placeholder: false, note: 'Quoted via Uniswap Trading API.' };
}

// ---------------------------------------------------------------------------
// execute_swap (Trading API /quote → /swap; broadcast only in full live mode).
// ---------------------------------------------------------------------------

export interface SwapResult {
  mode: 'dry-run' | 'broadcast' | 'blocked';
  broadcast: boolean;
  /** The intended swap request (always present). */
  request: { tokenIn: Address | ''; tokenOut: Address | ''; amountInWei: string; recipient: string; chainId: number };
  /** The signable swap transaction from the API — present once a quote is fetched. */
  tx: TransactionRequest | null;
  txHash: Hex | null;
  /** Simulate-before-sign verdict — present when the preview ran (live mode). */
  preview?: PreviewVerdict;
  note: string;
}

function intEnv(raw: string | undefined, def: number): number {
  if (!raw || !/^\d+$/.test(raw.trim())) return def;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) ? n : def;
}

export async function executeSwap(
  args: { symbol: string; amountIn: string; recipient: string; minAmountOut: string },
  cfg: ChainConfig = ROBINHOOD_CHAIN,
  fetchImpl: FetchLike = fetch,
  simulate?: SimulateFn,
): Promise<SwapResult> {
  const tokenIn = cfg.usdg;
  const tokenOut = resolveToken(args.symbol, cfg);
  const amountInWei = parseUnits(args.amountIn, 18).toString();
  const request = { tokenIn, tokenOut, amountInWei, recipient: args.recipient, chainId: cfg.chainId };

  const liveRequested = process.env.RH_LIVE === '1';
  const hasKey = typeof process.env.PRIVATE_KEY === 'string' && process.env.PRIVATE_KEY.length > 0;

  // Network-free dry-run: nothing configured to build a real tx.
  if (isPlaceholderChain(cfg) || tokenOut === '' || !hasUniswapApiKey()) {
    const reasons = [
      isPlaceholderChain(cfg) && 'chain not configured',
      tokenOut === '' && `token ${args.symbol.toUpperCase()} not resolved`,
      !hasUniswapApiKey() && 'no UNISWAP_API_KEY',
    ].filter(Boolean);
    return {
      mode: 'dry-run',
      broadcast: false,
      request,
      tx: null,
      txHash: null,
      note: `DRY-RUN (no network): ${reasons.join('; ')}. Would route this USDG→${args.symbol.toUpperCase()} swap via the Uniswap Trading API.`,
    };
  }

  // Build the real, signable swap via the API. `swapper = recipient` so output lands there.
  const canBroadcast = liveRequested && hasKey;
  const q = await apiGetQuote(
    { tokenIn, tokenOut, tokenInChainId: cfg.chainId, tokenOutChainId: cfg.chainId, amount: amountInWei, swapper: args.recipient },
    fetchImpl,
  );

  let signature: string | undefined;
  if (q.permitData && canBroadcast) {
    const account = privateKeyToAccount(process.env.PRIVATE_KEY as Hex);
    // permitData is EIP-712 typed data as returned by the API.
    signature = await account.signTypedData(q.permitData as never);
  }
  const swapResp = await apiGetSwap(
    { quote: q.quote, ...(signature ? { signature, permitData: q.permitData ?? undefined } : {}) },
    fetchImpl,
  );
  const tx = swapResp.swap;

  if (!canBroadcast) {
    return {
      mode: 'dry-run',
      broadcast: false,
      request,
      tx,
      txHash: null,
      note: `DRY-RUN: built a signable swap via the Uniswap Trading API but did not broadcast (${!liveRequested ? 'RH_LIVE != 1' : 'no PRIVATE_KEY'}).`,
    };
  }

  // Simulate-before-sign: run the concrete tx against the chain and check what the
  // recipient would ACTUALLY receive. Refuse to broadcast a swap that reverts, under-
  // delivers below the floor, or comes back far below the quote. On by default in live
  // mode; disable with RH_PREVIEW=0.
  let preview: PreviewVerdict | undefined;
  if (process.env.RH_PREVIEW !== '0') {
    const sim = simulate ?? viemSimulate(publicClient(cfg));
    const { simulatedOut, reverted } = await sim({
      to: tx.to as Address,
      data: tx.data as Hex,
      value: BigInt(tx.value || '0'),
      account: args.recipient as Address,
      outputToken: tokenOut as Address,
    });
    preview = evaluatePreview({
      minOut: parseUnits(args.minAmountOut, 18),
      simulatedOut,
      reverted,
      expectedOut: quotedOutput(q.quote),
      maxDriftBps: intEnv(process.env.RH_PREVIEW_MAX_DRIFT_BPS, 200),
      strict: process.env.RH_PREVIEW_STRICT === '1',
    });
    if (preview.action === 'block') {
      return {
        mode: 'blocked',
        broadcast: false,
        request,
        tx,
        txHash: null,
        preview,
        note: `PREVIEW BLOCKED (nothing signed): ${preview.reason}`,
      };
    }
  }

  // Live: approve USDG if needed, then broadcast the swap.
  const account = privateKeyToAccount(process.env.PRIVATE_KEY as Hex);
  const wallet = createWalletClient({ account, transport: http(cfg.rpcUrl) });
  const approval = await apiCheckApproval(
    { walletAddress: args.recipient, token: tokenIn, amount: amountInWei, chainId: cfg.chainId },
    fetchImpl,
  );
  if (approval.approval) {
    await wallet.sendTransaction({
      account,
      to: approval.approval.to as Address,
      data: approval.approval.data as Hex,
      value: BigInt(approval.approval.value || '0'),
      chain: null,
    });
  }
  const txHash = await wallet.sendTransaction({
    account,
    to: tx.to as Address,
    data: tx.data as Hex,
    value: BigInt(tx.value || '0'),
    chain: null,
  });
  return { mode: 'broadcast', broadcast: true, request, tx, txHash, preview, note: `Broadcast to ${cfg.name}.` };
}

// ---------------------------------------------------------------------------
// Tool registry + JSON Schemas (consumed by tools/list in server.ts).
// ---------------------------------------------------------------------------

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
    additionalProperties: false;
  };
}

export const TOOLS: ToolDef[] = [
  {
    name: 'get_token_metadata',
    description:
      'Read ERC-20 name/symbol/decimals for a token symbol on Robinhood Chain (viem). Returns a stub when the chain is unconfigured.',
    inputSchema: {
      type: 'object',
      properties: { symbol: { type: 'string', description: 'Token symbol, e.g. tAAPL or USDG.' } },
      required: ['symbol'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_quote',
    description:
      'Quote swapping amountIn USDG into the given token via the Uniswap Trading API. Returns a dry note until the chain + UNISWAP_API_KEY are configured.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Token symbol to buy, e.g. tAAPL.' },
        amountIn: { type: 'string', description: 'Amount of USDG to spend, decimal string (e.g. "1000").' },
      },
      required: ['symbol', 'amountIn'],
      additionalProperties: false,
    },
  },
  {
    name: 'execute_swap',
    description:
      'Swap USDG->token via the Uniswap Trading API. DEFAULTS TO DRY-RUN: builds a signable tx without broadcasting unless RH_LIVE=1, PRIVATE_KEY, UNISWAP_API_KEY, and a real chain are all set.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Token symbol to buy.' },
        amountIn: { type: 'string', description: 'USDG to spend, decimal string.' },
        recipient: { type: 'string', description: 'Address to receive the bought token (0x...).' },
        minAmountOut: { type: 'string', description: 'Minimum acceptable output amount (slippage floor).' },
      },
      required: ['symbol', 'amountIn', 'recipient', 'minAmountOut'],
      additionalProperties: false,
    },
  },
];

export async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'get_token_metadata':
      requireString(args, 'symbol');
      return getTokenMetadata(args as { symbol: string });
    case 'get_quote':
      requireString(args, 'symbol');
      requireString(args, 'amountIn');
      return getQuote(args as { symbol: string; amountIn: string });
    case 'execute_swap':
      requireString(args, 'symbol');
      requireString(args, 'amountIn');
      requireString(args, 'recipient');
      requireString(args, 'minAmountOut');
      return executeSwap(args as { symbol: string; amountIn: string; recipient: string; minAmountOut: string });
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

function requireString(args: Record<string, unknown>, key: string): void {
  if (typeof args[key] !== 'string' || (args[key] as string).length === 0) {
    throw new Error(`missing or invalid argument: ${key} (expected non-empty string)`);
  }
}
