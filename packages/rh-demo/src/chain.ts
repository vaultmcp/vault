/// Robinhood Chain connection parameters.
///
/// These are PLACEHOLDERS. Robinhood Chain is an Arbitrum Orbit L2 that reached
/// mainnet on 2026-07-01; fill in the real testnet/mainnet RPC URL, chain id, and
/// canonical contract addresses from the official docs before pointing the demo at
/// a live network. The demo runs fully offline against src/scenario.ts by default,
/// so it does NOT require any of these to be correct to tell the story.

export interface ChainConfig {
  name: string;
  /** Fill from https://robinhood.com/us/en/chain/ — testnet first. */
  rpcUrl: string;
  /** Fill from official docs. */
  chainId: number;
  /** USDG is the chain's native yield-bearing stablecoin (the demo's quote currency). */
  usdg: string;
  /** Uniswap universal router — live on Robinhood Chain from day one. */
  uniswapRouter: string;
}

export const ROBINHOOD_CHAIN: ChainConfig = {
  name: 'Robinhood Chain (testnet)',
  rpcUrl: process.env.RH_CHAIN_RPC_URL ?? 'https://REPLACE-ME.rpc.robinhood-chain.example',
  chainId: Number(process.env.RH_CHAIN_ID ?? 0),
  usdg: '0xUSDG000000000000000000000000000000000000',
  uniswapRouter: '0xUNIROUTER00000000000000000000000000000000',
};

/** The wallet the agent is trading on behalf of. Never hard-code a real key. */
export const AGENT_WALLET = '0xA6E17...tradingAgent';

/** The address the injected payload tries to redirect funds to. */
export const ATTACKER_WALLET = '0xBAD00dEADbeef00000000000000000000000ATTACK';
