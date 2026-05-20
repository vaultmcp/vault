# @vaultmcp/check

> Look up an MCP server's on-chain Vault reputation. Read-only. No key needed.

Standalone CLI. Queries the [VaultReputation](https://github.com/vaultmcp/vault) contract on Base via viem and prints a colored score, scans, blocks, and a basescan link.

## Install

```bash
# Via npx (no install) — easiest
npx @vaultmcp/check stdio:npx:@modelcontextprotocol/server-filesystem

# Via Homebrew (after launch)
brew tap vaultmcp/tap
brew install vault-check

# Via curl — installs the standalone binary, no Node required
curl -fsSL https://vaultmcp.io/install.sh | sh
```

## Usage

```bash
vault-check https://mcp.example.com/v1
vault-check stdio:npx:@modelcontextprotocol/server-filesystem
vault-check --all                # scores every server in your MCP config(s)
vault-check stdio:npx --json     # machine-readable
vault-check --network base       # base | base-sepolia (default: base-sepolia)
```

## Output

```
  stdio:npx:@modelcontextprotocol/server-filesystem    score 900/1000    scans 142    blocks 3
                                                       low threat rate (2.1% over 142 scans) — generally safe
                                                       explorer: https://basescan.org/address/0x...
```

JSON mode returns the same fields:

```json
{
  "server": "stdio:npx:...",
  "network": "base",
  "score": 900,
  "scans": 142,
  "blocks": 3,
  "blockRate": 0.021,
  "explorer": "https://basescan.org/address/...",
  "interpretation": "low threat rate (2.1% over 142 scans) — generally safe"
}
```

## Server identifier conventions

Match the conventions used by `@vaultmcp/mcp-proxy` when attesting:

- **HTTP/SSE**: full upstream URL — `https://mcp.example.com/v1`
- **stdio**: `stdio:<cmd>:<package-or-module>` — `stdio:npx:@modelcontextprotocol/server-filesystem`, `stdio:uvx:mcp-server-git`, `stdio:python:mcp_server_fs`

If you pass a bare command name, `stdio:` is prepended automatically.

## How the score is computed

`score = 1000 - min(1000, (blocks × 10000) / (scans × 10))`, over a rolling 30-day window. Reads the same `getScore(string)` view function the proxy uses to attest. See [VaultReputation.sol](https://github.com/vaultmcp/vault/blob/main/packages/contracts/src/VaultReputation.sol).

## Site

[vaultmcp.io](https://vaultmcp.io)
