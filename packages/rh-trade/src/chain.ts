/// Robinhood Chain connection parameters for the trading MCP server.
///
/// ⚠ THESE ARE PLACEHOLDERS. Robinhood Chain is an Arbitrum Orbit L2 that reached
/// mainnet on 2026-07-01. The RPC URL and every contract address below are made-up
/// stand-ins so the code type-checks and runs in DRY-RUN mode. They are NOT real.
/// Fill them in from the official Robinhood Chain docs (testnet first) before
/// pointing this server at a live network or enabling live swaps.
///
/// Every field is env-overridable so an operator can supply real values without
/// editing source.

export interface ChainConfig {
  name: string;
  /** JSON-RPC endpoint. Fill from https://robinhood.com/us/en/chain/ — testnet first. PLACEHOLDER. */
  rpcUrl: string;
  /** EVM chain id. PLACEHOLDER (0 until filled). */
  chainId: number;
  /** USDG — the chain's native yield-bearing stablecoin, used as the swap input. PLACEHOLDER address. */
  usdg: `0x${string}`;
  /** Uniswap-style quoter (QuoterV2). Used by get_quote. PLACEHOLDER address. */
  quoter: `0x${string}`;
  /** Uniswap-style swap router. Used by execute_swap to build calldata. PLACEHOLDER address. */
  router: `0x${string}`;
}

/// A syntactically-valid but obviously-fake placeholder address. Zero-filled with a
/// short tag so it reads as "not real" in logs while still being a valid 20-byte hex.
function placeholderAddress(tag: string): `0x${string}` {
  const hex = Buffer.from(tag).toString('hex').slice(0, 40).padEnd(40, '0');
  return `0x${hex}` as `0x${string}`;
}

export const ROBINHOOD_CHAIN: ChainConfig = {
  name: process.env.RH_CHAIN_NAME ?? 'Robinhood Chain (testnet, PLACEHOLDER)',
  // PLACEHOLDER host — resolves to nothing; override with RH_CHAIN_RPC_URL.
  rpcUrl: process.env.RH_CHAIN_RPC_URL ?? 'https://REPLACE-ME.rpc.robinhood-chain.example',
  chainId: Number(process.env.RH_CHAIN_ID ?? 0),
  usdg: (process.env.RH_USDG_ADDRESS as `0x${string}` | undefined) ?? placeholderAddress('USDG'),
  quoter:
    (process.env.RH_QUOTER_ADDRESS as `0x${string}` | undefined) ?? placeholderAddress('QUOTER'),
  router:
    (process.env.RH_ROUTER_ADDRESS as `0x${string}` | undefined) ?? placeholderAddress('ROUTER'),
};

/// True only when the RPC URL still points at the placeholder host. Callers use this
/// to refuse live broadcasts and to annotate quotes as "placeholder network".
export function isPlaceholderChain(cfg: ChainConfig = ROBINHOOD_CHAIN): boolean {
  return cfg.rpcUrl.includes('REPLACE-ME') || cfg.chainId === 0;
}
