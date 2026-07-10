# @vaultmcp/rh-trade

A real MCP (Model Context Protocol) trading server for **Robinhood Chain**, designed
to be wrapped by [Vault](https://vaultmcp.io)'s prompt-injection proxy.

It speaks **JSON-RPC 2.0 over stdio** and exposes three trading tools backed by
[`viem`](https://viem.sh). It has no dependency on `@modelcontextprotocol/sdk` — the
framing is implemented by hand (and documented below) so it stays a small, auditable
surface for the proxy to sit in front of.

## What it is

Three MCP tools mirroring a USDG → tokenized-equity swap flow on Robinhood Chain
(a Uniswap-style AMM chain):

| Tool | Args | What it does |
| --- | --- | --- |
| `get_token_metadata` | `symbol` | Reads ERC-20 `name`/`symbol`/`decimals` for the token. |
| `get_quote` | `symbol`, `amountIn` | Quotes `amountIn` USDG → token via a Uniswap QuoterV2-style quoter. |
| `execute_swap` | `symbol`, `amountIn`, `recipient`, `minAmountOut` | Builds a swap tx. **Dry-run by default** — returns `{ to, data, value }` without broadcasting. |

## Wire framing (NDJSON JSON-RPC 2.0)

- Each JSON-RPC message is a **single UTF-8 JSON object on one line**, terminated by
  a newline (`\n`) — i.e. newline-delimited JSON (NDJSON) over stdin/stdout.
- One request line → one response line. Responses are `JSON.stringify`'d (no embedded
  newlines) and written followed by a single `\n`.
- **Notifications** (requests with no `id`, e.g. `notifications/initialized`) get no
  response, per JSON-RPC 2.0.
- **stdout carries protocol traffic only**; all diagnostics go to stderr.

Methods handled: `initialize`, `tools/list`, `tools/call`. Unknown methods return a
JSON-RPC `-32601` error.

## Running

From source (Vault proxy wraps this exact command):

```bash
# raw server
pnpm --filter @vaultmcp/rh-trade start        # == tsx src/server.ts

# wrapped by the Vault proxy (recommended)
npx @aimcpvault/mcp-proxy -- tsx src/server.ts
```

Point your MCP client at the wrapped command; the proxy scans every `tools/call`
response for prompt injection before it reaches the agent.

## Dry-run vs. live

`execute_swap` **defaults to dry-run**: it builds the transaction with viem and
returns the unsigned `{ to, data, value }` **without broadcasting**.

It broadcasts **only** when *all three* are true:

1. `RH_LIVE=1`
2. `PRIVATE_KEY` is set in the environment (never hardcoded anywhere in this package)
3. A real, non-placeholder RPC URL / chain is configured (see below)

If any is missing, the tool returns `mode: "dry-run"`, `broadcast: false`, `txHash: null`
and a `note` explaining why.

## ⚠ Placeholder-params caveat

`src/chain.ts` ships **placeholder** Robinhood Chain parameters — the RPC URL, chain
id, and the USDG / quoter / router addresses are **made-up stand-ins**, not real. This
lets the server type-check and run fully offline in dry-run mode.

Because of this, **live mode will not do anything useful until you fill in real
values** — a broadcast against placeholder addresses would just fail. Every param is
env-overridable (no source edits needed):

| Env var | Overrides |
| --- | --- |
| `RH_CHAIN_RPC_URL` | RPC endpoint (must not contain `REPLACE-ME`) |
| `RH_CHAIN_ID` | EVM chain id (must be non-zero) |
| `RH_USDG_ADDRESS` | USDG token address |
| `RH_QUOTER_ADDRESS` | Uniswap-style quoter |
| `RH_ROUTER_ADDRESS` | swap router |
| `RH_TOKEN_<SYMBOL>` | address for a given trading symbol (e.g. `RH_TOKEN_TAAPL`) |

When the RPC still points at the placeholder host (or chain id is 0), the tools take
their guarded offline branch: `get_token_metadata` returns a clearly-marked stub,
`get_quote` returns `amountOutWei: null`, and `execute_swap` stays dry-run.

## Scripts

- `pnpm --filter @vaultmcp/rh-trade start` — run the stdio server (`tsx src/server.ts`)
- `pnpm --filter @vaultmcp/rh-trade typecheck` — `tsc --noEmit`
- `pnpm --filter @vaultmcp/rh-trade test` — `vitest run` (offline; no RPC needed)
