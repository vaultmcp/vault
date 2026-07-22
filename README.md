# Vault — MCP Prompt Injection Firewall

[![Guarded on Robinhood Chain](https://vaultmcp.io/badge/robinhood)](https://robinhoodchain.blockscout.com/address/0x89bf75bccea833fff371fa300f7c885b5c23f103)

**Site:** [vaultmcp.io](https://vaultmcp.io)  **·**  **X:** [@vaultmcp](https://x.com/vaultmcp)  **·**  **Repo:** [github.com/vaultmcp/vault](https://github.com/vaultmcp/vault)

Vault is a production prompt-injection firewall for MCP. It intercepts every tool response before your agent reads it and scans through four layers of detection (L0 deterministic decoder, L1 heuristics, L2 embedding similarity, L3 LLM judge).

## Quickstart

Wrap any MCP server — no config change to your agent:

```bash
# Set a key for full detection (or run without one for L1+L2 offline mode)
export ANTHROPIC_API_KEY=sk-ant-...

# Put Vault in front of any MCP server
npx @aimcpvault/mcp-proxy -- npx -y @modelcontextprotocol/server-filesystem /data
```

That's it — every tool response is now scanned before your agent sees it. Point your agent at the proxy instead of the server.

**Proof:** 100% TPR (80/80) on a frozen public holdout, 0.0% FPR on 100 benign docs — see [Measured performance](#measured-performance). How the four layers work: [How it works](#how-it-works). No key? Vault runs L1+L2 only — see [Offline mode](#offline-mode-no-api-key).

---

## Measured performance

All numbers below are reproducible from the harness committed in this repo. Each is footnoted with the commit and dataset it was measured on.

| metric | value | source |
|---|---|---|
| TPR — v2 holdout (L3 enabled, 80 attacks) | **100%** (80 / 80) · 95.5%+ lower bound at 95% CI | [^holdout-l3] |
| TPR — L1+L2 only, no API key | materially lower (L3 is required for production) | [^holdout-degraded] |
| False positive rate (benign flagged) | **0.0%** (0 / 100) | [^holdout-l3] |
| L1 latency (p50 / p99) | 0.02 ms / 0.04 ms | [^latency] |
| L2 latency (p50 / p99) | 8.86 ms / 15.11 ms | [^latency] |
| L3 latency (per call) | ~1.5–2 s (provider round-trip) | [^latency] |
| Sustained throughput (single proxy) | 100 req/s, 0 errors over 30,000 requests | [^load] |
| Steady-state memory (RSS) | 135–180 MB after warmup, no leak observed | [^load] |
| 500 KB response scan time | ~25 s (embedder-bound, see LIMITATIONS §14) | [^edge] |

[^holdout-l3]: `packages/eval/results/eval-clean-baseline-v2-L3-enabled-2026-05-21.md` — one-shot eval against v2 holdout constructed after detection code was frozen at commit `8d230e4`. Dataset: `packages/eval/datasets/holdout-v2-novel/` (50 attacks) + `packages/eval/datasets/holdout-v2-paraphrase/` (30 attacks) + `packages/eval/datasets/benign-v2/` (100 entries). L3 enabled (Anthropic Haiku 4.5). No tuning occurred between holdout construction and eval run.
[^holdout-degraded]: Without `ANTHROPIC_API_KEY`, Vault runs L1+L2 only. On the v2 novel holdout (attacks designed to sit outside L2's detection range) TPR is near 0%; on paraphrase attacks it is ~7%. L3 is the detection backbone for out-of-distribution attacks. See `packages/LIMITATIONS.md` §11 for offline-mode limitations.
[^load]: `packages/eval/load/report.md` — 100 req/s × 300 s × single stdio proxy instance × ~200-byte stub-MCP responses, L1+L2 only. Past 100 req/s the cliff is not yet measured.
[^latency]: `packages/eval/results/latency-baseline-2026-07-20.md` — L1/L2 measured on-device over 1,664 samples (public-corpus attacks + benign tool responses) by `packages/eval/src/latency-bench.ts`; reproduce with `cd packages/eval && npx tsx src/latency-bench.ts`. Hardware-dependent (measured on Apple Silicon). L3 is a single provider round-trip (Anthropic Haiku 4.5) — network-bound, not independently re-measured in this run.
[^edge]: `packages/proxy/test/edge-cases.test.ts` scenario 4. The latency is bounded by the L2 embedder iterating ~140 streaming chunks; L1 stays sub-millisecond at any size. See LIMITATIONS §14.

---

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

**Layer 1 — Heuristics** (see [Measured performance](#measured-performance)): Regex patterns for English instruction overrides, unicode tag smuggling (U+E0000–U+E007F), bidi-control characters (U+202A–U+202E, U+2066–U+2069), zero-width character density, HTML comment injection, long HTML-entity runs, and markdown link anchors. High-confidence matches short-circuit — no L2/L3 cost. L1 is English-only; see LIMITATIONS §1.

**Layer 2 — Embeddings** (see [Measured performance](#measured-performance)): Cosine similarity against a curated corpus of 31 attack categories using `bge-small-en-v1.5` (runs entirely on-device, no network call, ~30 MB WASM). Matches within distance 0.35 block; borderline cases escalate to L3. The corpus is intentionally public; adversaries who paraphrase past distance 0.35 evade L2 — that class is for L3.

**Layer 3 — LLM Judge** (~1.5–2 s per call, provider round-trip): Claude Haiku 4.5 (or GPT-4o-mini with OpenAI key) resolves ambiguous cases. Only runs when L2 is uncertain; the escalation rate depends on your traffic (see [Cost transparency](#cost-transparency)). Requires `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`. **Without a key, L3 is disabled and TPR drops to the L1+L2 number reported above.**

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

### Optional: on-chain attestation (opt-in)

When an operator opts in (`VAULT_ATTEST=1` + a funded hot wallet), scan verdicts can be attested on-chain via [EAS](https://attest.sh) on Base — currently **Base Sepolia** (testnet); Base mainnet is pending. Each MCP server then accumulates a public, append-only reputation score any agent can query before connecting. Off by default — no chain dependency for using the proxy.

> A continuous attestation feed and public reputation registry are planned for **v0.3**. The proxy supports opt-in attestation today for operators who want it; the always-on hosted attester ships alongside v0.3 once we have real install traffic to back the numbers.

---

## What Vault catches

With L3 enabled (Anthropic API key set), Vault catches 100% of attacks in our 80-entry public structural-generalization eval, at 0% false positive rate on 100 benign documents. Detection methodology and datasets are public — see `/packages/eval/`.

Breakdown by category (80 attacks, holdout-v2 structural-generalization eval, 2026-05-21):

| Attack category | Caught / Total | TPR |
|---|---|---|
| exfiltration | 60 / 60 | 100.0% |
| instruction_override | 13 / 13 | 100.0% |
| multi_turn_setup | 6 / 6 | 100.0% |
| encoded_payload | 1 / 1 | 100.0% |

Numbers are from `packages/eval/results/eval-clean-baseline-v2-L3-enabled-2026-05-21.md` with L3 enabled (Anthropic Haiku 4.5). Dataset: `packages/eval/datasets/holdout-v2-novel/` (50 attacks) and `packages/eval/datasets/holdout-v2-paraphrase/` (30 attacks), verified non-overlapping with the detection corpus. See [Measured performance](#measured-performance) for latency and throughput context.

---

## What Vault does NOT catch

- **User-initiated jailbreaks** — out of scope by design. Vault sits between the agent and the upstream MCP server, not between the user and the agent. Jailbreaks typed directly by the user are the model provider's responsibility, not a proxy's.
- **Genuinely novel injection patterns** — attacks that paraphrase far from all known examples (L2 cosine distance > 0.50 and no L3 key set) evade detection. The corpus covers published 2022–2024 attack literature; novel post-cutoff techniques may not be represented. See [`packages/LIMITATIONS.md`](packages/LIMITATIONS.md) §3.
- **Protocol-encoded data without L3** — MCP tools that return Pub/Sub messages, SQS payloads, binary blobs, or encrypted content will produce false positives when L3 is disabled (~40% FP rate on that traffic class). See LIMITATIONS §11.
- **Multi-turn attacks split across sessions** — Vault scans each MCP response independently. A sleeper directive established in session A and activated in session B is outside Vault's detection window. See LIMITATIONS §10.
- **Image/audio embedded instructions** — Vault is text-only. Binary content in tool responses (images, audio files, PDFs) is forwarded to the agent unscanned. If your MCP server returns image data or vision-model inputs, Vault provides no protection for instructions hidden in that content.

For the complete gap taxonomy: [`packages/LIMITATIONS.md`](packages/LIMITATIONS.md) — 15 sections covering multilingual, semantic, structural, normalization, self-referential, protocol-encoding, and scale gaps. [`packages/SECURITY_MODEL.md`](packages/SECURITY_MODEL.md) maps each gap to the threat it leaves open.

---

## Offline mode (no API key)

When `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` are both unset, Vault runs in offline mode:

- Layer 0 (decoder) and Layer 1 (heuristics) operate normally
- Layer 2 (embedding similarity) operates normally
- Layer 3 (LLM judge) is disabled

**Suitable for:**
- Development environments and local testing
- CI/CD pipelines where the agent isn't running production traffic
- Air-gapped or offline deployments

**NOT suitable for:**
- Production MCP servers returning Pub/Sub, SQS, or webhook payloads
- Tools that return binary content (images, encrypted blobs)
- Any deployment where false positive rate above 5% is unacceptable

See [LIMITATIONS §11](packages/LIMITATIONS.md) for specific FP measurements and rationale.

---

## Cost transparency

Layer 3 (LLM judge) calls Anthropic Haiku 4.5 only on responses that fall in L2's uncertain zone, so cost scales with the **L3 escalation rate** — there is no single fixed per-request cost. The formula:

**cost / request ≈ L3_rate × ~$0.0005** (Haiku 4.5 input + small output at current pricing).

| L3 escalation rate | cost / request | cost / 1,000 requests |
|---|---|---|
| 5% | ~$0.000025 | ~$0.025 |
| 20% | ~$0.0001 | ~$0.10 |
| 40% | ~$0.0002 | ~$0.20 |

On the adversarial eval holdout, escalation was **~91%** — by construction: every entry is built to sit in L2's uncertain zone. **Real-traffic escalation rate is unmeasured** until we have install telemetry; plug your observed rate into the formula above rather than trusting a guessed number.

- **$0 without an API key** — L1+L2 only. TPR drops to near 0% on novel out-of-distribution attacks and the FP rate on protocol-encoded traffic rises to ~40%. See [Offline mode](#offline-mode-no-api-key) above. The eval harness refuses to run in this mode unless `--allow-degraded` is passed explicitly.

The high L3 rate in our eval (91%) reflects an adversarial dataset — nearly every entry is an attack that lands in L2's uncertain zone by design. Real MCP traffic (mostly clean tool output) has a much lower L3 call rate.

Set `ANTHROPIC_API_KEY` before running. Without it, Vault emits a `WARNING: Layer 3 unavailable — degraded mode` message on startup and falls back to L1+L2 only.

---

## Why

Every MCP tool response is a direct write into your agent's context window. A malicious file, a compromised API, or a poisoned search result can redirect your agent mid-task — exfiltrating secrets, overwriting files, or pivoting to other tools. MCP has no transport-level protection against this class. Vault adds a layered detection pass; whether that pass is sufficient for your threat model depends on the gaps documented in [`packages/LIMITATIONS.md`](packages/LIMITATIONS.md).

## Requirements

Vault requires an LLM for Layer 3 in production. Three options:

- **Anthropic** (`claude-haiku-4-5-20251001`, recommended) — set `ANTHROPIC_API_KEY`
- **OpenAI-compatible** (`gpt-4o-mini`, or self-hosted via vLLM/llama.cpp) — set `OPENAI_API_KEY`
- **Ollama** (local, air-gapped) — set `OLLAMA_HOST=http://localhost:11434`

Without any of the above, Vault runs in offline mode (L1+L2 only). Offline mode has documented limitations — see [LIMITATIONS §11](packages/LIMITATIONS.md).

### Offline operation with Ollama

Ollama lets you run L3 locally with no cloud dependency — useful for air-gapped environments, development without an API key, and cost-sensitive pipelines.

```bash
# 1. Install Ollama and pull a model (one-time)
curl -fsSL https://ollama.ai/install.sh | sh
ollama pull llama3.2:3b

# 2. Run Vault with Ollama as the L3 backend
export OLLAMA_HOST=http://localhost:11434
npx @aimcpvault/mcp-proxy -- npx -y @modelcontextprotocol/server-filesystem /data
```

To use a different model or a remote Ollama instance:

```bash
export VAULT_LAYER3_PROVIDER=ollama
export VAULT_LAYER3_MODEL=mistral:7b
export VAULT_LAYER3_BASE_URL=http://gpu-box:11434
```

**Caveats:**
- Measured TPR numbers in this README are for Anthropic Haiku. Local 3B models vary; run the eval harness before relying on them in production. Anecdotally, `llama3.2:3b` has missed subtle role-hijack and multi-turn-setup attacks in smoke tests where Haiku catches them.
- Reachability is verified on the first scan, not at startup. If Ollama isn't running, Vault logs `vault: layer-3 failed (...)` per request and falls back to L1+L2.
- **Latency:** the default L3 timeout is 15s, sized to absorb the cold-start latency of local 3B models on CPU. If you're running on slower hardware or larger models, increase it further via `VAULT_LAYER3_TIMEOUT_MS=30000`. The first scan after Ollama loads the model can take much longer than steady-state — subsequent calls typically complete in 1–2s.
- **Security:** the default URL is `http://localhost:11434`. If you set `VAULT_LAYER3_BASE_URL=http://0.0.0.0:11434` or point to a remote host, tool response content (which may include sensitive data) is sent over the network to that host. Only point to a trusted, local-network Ollama instance.

---

## On-chain reputation inspector

`vault inspect` reads your Claude Desktop MCP config and reports the on-chain reputation Vault has accumulated for each server you have configured.

```bash
npx @aimcpvault/mcp-proxy inspect
# vault inspect (3 MCP servers)
#   config:   /Users/you/Library/Application Support/Claude/claude_desktop_config.json
#   network:  Sepolia (testnet)
#   contract: 0x3A977E4D8BA43367cc41BB4695feFF4615fec189
#
#   TRUSTED     filesystem [stdio:npx:@modelcontextprotocol/server-filesystem]
#               score=0.980 scans=412 blocks=2 maliciousRate=0.5%
#   NEW         git        [stdio:uvx:mcp-server-git]
#               score=1.000 scans=0 blocks=0 maliciousRate=0.0%
#   UNTRUSTED   sketchy    [stdio:npx:some-untrusted-pkg]
#               score=0.400 scans=83 blocks=14 maliciousRate=16.9%
```

**Trust thresholds (transparent, no magic numbers):**
- `TRUSTED`   score ≥ 0.95 AND totalScans ≥ 100
- `UNTRUSTED` maliciousRate ≥ 0.10
- `CAUTION`   totalScans ≥ 10 AND maliciousRate ≥ 0.01
- `NEW`       totalScans < 10

**Flags:**
- `--config <path>` override the Claude Desktop config path
- `--rpc <url>` and `--contract <addr>` point at a different network/deployment
- `--json` one JSON record per server (suitable for CI / scripts)
- `--strict` exit code 1 if any server is UNTRUSTED — useful in CI checks

The reputation contract today is on **Base Sepolia (testnet)**. Mainnet deployment is pending; the inspector will continue to default to Sepolia until mainnet is live, with a yellow warning printed on each run.

---

## Local scan history (opt-in)

Vault can persist every scan to a local SQLite database (`~/.vault/scans.db`) so you can review what was blocked, search by tool/server/verdict, and view a local dashboard.

**Off by default.** Enable with `VAULT_PERSIST=1`:

```bash
VAULT_PERSIST=1 npx @aimcpvault/mcp-proxy -- npx -y @modelcontextprotocol/server-filesystem /data
# vault: persisting scan history to /Users/you/.vault/scans.db (set VAULT_PERSIST=0 to disable)
```

**Query from the CLI:**

```bash
npx @aimcpvault/mcp-proxy history                          # last 50
npx @aimcpvault/mcp-proxy history --verdict malicious      # only blocks
npx @aimcpvault/mcp-proxy history --since 7d --json        # last week, JSON
npx @aimcpvault/mcp-proxy history --server stdio:npx:@modelcontextprotocol/server-filesystem
```

**Browse the dashboard:**

```bash
npx @aimcpvault/mcp-proxy dashboard
# vault dashboard: http://127.0.0.1:9876
```

Dark-themed single-page dashboard with verdict cards, per-day stacked bars (30 days), top tools, and a recent-scans table. Auto-refreshes every 5s (configurable via `--refresh <sec>`).

**Privacy guarantees:**
- Off by default — no data is written unless `VAULT_PERSIST=1` is set.
- All data stays local. The dashboard and history reader both serve `~/.vault/scans.db` directly; nothing is uploaded.
- Content previews are passed through a regex redactor before storage (API keys, GitHub/AWS tokens, JWTs, emails, SSN-shaped strings, credit-card-shaped numbers, generic `password:` / `token:` headers). This is a best-effort filter; if you need stronger guarantees, leave persistence off.
- 30-day rolling retention. Override with `VAULT_RETENTION_DAYS=<n>` (set to `0` to disable purging).
- Override the DB path with `VAULT_PERSIST_PATH=/path/to/scans.db`.

---

```bash
# Wrap any MCP server — zero config change to your agent
npx @aimcpvault/mcp-proxy -- npx -y @modelcontextprotocol/server-filesystem /path/to/data
```

---

## Install

```bash
# npm / npx (no install required)
npx @aimcpvault/mcp-proxy -- <your MCP server command>

# or install globally
npm install -g @aimcpvault/mcp-proxy
mcp-proxy -- npx -y @modelcontextprotocol/server-filesystem /data
```

### Claude Code / Claude Desktop integration

The fastest way is `vault init` — it auto-detects your existing MCP configs and wraps each server with the proxy:

```bash
npx @aimcpvault/mcp-proxy && vault-init
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
        "@aimcpvault/mcp-proxy",
        "--",
        "npx", "-y", "@modelcontextprotocol/server-filesystem", "/path"
      ]
    }
  }
}
```

### Check a server's reputation

The `vault-check` binary ships inside the proxy package — no separate install needed:

```bash
# already installed if you have @aimcpvault/mcp-proxy
npx --package=@aimcpvault/mcp-proxy@next vault-check stdio:npx:@modelcontextprotocol/server-filesystem
npx --package=@aimcpvault/mcp-proxy@next vault-check --all     # scores every server in your MCP config(s)
npx --package=@aimcpvault/mcp-proxy@next vault-check --json | jq .
```

A standalone `vault-check` binary (Homebrew tap, curl-piped install script) is planned for **v0.3** once we ship signed releases on GitHub.

Reputation comes from EAS attestations on Base (currently Base Sepolia testnet; mainnet pending), aggregated across every Vault deployment that scans the same server. Score range 0–1000 (higher = safer). The opt-in attestation path is documented above under "Optional: on-chain attestation"; a continuous public feed lands with v0.3.

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
npx @aimcpvault/mcp-proxy --transport http \
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

# On-chain attestation (opt-in, off by default — full hosted feed lands in v0.3)
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
  proxy/          # @aimcpvault/mcp-proxy — the core proxy (this is what you install)
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

The headline numbers come from the v2 holdout, constructed after detection code was frozen: `packages/eval/datasets/holdout-v2-novel/` (50 novel attacks) + `packages/eval/datasets/holdout-v2-paraphrase/` (30 paraphrased attacks) = 80 attacks, plus `packages/eval/datasets/benign-v2/` (100 benign entries). Each has a `MANIFEST.md` describing provenance. (The earlier v1 set, `packages/eval/datasets/holdout-attacks-burned-v1/`, is retired — it was used to motivate contaminated work; see the postmortem.)

**Operators are encouraged to author their own attacks and submit pull requests.** Add a new file under `packages/eval/datasets/holdout-v2-novel/` following the existing JSON schema, update the `MANIFEST.md`, and open a PR. The harness picks new files up automatically.

The self red-team (`packages/eval/red-team/`) is the other half of the honest-eval story: 38 hand-crafted bypass attempts, 9 of which still pass L1+L2 after our P2 fixes. They are categorized in [`packages/LIMITATIONS.md`](packages/LIMITATIONS.md).

---

## Development

```bash
# Prerequisites: Node 20+, pnpm 9+, Foundry 1.7+ (for contracts only)

# Install
pnpm install

# Run proxy in dev mode (wraps the MCP filesystem server)
pnpm --filter @aimcpvault/mcp-proxy dev -- npx -y @modelcontextprotocol/server-filesystem /tmp

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

Vault is a defense-in-depth layer, not a complete solution. No regex or embedding model catches every attack — adversaries can craft payloads that evade any single detection strategy. Measured detection on our public v2 holdout is **100% TPR / 0.0% FPR** (80 attacks, L3 enabled, 95.5%+ lower bound at 95% CI). Without L3, TPR is near 0% on novel out-of-distribution attacks — L3 is the detection backbone. The layered approach raises the bar; operators should treat Vault as one layer in a broader security posture.

For details:
- [`packages/LIMITATIONS.md`](packages/LIMITATIONS.md) — measured gaps, red-team evidence, and which mitigations are planned vs. accepted.
- [`packages/SECURITY_MODEL.md`](packages/SECURITY_MODEL.md) — threats Vault defends against, threats it does not, assumptions, and what an attacker still has to do.
- [`SECURITY.md`](SECURITY.md) — vulnerability reporting policy.

To report a vulnerability: open a [GitHub Security Advisory](../../security/advisories/new) (preferred) or email the maintainer directly. We aim to triage within 48 hours and ship a patch within 7 days of a confirmed critical.

---

## License

MIT
