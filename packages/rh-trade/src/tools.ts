/// Tool logic for the rh-trade MCP server.
///
/// This module is deliberately kept pure-ish and testable: the JSON-RPC/stdio loop
/// lives in server.ts, and every viem network call is funnelled through a small
/// PublicClient/WalletClient factory that is only built lazily. Tests never trigger
/// a network call because they exercise the dry-run path of execute_swap and the
/// schema surface directly, not the on-chain read paths.
///
/// The three tools mirror a real swap flow on Robinhood Chain:
///   get_token_metadata(symbol)                              → ERC-20 name/symbol/decimals
///   get_quote(symbol, amountIn)                             → Uniswap-style quoter read
///   execute_swap(symbol, amountIn, recipient, minAmountOut) → build (and, in LIVE mode, send) a tx
///
/// execute_swap DEFAULTS TO DRY-RUN: it returns the raw { to, data, value } of the
/// transaction WITHOUT broadcasting. It only broadcasts when all of RH_LIVE=1, a
/// PRIVATE_KEY env var, and a real (non-placeholder) RPC URL are present.

import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  parseUnits,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ROBINHOOD_CHAIN, isPlaceholderChain, type ChainConfig } from './chain.js';

export { isPlaceholderChain, ROBINHOOD_CHAIN } from './chain.js';

// ---------------------------------------------------------------------------
// ABIs — minimal, real fragments.
// ---------------------------------------------------------------------------

/// Standard ERC-20 read fragments used by get_token_metadata.
export const ERC20_ABI = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
] as const;

/// Uniswap QuoterV2-style single-hop quote. `quoteExactInputSingle` is a state-
/// changing-looking function that is called via `eth_call` (staticcall) to simulate
/// the swap and return the output amount. The tuple param shape matches Uniswap's
/// QuoterV2 on mainnet; the deployed quoter on Robinhood Chain is expected to be the
/// same shape (its address is a PLACEHOLDER in chain.ts).
export const QUOTER_V2_ABI = [
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'fee', type: 'uint24' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
] as const;

/// Uniswap SwapRouter02-style `exactInputSingle`. execute_swap encodes calldata
/// against this fragment. The deployed router address on Robinhood Chain is a
/// PLACEHOLDER in chain.ts.
export const SWAP_ROUTER_ABI = [
  {
    type: 'function',
    name: 'exactInputSingle',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
] as const;

/// Default Uniswap V3 fee tier (0.3%). Real deployments may route through a
/// different tier; this is a documented default, not a discovered value.
const DEFAULT_FEE = 3000;

// ---------------------------------------------------------------------------
// Token registry.
// ---------------------------------------------------------------------------

/// A tiny symbol → address registry. On a real deployment this would come from a
/// token list. USDG is the quote currency (from chain.ts). The tokenized-equity
/// symbols below use PLACEHOLDER addresses derived the same way as chain.ts, so the
/// server has *something* to resolve a symbol to while running offline. NOT real.
function placeholderTokenAddress(symbol: string): Address {
  const hex = Buffer.from(`TKN:${symbol}`).toString('hex').slice(0, 40).padEnd(40, '0');
  return `0x${hex}` as Address;
}

export function resolveToken(symbol: string, cfg: ChainConfig = ROBINHOOD_CHAIN): Address {
  const upper = symbol.trim().toUpperCase();
  if (upper === 'USDG') return cfg.usdg;
  const override = process.env[`RH_TOKEN_${upper}`];
  if (override && override.length > 0) return override as Address;
  return placeholderTokenAddress(upper);
}

// ---------------------------------------------------------------------------
// Lazy viem client factories (only constructed on real network paths).
// ---------------------------------------------------------------------------

function publicClient(cfg: ChainConfig = ROBINHOOD_CHAIN): PublicClient {
  return createPublicClient({ transport: http(cfg.rpcUrl) }) as PublicClient;
}

// ---------------------------------------------------------------------------
// Tool implementations.
// ---------------------------------------------------------------------------

export interface TokenMetadata {
  symbol: string;
  address: Address;
  name: string;
  onChainSymbol: string;
  decimals: number;
  placeholder: boolean;
}

/// Reads ERC-20 name/symbol/decimals from the resolved token address.
/// Network call: uses viem multicall via three eth_call reads. Guarded so that when
/// the chain is a placeholder we return a clearly-marked metadata stub instead of
/// dialing a fake RPC.
export async function getTokenMetadata(
  args: { symbol: string },
  cfg: ChainConfig = ROBINHOOD_CHAIN,
): Promise<TokenMetadata> {
  const address = resolveToken(args.symbol, cfg);
  if (isPlaceholderChain(cfg)) {
    return {
      symbol: args.symbol.toUpperCase(),
      address,
      name: `PLACEHOLDER ${args.symbol.toUpperCase()} (no live RPC configured)`,
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
  return {
    symbol: args.symbol.toUpperCase(),
    address,
    name,
    onChainSymbol,
    decimals: Number(decimals),
    placeholder: false,
  };
}

export interface Quote {
  symbol: string;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: string;
  amountInWei: string;
  amountOutWei: string | null;
  fee: number;
  placeholder: boolean;
  note: string;
}

/// Quotes swapping `amountIn` USDG into `symbol` via the Uniswap-style quoter.
/// `amountIn` is a decimal string in USDG units and is converted with 18 decimals
/// (USDG's assumed decimals — override once real metadata is available).
/// Guarded: with a placeholder chain we return amountOutWei=null rather than calling
/// a fake quoter.
export async function getQuote(
  args: { symbol: string; amountIn: string },
  cfg: ChainConfig = ROBINHOOD_CHAIN,
): Promise<Quote> {
  const tokenIn = cfg.usdg;
  const tokenOut = resolveToken(args.symbol, cfg);
  const amountInWei = parseUnits(args.amountIn, 18);
  const base: Omit<Quote, 'amountOutWei' | 'placeholder' | 'note'> = {
    symbol: args.symbol.toUpperCase(),
    tokenIn,
    tokenOut,
    amountIn: args.amountIn,
    amountInWei: amountInWei.toString(),
    fee: DEFAULT_FEE,
  };
  if (isPlaceholderChain(cfg)) {
    return {
      ...base,
      amountOutWei: null,
      placeholder: true,
      note: 'PLACEHOLDER chain: no live quoter. Configure a real RPC + quoter address to get a live quote.',
    };
  }
  const client = publicClient(cfg);
  const { result } = await client.simulateContract({
    address: cfg.quoter,
    abi: QUOTER_V2_ABI,
    functionName: 'quoteExactInputSingle',
    args: [
      {
        tokenIn,
        tokenOut,
        amountIn: amountInWei,
        fee: DEFAULT_FEE,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });
  const amountOut = result[0];
  return {
    ...base,
    amountOutWei: amountOut.toString(),
    placeholder: false,
    note: `Quoted via ${cfg.quoter}`,
  };
}

export interface SwapResult {
  mode: 'dry-run' | 'broadcast';
  broadcast: boolean;
  /// The unsigned transaction request. Always returned, even in live mode.
  tx: { to: Address; data: Hex; value: string };
  /// Set only when mode === 'broadcast'.
  txHash: Hex | null;
  note: string;
}

/// Builds the swap transaction with viem and, by default, returns it WITHOUT
/// broadcasting (dry-run). It broadcasts ONLY when live mode is fully enabled:
/// RH_LIVE=1 AND a PRIVATE_KEY env AND a non-placeholder RPC/chain. Never hardcodes
/// a key. Because chain.ts ships placeholder addresses, live mode will fail against
/// them until real Robinhood Chain addresses are filled in — this is intentional and
/// documented.
export async function executeSwap(
  args: { symbol: string; amountIn: string; recipient: string; minAmountOut: string },
  cfg: ChainConfig = ROBINHOOD_CHAIN,
): Promise<SwapResult> {
  const tokenIn = cfg.usdg;
  const tokenOut = resolveToken(args.symbol, cfg);
  const amountInWei = parseUnits(args.amountIn, 18);
  const minOutWei = parseUnits(args.minAmountOut, 18);
  const recipient = args.recipient as Address;

  const data = encodeFunctionData({
    abi: SWAP_ROUTER_ABI,
    functionName: 'exactInputSingle',
    args: [
      {
        tokenIn,
        tokenOut,
        fee: DEFAULT_FEE,
        recipient,
        amountIn: amountInWei,
        amountOutMinimum: minOutWei,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });

  const tx = { to: cfg.router, data, value: '0' };

  const liveRequested = process.env.RH_LIVE === '1';
  const hasKey = typeof process.env.PRIVATE_KEY === 'string' && process.env.PRIVATE_KEY.length > 0;
  const canBroadcast = liveRequested && hasKey && !isPlaceholderChain(cfg);

  if (!canBroadcast) {
    const reasons: string[] = [];
    if (!liveRequested) reasons.push('RH_LIVE != 1');
    if (!hasKey) reasons.push('no PRIVATE_KEY');
    if (isPlaceholderChain(cfg)) reasons.push('placeholder chain/RPC');
    return {
      mode: 'dry-run',
      broadcast: false,
      tx,
      txHash: null,
      note: `DRY-RUN (not broadcast): ${reasons.join(', ')}. Returned unsigned tx only.`,
    };
  }

  // Live path. Never reached in tests (guarded by env + placeholder checks above).
  const account = privateKeyToAccount(process.env.PRIVATE_KEY as Hex);
  const wallet = createWalletClient({ account, transport: http(cfg.rpcUrl) });
  const txHash = await wallet.sendTransaction({
    account,
    to: cfg.router,
    data,
    value: 0n,
    chain: null,
  });
  return {
    mode: 'broadcast',
    broadcast: true,
    tx,
    txHash,
    note: `Broadcast to ${cfg.name} (${cfg.rpcUrl}).`,
  };
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
      'Read ERC-20 name/symbol/decimals for a token symbol on Robinhood Chain. Dry/offline-safe against placeholder config.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Token symbol, e.g. tAAPL or USDG.' },
      },
      required: ['symbol'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_quote',
    description:
      'Quote swapping amountIn USDG into the given token via a Uniswap-style quoter. Returns null output amount on placeholder config.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Token symbol to buy, e.g. tAAPL.' },
        amountIn: {
          type: 'string',
          description: 'Amount of USDG to spend, as a decimal string (e.g. "1000").',
        },
      },
      required: ['symbol', 'amountIn'],
      additionalProperties: false,
    },
  },
  {
    name: 'execute_swap',
    description:
      'Build a USDG->token swap transaction. DEFAULTS TO DRY-RUN: returns { to, data, value } without broadcasting unless RH_LIVE=1, PRIVATE_KEY, and a real RPC are all set.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Token symbol to buy.' },
        amountIn: { type: 'string', description: 'USDG to spend, decimal string.' },
        recipient: { type: 'string', description: 'Address to receive the bought token (0x...).' },
        minAmountOut: {
          type: 'string',
          description: 'Minimum acceptable output amount, decimal string (slippage floor).',
        },
      },
      required: ['symbol', 'amountIn', 'recipient', 'minAmountOut'],
      additionalProperties: false,
    },
  },
];

/// Dispatches a tools/call by name. Throws on unknown tool or bad args; server.ts
/// maps thrown errors to JSON-RPC error responses.
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
      return executeSwap(
        args as { symbol: string; amountIn: string; recipient: string; minAmountOut: string },
      );
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

function requireString(args: Record<string, unknown>, key: string): void {
  if (typeof args[key] !== 'string' || (args[key] as string).length === 0) {
    throw new Error(`missing or invalid argument: ${key} (expected non-empty string)`);
  }
}
