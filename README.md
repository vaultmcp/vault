# Vault — MCP Prompt Injection Proxy

> **MCP is wide open. We close it.**

**Site:** [vaultmcp.io](https://vaultmcp.io)  **·**  **Twitter/X:** [@vaultmcpbase](https://x.com/vaultmcpbase)  **·**  **Repo:** [github.com/vaultmcp/vault](https://github.com/vaultmcp/vault)

A drop-in proxy that scans every MCP tool response for prompt injection before your agent reasons on it. Three detection layers, a capability firewall, manifest verification, and on-chain reputation for every server you connect to.

```bash
# Wrap any MCP server — zero config change to your agent
npx @vaultmcp/mcp-proxy -- npx -y @modelcontextprotocol/server-filesystem /path/to/data
```

---

## Why

Every MCP tool response is a direct write into your agent's context window. A malicious file, a compromised API, or a poisoned search result can redirect your agent mid-task — exfiltrating secrets, overwriting files, or pivoting to other tools. MCP has no transport-level protection against this. Vault adds it.

## How it works

Vault sits between your agent host and the upstream MCP server, intercepting every `tools/call` response and running it through a layered detection pipeline:

```
Agent ──► Vault Proxy ──► MCP Server
              │
              ▼
         ┌─────────────────────────────────────────────┐
         │ L1 Regex (<1ms)      heuristics + unicode    │
         │ L2 Embeddings (~8ms) bge-small cosine sim    │
         │ L3 LLM judge (~1s)   haiku-4.5 disambiguation│
         └─────────────────────────────────────────────┘
              │
              ▼  clean → forward   malicious → block/warn
```

**Layer 1 — Heuristics** (`<1 ms`): Regex patterns for instruction overrides, unicode tag smuggling (U+E0000–U+E007F), zero-width character density, HTML comment injection, and markdown link anchors. High-confidence matches short-circuit — no L2/L3 cost.

**Layer 2 — Embeddings** (`~8 ms`): Cosine similarity against a curated corpus of 31 attack categories using `bge-small-en-v1.5` (runs entirely on-device, no network call, ~30 MB WASM). Confident matches block; borderline cases escalate to L3.

**Layer 3 — LLM Judge** (`~1 s`): Claude Haiku 4.5 (or GPT-4o-mini with OpenAI key) resolves ambiguous cases with structured reasoning. Only runs when L2 is uncertain — typically <5% of requests.

### Capability Firewall

Beyond injection detection, Vault tracks taint: tool responses that entered the agent's context are marked, and if those tokens later appear in calls to sensitive tools (network requests, file writes, shell execution), the call is gated.

```bash
VAULT_CAPABILITY=1  # enable taint tracking + gate
VAULT_CAPABILITY_MODE=block  # or: warn
```

### Manifest Verification

Vault fingerprints the tool manifest of every MCP server on first connect and alerts on any subsequent drift — new tools, changed schemas, version bumps. Supply-chain protection against a compromised server silently adding a `delete_all` tool.

```bash
VAULT_MANIFEST_CHECK=on   # default — warn on drift
VAULT_MANIFEST_CHECK=strict  # treat drift as error
```

### On-Chain Reputation

Every scan verdict can be attested on-chain via [EAS](https://attest.sh) on Base, building a public, append-only reputation score for each MCP server key. Operators can check a server's 30-day threat rate before connecting.

---

## Install

```bash
# npm / npx (no install required)
npx @vaultmcp/mcp-proxy -- <your MCP server command>

# or install globally
npm install -g @vaultmcp/mcp-proxy
mcp-proxy -- npx -y @modelcontextprotocol/server-filesystem /data
```

### Claude Code / Claude Desktop integration

The fastest way is `vault init` — it auto-detects your existing MCP configs and wraps each server with the proxy:

```bash
npx @vaultmcp/mcp-proxy && vault-init
```

`vault init` shows a diff preview before writing, backs up the original config to `<config>.vault-backup`, and is idempotent (re-running skips already-wrapped servers). To revert: `vault-init unwrap`.

Or wrap by hand:

```json
// ~/.claude/mcp_settings.json (or claude_desktop_config.json)
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "@vaultmcp/mcp-proxy",
        "--",
        "npx", "-y", "@modelcontextprotocol/server-filesystem", "/path"
      ]
    }
  }
}
```

### Check a server's reputation

Before connecting to an MCP server, query its on-chain reputation. Three install paths — pick whichever fits:

```bash
# (a) via npx (no install)
npx @vaultmcp/check stdio:npx:@modelcontextprotocol/server-filesystem

# (b) via Homebrew
brew tap vaultmcp/tap && brew install vault-check

# (c) via curl — standalone binary, no Node required
curl -fsSL https://vaultmcp.io/install.sh | sh

# Then:
vault-check https://mcp.example.com/v1
vault-check --all              # scores every server in your MCP config(s)
vault-check --json | jq .      # machine-readable
```

If you've installed `@vaultmcp/mcp-proxy`, the proxy ships its own `vault-check` binary identical to the standalone — no need to install both.

Reputation comes from EAS attestations on Base, aggregated across every Vault deployment that scans the same server. Score range 0–1000 (higher = safer).

### Add a reputation badge to your MCP server's README

If you maintain an MCP server, embed its live Vault reputation score as a badge — same shape as shields.io. The badge updates automatically as new attestations land on-chain.

```markdown
![Vault Score](https://vaultmcp.io/badge/your-server-name.svg)
```

Replace `your-server-name` with the identifier Vault uses for your server — typically the package name (e.g. `@modelcontextprotocol/server-filesystem`) for npm-launched servers, or the full URL for HTTP/SSE servers. Servers with no attestations yet render as a neutral "unranked" badge.

### Public reputation API

CORS-open, no-auth read endpoints backed by the same on-chain data:

| Endpoint | Returns |
|---|---|
| `GET https://vaultmcp.io/api/score/:server` | Single server's score, scans, blocks, basescan link |
| `GET https://vaultmcp.io/api/leaderboard?n=10` | Top N servers by scan count |
| `GET https://vaultmcp.io/api/threats/recent?n=20` | Recent ThreatRecord attestations |
| `GET https://vaultmcp.io/badge/:server.svg` | SVG reputation badge |

All endpoints accept an optional `?network=base|base-sepolia` query parameter. Cache headers are set; expect 60s edge cache.

### HTTP/SSE mode

```bash
# Proxy a remote MCP server over HTTP
npx @vaultmcp/mcp-proxy --transport http \
  --upstream https://mcp.example.com/v1 \
  --port 8800
```

---

## Configuration

All configuration is via environment variables:

```bash
# Detection
VAULT_MODE=block              # block (default) | warn | log
VAULT_LAYER2_THRESHOLD=0.35   # cosine distance cutoff for L2
VAULT_LAYER3_PROVIDER=anthropic  # anthropic | openai | custom
VAULT_LAYER3_MODEL=claude-haiku-4-5-20251001  # model override
VAULT_LAYER3_TIMEOUT_MS=5000  # judge call timeout

# Keys (BYO — Vault never stores or forwards them)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Capability firewall
VAULT_CAPABILITY=1
VAULT_CAPABILITY_MODE=block
VAULT_TAINT_MIN_OVERLAP=32
VAULT_SENSITIVE_TOOL_PATTERNS=^my_custom_sensitive_tool

# Manifest verification
VAULT_MANIFEST_CHECK=on       # on | off | strict

# Audit log
VAULT_AUDIT_LOG=/var/log/vault-mcp.jsonl

# On-chain attestation (Base)
VAULT_ATTEST=1
VAULT_ATTESTER_PRIVATE_KEY=0x...  # fund with ~0.05 ETH on Base
VAULT_EAS_ADDRESS=0x4200000000000000000000000000000000000021
VAULT_SCAN_RECEIPT_SCHEMA=0x...   # register via packages/contracts
VAULT_THREAT_RECORD_SCHEMA=0x...

# Telemetry (default on when URL set)
VAULT_TELEMETRY=1
VAULT_TELEMETRY_URL=https://your-collector.example.com/ingest
VAULT_TELEMETRY=0  # opt out
```

---

## Audit log

Every verdict is written to an append-only JSONL file:

```bash
VAULT_AUDIT_LOG=/var/log/vault-mcp.jsonl

# View with the built-in CLI
npx vault-audit /var/log/vault-mcp.jsonl
npx vault-audit --type detection --verdict malicious
npx vault-audit --tool read_file --since 1h
npx vault-audit --raw | jq .
```

---

## Detection modes

| Mode    | Behavior                                                    |
|---------|-------------------------------------------------------------|
| `block` | Malicious content is replaced with an error response (default) |
| `warn`  | Original content is returned with a warning prepended       |
| `log`   | Content passes through; detection recorded in audit log only |

---

## Privacy

Vault never sends raw content anywhere. The telemetry pipeline transmits only SHA-256 hashes of content and arguments, verdict labels, latency measurements, and pattern names. Raw text never leaves the proxy process.

See [PRIVACY.md](packages/proxy/PRIVACY.md) for the full data inventory.

To disable telemetry entirely: `VAULT_TELEMETRY=0`.

---

## Project layout

```
packages/
  proxy/          # @vaultmcp/mcp-proxy — the core proxy (this is what you install)
  corpus/         # @vaultmcp/corpus — curated attack/clean embedding corpus
  contracts/      # @vaultmcp/contracts — VaultReputation.sol + EAS schema registration
  collector/      # @vaultmcp/collector — telemetry ingest + aggregation server
  eval/           # @vaultmcp/eval — detection benchmarks vs. competitors
  demo-site/      # Next.js demo + live threat feed
```

---

## Development

```bash
# Prerequisites: Node 20+, pnpm 9+, Foundry 1.7+ (for contracts only)

# Install
pnpm install

# Run proxy in dev mode (wraps the MCP filesystem server)
pnpm --filter @vaultmcp/mcp-proxy dev -- npx -y @modelcontextprotocol/server-filesystem /tmp

# Run all tests
pnpm -r test

# Typecheck
pnpm -r typecheck

# Build all packages
pnpm -r build

# Run eval benchmarks
pnpm --filter @vaultmcp/eval run eval

# Contracts (requires Foundry)
cd packages/contracts
forge test
forge build
```

---

## Security

Vault is a defense-in-depth layer, not a complete solution. No regex or embedding model catches every attack — adversaries can craft payloads that evade any single detection strategy. The layered approach (L1 → L2 → L3) dramatically raises the bar, but operators should treat it as one layer in a broader security posture.

To report a vulnerability: open a [GitHub Security Advisory](../../security/advisories/new) (preferred) or email the maintainer directly. We aim to triage within 48 hours and ship a patch within 7 days of a confirmed critical.

---

## License

MIT
