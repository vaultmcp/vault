# Robinhood Chain — ecosystem directory submission (draft)

Submit at: https://robinhood.com/us/en/chain/ecosystem/ (find the "add your project" /
partner form). Fill the bracketed fields before sending.

---

**Project name:** Vault

**Category:** Security / Developer infrastructure

**One-liner:** A drop-in security proxy that stops prompt-injection attacks against AI
trading agents — the exact threat that ships with agentic trading.

**What it does (2–3 sentences):**
Vault sits in front of any MCP (Model Context Protocol) server as a proxy and scans every
tool response for prompt injection *before* an AI agent reads it. On Robinhood Chain, that
means a poisoned token description, price quote, or routing note can't hijack an agent into
redirecting a swap or approving a malicious allowance. It's one command to adopt and
chain-agnostic — it protects the agent, not the chain.

**Why it matters for Robinhood Chain:**
Robinhood Chain launched agentic trading — AI agents executing swaps of tokenized equities.
An agent that trades is an agent that reads attacker-influenceable tool output (deployer
metadata, aggregator quotes, third-party feeds). That is a direct, high-value prompt-injection
surface. Vault is the security layer for it, and we've published a runnable demo staging the
attack and the defense on a Robinhood-Chain-shaped trading flow.

**How developers use it:**
```
npx @aimcpvault/mcp-proxy -- <their trading MCP server>
```
Layered detection: deterministic decode + heuristics catch blatant injections with zero
config; an optional LLM-judge layer (bring your own model key) catches subtle, keyword-free
ones. Every verdict is auditable.

**Links:**
- Website: https://vaultmcp.io
- npm: https://www.npmjs.com/package/@aimcpvault/mcp-proxy
- Demo (agentic-trading injection, terminal + browser): [repo link — vaultmcp/vault, packages/rh-demo]
- Docs / repo: [link]

**Status:** Live on npm. Detection pipeline shipping; Base/EAS attestation on the roadmap.

**Team contact:** [name] · [email] · [@handle]

**Honest scope note (keep for our own records, trim for the form):** we make no single
"detection rate" claim — layered detectors behave differently on blatant vs. subtle attacks,
and the demo reports exactly what each layer catches, including what it misses in degraded
mode. That transparency is a feature we lead with.
