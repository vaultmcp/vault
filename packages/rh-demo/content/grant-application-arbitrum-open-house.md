# Arbitrum Open House / Robinhood Chain builder grant — application (draft)

Context: Robinhood committed $1M to builders via the 2026 Arbitrum Open House program
(buildathons + Founder Houses; the London stop ran ~$300K in prizes/grants, application-only).
Target that program and/or the Arbitrum Foundation grants. Fill bracketed fields before sending.

---

## Project: Vault — prompt-injection defense for on-chain AI agents

**Team:** [names, roles, prior work — keep it short and credible]
**Contact:** [email] · [@handle] · [repo]
**Amount requested:** [$X] over [N] months
**Category:** Security infrastructure / developer tooling

### The problem (why now)

Robinhood Chain shipped **agentic trading** at mainnet — AI agents that execute swaps of
tokenized equities. Agents decide by reading tool responses: token metadata, price quotes,
routing notes. Every one of those fields is attacker-influenceable (deployer calldata,
malicious aggregators, third-party feeds), and language models don't cleanly separate "data"
from "instructions." A prompt injection hidden in a tool response can redirect a swap or
trigger a malicious approval — inside a flow the user explicitly authorized. As agentic
trading scales on Arbitrum-stack chains, this becomes systemic.

### What we're building

Vault is a drop-in MCP proxy that scans every tool response for prompt injection before the
agent reads it — one command to adopt, chain-agnostic:
```
npx @aimcpvault/mcp-proxy -- <trading MCP server>
```
Layered detection: deterministic decode + heuristics (zero-config, catch blatant attacks) →
semantic embeddings → an LLM-judge layer for subtle, keyword-free injections. Verdicts are
auditable, and on the roadmap we anchor attestations of scanned traffic to Base via EAS.

### Proof it works (already shipped)

We built and open-sourced a runnable demo (`packages/rh-demo`) that stages the attack on a
Robinhood-Chain-shaped trading flow — terminal and browser, with a stepped animated player.
Measured result with the LLM-judge enabled: a trading agent is hijacked 2/2 on poisoned
tokens un-guarded; with Vault in front, **0/2 hijacked** — the blatant injection blocked by
heuristics, the subtle one by the judge, with no false positives on clean tokens. Live on npm
today.

### What the grant funds

- [ ] A reference **Robinhood Chain trading-agent integration** (real testnet RPC, USDG,
      Uniswap addresses) so any team can wrap their agent in an afternoon.
- [ ] Hardening + throughput work for production trading latency.
- [ ] Public **attack corpus + benchmark** for agentic-trading injection, so the ecosystem
      has a shared bar. (We hold ourselves to honest, non-contaminated evaluation.)
- [ ] Docs, examples, and an ecosystem-directory-ready package.

### Why us / why fund it

Security infrastructure is a public good for the chain: one hijacked agentic-trading flow is
a headline that chills adoption for everyone. Vault is already live, chain-agnostic, and
one-command to adopt — a grant turns a working demo into the default safety layer for
agentic trading on the Arbitrum stack.

### Milestones

1. **[M1]** Robinhood Chain testnet reference integration + docs.
2. **[M2]** Public injection benchmark + published results.
3. **[M3]** Production hardening + ecosystem-directory launch.

*Honesty note: we deliberately make no single blanket "detection %" claim; we publish
per-layer results including misses. This came out of a prior eval-contamination lesson and
is now a core practice.*
