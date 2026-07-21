# Robinhood Chain integration — status & runbook

How `packages/rh-trade` connects Vault-guarded agentic trading to Robinhood Chain, and
exactly what's needed to take it live.

## Approach: the Uniswap Trading API (not raw contracts)

Real products on Robinhood Chain don't hand-wire `QuoterV2`/`SwapRouter` addresses — they
use the **Uniswap Trading API**, which handles routing, the Universal Router, and RFQ for
tokenized stocks, and returns signable calldata. `rh-trade` now does the same:
`get_quote` → `POST /quote`, `execute_swap` → `/quote` → `/swap` (→ broadcast in live mode).

This means the integration needs a **free Uniswap API key**, not a pile of contract
addresses. The Trading API supports RH **mainnet (chainId 4663)**; the testnet (46630) is
not listed by the API, so a live swap runs on mainnet with tiny amounts.

## Verified values (checked against the live chain)

| Value | Testnet | Mainnet | How verified |
|---|---|---|---|
| RPC | `https://rpc.testnet.chain.robinhood.com` | (use an RH mainnet RPC) | queried `eth_chainId` |
| Chain ID | **46630** | **4663** | `eth_chainId` → `0xb626` = 46630 |
| USDG | ⚠ many impostors on testnet — confirm with RH | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (RH docs, mainnet) | RH docs |

Always verify a token address before use: `eth_call` its `symbol()` (`0x95d89b41`).

## What YOU need

1. **A free Uniswap API key** — <https://developers.uniswap.org/dashboard>. This replaces the
   five contract addresses.
2. **A tokenized-equity address** to trade (e.g. tAAPL) on the target chain.
3. **For a live swap only:** a wallet holding a little USDG + gas on RH mainnet. **Never paste
   the private key** — set it as a local env var at run time.

## Run it — env vars

```bash
export RH_CHAIN_RPC_URL="<RH mainnet RPC>"
export RH_CHAIN_ID=4663
export RH_USDG_ADDRESS=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
export RH_TOKEN_TAAPL=0x…              # the tokenized-equity address to buy
export UNISWAP_API_KEY=<your free key>
export RH_WALLET_ADDRESS=0x…           # your wallet (used as swap origin for quotes)

# Dry-run (builds a signable tx via the API, does NOT broadcast):
npx @aimcpvault/mcp-proxy@latest -- tsx packages/rh-trade/src/server.ts

# Live (broadcasts one real swap) — only on your machine:
export PRIVATE_KEY=0x…                 # funded RH-mainnet wallet
export RH_LIVE=1
VAULT_TRADE_GUARD=1 VAULT_TRADE_ALLOWLIST=$RH_WALLET_ADDRESS \
  npx @aimcpvault/mcp-proxy@latest -- tsx packages/rh-trade/src/server.ts
```

With `VAULT_TRADE_GUARD=1`, a swap whose recipient isn't your allowlisted wallet — or that
was tainted by a poisoned tool response — is blocked before it broadcasts. That's the demo.

## Simulate before sign

In live mode, `execute_swap` runs the concrete, signable transaction against the chain
(`eth_simulateV1` via viem) and checks what the recipient would **actually** receive before
it broadcasts. This is the layer past the firewall: the firewall blocks a swap for what it
*says* (bad recipient, over a limit), the preview blocks it for what it *would do*. A swap
that reverts, under-delivers below your `minAmountOut` floor, or comes back far below the
quoted amount (a sandwich / rigged router) never gets signed.

On by default in live mode. Configure with:

| Variable | Default | Meaning |
|---|---|---|
| `RH_PREVIEW` | on | `0` disables the pre-broadcast simulation. |
| `RH_PREVIEW_STRICT` | off | `1` blocks when the RPC can't simulate, instead of warning and proceeding. |
| `RH_PREVIEW_MAX_DRIFT_BPS` | `200` | Block if the simulated output is more than this far (basis points) below the quote. `0` disables the drift check. |

If the RPC doesn't support `eth_simulateV1`, the preview reports "could not simulate" and
(unless `RH_PREVIEW_STRICT=1`) proceeds — it never blocks a legitimate trade just because
simulation was unavailable.

## Steps

- [ ] Get a free Uniswap API key
- [ ] Get one tokenized-equity address (+ confirm the USDG address for your chain)
- [ ] Dry-run: confirm `get_quote` returns a live quote and `execute_swap` builds a tx (no broadcast)
- [ ] Live: fund a wallet with ~$2 USDG, run one guarded swap, record it

## Which pair routes (verified 2026-07-20)

Using the validated quote shape (`routingPreference: BEST_PRICE`, `autoSlippage: DEFAULT`,
`urgency`, `permitAmount`, chain ids sent as the string `"4663"`), the Uniswap Trading API on
Robinhood Chain routes **ETH↔WETH** (HTTP 200, `routing: WRAP`/`UNWRAP`). USDG→WETH and
USDG→tAAPL return `404 "No quotes available"` at test time — tokenized stocks trade 24/5 via
RFQ (the equities market was closed), and USDG had no AMM route then; retry during US market
hours for stock-token quotes. The `rh-trade` → Vault trade-guard end-to-end
(`test/e2e-guard.test.ts`) is proven on the routable ETH→WETH pair: a swap to a
non-allowlisted recipient is blocked with `[VAULT_CAPABILITY_BLOCKED]`, while an allowlisted
recipient passes the guard and `execute_swap` builds a signable swap tx via the API (dry-run,
not broadcast).
