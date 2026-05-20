# Vault Private Beta — Reviewer Guide

Thanks for agreeing to look at this early. This is a working proxy, not a demo — run it on a real workload.

## What Vault is

A drop-in proxy that sits between your AI agent and any MCP server. It scans every `tools/call` response for prompt injection before your agent sees it.

Detection is three-layer: regex heuristics (sub-millisecond), embedding similarity against a curated attack corpus (~11 ms), and an LLM judge for ambiguous cases (~1.5 s). The LLM layer requires an API key — without it, TPR drops from 99.5% to 45.2%.

## Install

```bash
# Requires Node 20+
npx @vaultmcp/mcp-proxy@beta -- <your MCP server command>
```

Example — wrapping the filesystem server:

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # required for full detection
npx @vaultmcp/mcp-proxy@beta -- npx -y @modelcontextprotocol/server-filesystem /path/to/data
```

If you skip `ANTHROPIC_API_KEY`, Vault will print a warning on stderr and run in degraded mode (L1+L2 only). This is intentional and loud — not a silent failure.

## Claude Desktop / Claude Code integration

```json
// ~/.claude/mcp_settings.json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "@vaultmcp/mcp-proxy@beta",
        "--",
        "npx", "-y", "@modelcontextprotocol/server-filesystem", "/path"
      ],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

## Key env vars

| Var | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Enables L3 LLM judge — strongly recommended |
| `VAULT_MODE` | `block` | `block` / `warn` / `log` |
| `VAULT_AUDIT_LOG` | none | Path to write JSONL audit log |
| `VAULT_ATTEST` | `0` | Set `1` to write verdicts to Base Sepolia (testnet) |

## What to look for

We care about three things:

**1. False positives** — Vault flags something that should be clean.
- Run it on your normal workflow for 20-30 minutes
- If any legitimate tool response gets blocked, note the content and the tool name
- The false positive rate on our 110-entry benign eval is 0.0%, but real workloads differ

**2. False negatives** — Vault misses an attack you try.
- Craft a payload and embed it in a file or env var that your MCP server would return
- If Vault passes it through, send us the payload (or a paraphrase of it)
- We especially want to know about: non-English attacks, attacks buried in long documents, attacks that use encodings we haven't seen

**3. Latency and install friction** — Is it noticeably slow? Did setup confuse you?
- L3 adds ~1.5 s per uncertain response. If that's unacceptable for your workflow, `VAULT_MODE=log` lets content through with just logging.
- Anything that made install harder than expected is worth reporting.

## How to send findings

Open a private issue on the repo (GitHub → Issues → New → mark as private), or reply directly to the DM you received.

For each finding, include:
- Was it a false positive or false negative?
- The payload or content (even a paraphrase helps)
- What MCP server and tool was involved
- What Vault reported (copy the stderr line or audit log entry)

## Known limitations (please read)

Before you spend time on something we already know:

- **Multilingual attacks**: L1 is English-only. L2/L3 catch some but not all.
- **Attacks buried in long documents**: A 5-word attack in a 50 KB response may not score high enough on embedding similarity.
- **Multi-turn attacks across sessions**: Vault scans per-response. A sleeper planted in one session and activated in another is out of scope architecturally.
- **Image/audio content**: Text only. Binary tool responses are forwarded unscanned.
- **mcp-server-fetch HTML comment stripping**: The fetch server strips HTML comments before Vault sees the content. A classic Greshake-class invisible-comment injection is missed at the proxy level.

Full list: `packages/LIMITATIONS.md` in the repo.

## Current numbers

| metric | value |
|---|---|
| TPR — in-scope injections (L3 on) | 99.5% (184/185) |
| TPR — L1+L2 only, no API key | 45.2% (85/188) |
| FPR — benign documents | 0.0% (0/110) |
| L1 latency p50/p99 | 0.03 ms / 0.53 ms |
| L2 latency p50/p99 | 11 ms / 70 ms |
| L3 latency p50/p99 | 1541 ms / 3499 ms |

These are measured from a public holdout eval, not cherry-picked. See `packages/eval/results/eval-2026-05-20-1017.md` for the full report.

## Demo site

**http://vaultmcp.io** — live leaderboard, threat feed, and scan demo (Base Sepolia).

This will move to vaultmcp.io when DNS is set up. For now the IP works.
