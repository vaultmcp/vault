/// Robinhood Chain connection parameters for the trading MCP server.
///
/// Swaps route through the Uniswap Trading API (see uniswap-api.ts), so we do NOT need
/// DEX contract addresses here — the API handles routing and the Universal Router. What
/// we still need is: the chain id, an RPC (for ERC-20 metadata reads and broadcasting),
/// and the USDG address (the swap input).
///
/// Robinhood Chain mainnet is chainId 4663 (the Trading API supports RH mainnet; a
/// testnet chain id 46630 exists but the Trading API does not list it). Every field is
/// env-overridable. Defaults are intentionally empty so nothing runs live by accident —
/// supply real values via env to enable quotes and swaps.

export interface ChainConfig {
  name: string;
  /** JSON-RPC endpoint — used for ERC-20 metadata reads and (in live mode) broadcasting. */
  rpcUrl: string;
  /** EVM chain id. 4663 = Robinhood Chain mainnet. 0 = unconfigured (placeholder). */
  chainId: number;
  /** USDG stablecoin address (swap input). Empty until configured. */
  usdg: `0x${string}` | '';
}

export const ROBINHOOD_CHAIN: ChainConfig = {
  name: process.env.RH_CHAIN_NAME ?? 'Robinhood Chain',
  rpcUrl: process.env.RH_CHAIN_RPC_URL ?? '',
  chainId: Number(process.env.RH_CHAIN_ID ?? 0),
  usdg: (process.env.RH_USDG_ADDRESS as `0x${string}` | undefined) ?? '',
};

/// True when the chain isn't configured for real use yet (no chain id / RPC / USDG).
/// Callers use this to run quotes/swaps in a network-free dry-run and to refuse live
/// broadcasts.
export function isPlaceholderChain(cfg: ChainConfig = ROBINHOOD_CHAIN): boolean {
  return cfg.chainId === 0 || cfg.rpcUrl === '' || cfg.usdg === '';
}
