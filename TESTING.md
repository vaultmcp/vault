# Testing Vault (pre-launch)

Vault is a prompt-injection firewall for MCP. Nothing to clone or build — the package is
public on npm, so a tester needs only these commands.

## Try it in ~15 minutes

```bash
# 1. Watch the detection layers run against canned attacks
npx @aimcpvault/mcp-proxy@latest demo
#    optional: export ANTHROPIC_API_KEY=sk-ant-...   # enables the L3 LLM-judge layer

# 2. Put Vault in front of any MCP server your agent uses — zero agent config change
npx @aimcpvault/mcp-proxy@latest -- npx -y @modelcontextprotocol/server-filesystem /data

# 3. (if you run a trading agent) try the trade guard
VAULT_TRADE_GUARD=1 VAULT_TRADE_ALLOWLIST=0xYourWallet \
  npx @aimcpvault/mcp-proxy@latest -- <your trading MCP server>
```

A recording of step 1 is in [`docs/vault-demo.cast`](docs/vault-demo.cast) (asciinema
format — `asciinema play docs/vault-demo.cast`).

## What we'd love feedback on

Three specific things — naming them turns "cool" into usable signal:

1. **False positives** on your real tool traffic — anything benign that got flagged.
2. **README confusion** — anything unclear or that made you bounce.
3. **Demo clarity** — does `npx @aimcpvault/mcp-proxy@latest demo` make sense in under a minute?

## Where to send it

- **Bugs / feedback:** <https://github.com/vaultmcp/vault/issues>
- **Security / vulnerabilities:** security@vaultmcp.io (see [SECURITY.md](SECURITY.md))
- **Code + eval methodology:** <https://github.com/vaultmcp/vault> — the eval holdout,
  benign set, limitations, and the contamination postmortem are all public.

## Good to know

- **No API key?** Vault runs L1+L2 only (offline mode). Detection of novel attacks drops
  sharply without L3 — this is documented, not hidden. See the README's Offline mode section.
- **It's a transparent proxy.** Your agent talks to Vault instead of the server; every tool
  response is scanned before your agent reads it. No data is stored or forwarded by default.
