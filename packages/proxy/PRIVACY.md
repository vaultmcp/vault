# What Vault collects

Vault's defense gets stronger as more deployments contribute attack data to a shared feed. That feed is opt-out: telemetry is on by default when a collector URL is configured, off when `VAULT_TELEMETRY=0` is set, and a banner prints to stderr on first run so it is never silent.

## What we collect

For every scan, capability decision, and manifest verdict:

- **`contentHash`** — SHA-256 of the tool output, never the raw content
- **`argsHash`** — SHA-256 of the tool-call arguments, never the raw args
- **MCP server URL** as captured by the proxy (`stdio:filesystem`, `https://mcp.example.com`). Set `VAULT_TELEMETRY_REDACT_SERVERS=1` to send a SHA-256 of this instead.
- **Tool name** (`read_file`, `http_get`) — public protocol surface
- **Verdict** (`clean` / `suspicious` / `malicious`), confidence, layer that fired, matched pattern labels
- **Latency** of detection
- A random per-process **install id** (or a hashed stable id if `VAULT_TELEMETRY_INSTALL_ID` is set)

## What we never collect

- **Raw tool output content** — only its SHA-256
- **Raw tool-call arguments** — only their SHA-256
- **User prompts or agent reasoning** — Vault does not see these
- **API keys, credentials, environment variables** — proxy never reads them
- **Filesystem paths beyond what appears as a `toolName`**
- **Personally identifying information** — by design

## How to disable

Either of these turns telemetry off completely:

```
export VAULT_TELEMETRY=0
# or, unset the collector URL:
unset VAULT_TELEMETRY_URL
```

When telemetry is implicitly enabled, Vault prints one line to stderr on first run noting this and pointing here. No further notifications.

## Where it goes

Events are POSTed in batches of up to 100 (or every 5s, whichever first) to `VAULT_TELEMETRY_URL`. The endpoint is operator-controlled; for the public Vault network it points at our collector. Failures are dropped silently (logged once per 60s); proxy operation never blocks on telemetry.

## What the data is used for

- The public threat feed (recent attacks blocked across the network)
- Per-MCP-server reputation grounding (combined with on-chain attestations)
- Adding novel attack variants to the Layer 2 corpus so every deployment benefits
- Nothing else. No third-party sharing, no advertising, no profiling.
