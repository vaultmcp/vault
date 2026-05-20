# Vault — MCP Prompt Injection Proxy

**Site:** [vaultmcp.io](https://vaultmcp.io)  **·**  **Twitter/X:** [@vaultmcpbase](https://x.com/vaultmcpbase)  **·**  **Repo:** [github.com/vaultmcp/vault](https://github.com/vaultmcp/vault)

A drop-in proxy that scans MCP tool responses for prompt-injection patterns before they reach your agent's context window. Layered detection (regex + embedding similarity + optional LLM judge), an opt-in capability firewall, manifest drift verification, and on-chain reputation lookups for the servers you connect to.

Vault is a defense-in-depth layer. It does not catch every prompt-injection attack: measured detection on our public holdout is **45.2% TPR / 0.9% FPR with L3 disabled** (see [Measured performance](#measured-performance) and [`packages/LIMITATIONS.md`](packages/LIMITATIONS.md) for what gets through).

```bash
# Wrap any MCP server — zero config change to your agent
npx @vaultmcp/mcp-proxy -- npx -y @modelcontextprotocol/server-filesystem /path/to/data
```

---

## Measured performance

All numbers below are reproducible from the harness committed in this repo. Each is footnoted with the commit and dataset it was measured on.

| metric | value | source |
|---|---|---|
| True positive rate (attacks caught) | **45.2%** (85 / 188) | [^holdout] |
| False positive rate (benign flagged) | **0.9%** (1 / 110) | [^holdout] |
| L1 latency (p50 / p99) | 0.02 ms / 0.53 ms | [^holdout] |
| L2 latency (p50 / p99) | 8.29 ms / 53.06 ms | [^holdout] |
| Sustained throughput (single proxy) | 100 req/s, 0 errors over 30,000 requests | [^load] |
| Steady-state memory (RSS) | 135–180 MB after warmup, no leak observed | [^load] |
| 500 KB response scan time | ~25 s (embedder-bound, see LIMITATIONS §14) | [^edge] |

L3 (LLM judge) was **disabled** in the eval above because no `ANTHROPIC_API_KEY` was configured in the eval environment. With L3 enabled, TPR is expected to rise materially — we will publish that number once measured. The L3 latency budget is ~1 s per ambiguous response.

[^holdout]: `packages/eval/results/eval-2026-05-19-2301.md` — post-P2 sprint commit. Dataset: `packages/eval/datasets/holdout-attacks/` (188 attacks across 6 categories) and `packages/eval/datasets/benign/` (110 entries across 5 categories). L3 disabled (no API key in env).
[^load]: `packages/eval/load/report.md` — 100 req/s × 300 s × single stdio proxy instance × ~200-byte stub-MCP responses, L1+L2 only. Past 100 req/s the cliff is not yet measured.
[^edge]: `packages/proxy/test/edge-cases.test.ts` scenario 4. The latency is bounded by the L2 embedder iterating ~140 streaming chunks; L1 stays sub-millisecond at any size. See LIMITATIONS §14.

---

## What Vault does NOT do

Vault is **not** a complete prompt-injection solution. The detection layers raise the cost of an attack; they do not eliminate the attack class. Read these before adopting:

- [`packages/LIMITATIONS.md`](packages/LIMITATIONS.md) — the measured gaps: multilingual injections, tiny attacks buried in long prose, SVG/YAML structural injections, judge-prompt manipulation, normalization-induced blind spots (e.g. `mcp-server-fetch` stripping HTML comments before Vault sees them), self-referential false positives, and the 500 KB ≈ 25 s scan time.
- [`packages/SECURITY_MODEL.md`](packages/SECURITY_MODEL.md) — what Vault assumes about its environment (LLM provider trust, operator host not compromised, attestation lag) and what an attacker still has to do even with Vault deployed.

In one line: Vault catches a measured 45.2% of public-corpus attacks with L1+L2 alone, blocks zero-day variants that paraphrase outside the corpus only when L3 is enabled, and provides supply-chain signals (manifest drift, on-chain reputation) that are orthogonal to detection.

---

## Why

Every MCP tool response is a direct write into your agent's context window. A malicious file, a compromised API, or a poisoned search result can redirect your agent mid-task — exfiltrating secrets, overwriting files, or pivoting to other tools. MCP has no transport-level protection against this class. Vault adds a layered detection pass; whether that pass is sufficient for your threat model depends on the gaps documented in [`packages/LIMITATIONS.md`](packages/LIMITATIONS.md).

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

**Layer 1 — Heuristics** (p50 0.02 ms, p99 0.53 ms[^holdout]): Regex patterns for English instruction overrides, unicode tag smuggling (U+E0000–U+E007F), bidi-control characters (U+202A–U+202E, U+2066–U+2069), zero-width character density, HTML comment injection, long HTML-entity runs, and markdown link anchors. High-confidence matches short-circuit — no L2/L3 cost. L1 is English-only; see LIMITATIONS §1.

**Layer 2 — Embeddings** (p50 8.29 ms, p99 53.06 ms[^holdout]): Cosine similarity against a curated corpus of 31 attack categories using `bge-small-en-v1.5` (runs entirely on-device, no network call, ~30 MB WASM). Matches within distance 0.35 block; borderline cases escalate to L3. The corpus is intentionally public; adversaries who paraphrase past distance 0.35 evade L2 — that class is for L3.

**Layer 3 — LLM Judge** (~1 s when invoked): Claude Haiku 4.5 (or GPT-4o-mini with OpenAI key) resolves ambiguous cases. Only runs when L2 is uncertain — typically <5% of requests. Requires `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`. **Without a key, L3 is disabled and TPR drops to the L1+L2 number reported above.**

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

## Eval methodology — how to reproduce

The [Measured performance](#measured-performance) numbers above come from the harness and datasets committed in this repo. To reproduce:

```bash
# Clone and install
git clone https://github.com/vaultmcp/vault.git
cd vault
pnpm install

# Run the eval (L1+L2 only, no API key required)
pnpm --filter @vaultmcp/eval run eval -- --set both

# To include L3, export an API key first
export ANTHROPIC_API_KEY=sk-ant-...
pnpm --filter @vaultmcp/eval run eval -- --set both
```

Outputs land in `packages/eval/results/eval-<timestamp>.{md,json}`. Each run prints TPR, FPR, per-category breakdown, per-layer attribution, latency percentiles, and the worst false negatives and false positives by severity.

The holdout dataset lives at `packages/eval/datasets/holdout-attacks/` — 188 entries across `published-papers`, `garak-probes`, `blog-pocs`, `owasp-llm`, `encoded-payloads`, `multi-turn`, and `roleplay-jailbreak`. The benign dataset (110 entries) lives at `packages/eval/datasets/benign/`. Both have `MANIFEST.md` files describing provenance.

**Operators are encouraged to author their own attacks and submit pull requests.** Add a new file under `packages/eval/datasets/holdout-attacks/` following the existing JSON schema, update the `MANIFEST.md`, and open a PR. The harness picks new files up automatically.

The self red-team (`packages/eval/red-team/`) is the other half of the honest-eval story: 38 hand-crafted bypass attempts, 9 of which still pass L1+L2 after our P2 fixes. They are categorized in [`packages/LIMITATIONS.md`](packages/LIMITATIONS.md).

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

Vault is a defense-in-depth layer, not a complete solution. No regex or embedding model catches every attack — adversaries can craft payloads that evade any single detection strategy. Measured detection on our public 188-entry holdout is **45.2% TPR / 0.9% FPR with L3 disabled**; the layered approach raises the bar, but operators should treat Vault as one layer in a broader security posture.

For details:
- [`packages/LIMITATIONS.md`](packages/LIMITATIONS.md) — measured gaps, red-team evidence, and which mitigations are planned vs. accepted.
- [`packages/SECURITY_MODEL.md`](packages/SECURITY_MODEL.md) — threats Vault defends against, threats it does not, assumptions, and what an attacker still has to do.
- [`SECURITY.md`](SECURITY.md) — vulnerability reporting policy.

To report a vulnerability: open a [GitHub Security Advisory](../../security/advisories/new) (preferred) or email the maintainer directly. We aim to triage within 48 hours and ship a patch within 7 days of a confirmed critical.

---

## License

MIT
