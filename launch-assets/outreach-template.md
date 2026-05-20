# Outreach Templates — Private Beta

Three variations. Pick by recipient. Personalize the bracketed parts. Keep it short.

---

## Template A — AI Security Researchers

Subject: Vault private beta — MCP prompt injection proxy

[Name],

I've been building a proxy that detects prompt injection in MCP tool responses before they reach the agent's context window. Three-layer detection: regex → embeddings → LLM judge. 99.5% TPR on a 185-entry holdout of published attack literature, 0.0% FPR on 110 benign documents. Numbers are reproducible from the public eval harness.

I'd value 20-30 minutes of your time running it against a real workflow and telling me what it misses. The known gaps are documented (multilingual, long-context dilution, cross-session multi-turn, image/audio) — I'm more interested in the ones I haven't found yet.

Install:
```
export ANTHROPIC_API_KEY=sk-ant-...
npx @vaultmcp/mcp-proxy@beta -- npx -y @modelcontextprotocol/server-filesystem /your/data
```

Beta guide: [link to BETA.md on repo]
Demo: http://vaultmcp.io

Please keep this private for now — not ready for public announcement yet.

[yv]

---

## Template B — MCP Server Authors

Subject: Vault beta — want your server on the leaderboard?

[Name],

I'm building a proxy that scans MCP tool responses for prompt injection. It sits transparently between the agent and any MCP server — zero config change to the server itself.

I'd like [server name] in the beta leaderboard. It takes ~10 minutes: install the proxy, run it for a bit, and I get real data on how it handles your server's actual output. You get a reputation score on Base Sepolia that will carry over to mainnet.

If your server has legitimate content that reads like an attack (e.g., security documentation, code that discusses injections), I especially want to know — that's the false positive surface I care most about.

Install:
```
npx @vaultmcp/mcp-proxy@beta -- <your server command>
```

Demo: http://vaultmcp.io
Beta guide: [link to BETA.md]

[yv]

---

## Template C — Crypto / On-Chain Dev Folks

Subject: Vault — on-chain reputation for MCP servers, private beta

[Name],

Quick context: MCP (Model Context Protocol) is how AI agents talk to tools — file systems, databases, APIs. Prompt injection through tool responses is the main attack surface. I've built a proxy that catches it.

The on-chain piece: every scan verdict is attested via EAS on Base. The proxy builds a public, append-only reputation score for each MCP server key. Operators can check a server's 30-day threat rate before connecting. The demo is running on Base Sepolia now — mainnet after public launch.

You'd be one of the first to have attestations on-chain. If you run any MCP servers or AI tooling, 10-20 minutes of install time would help a lot.

Demo: http://vaultmcp.io (live Sepolia leaderboard)
Install: `npx @vaultmcp/mcp-proxy@beta -- <your MCP server command>`
Beta guide: [link to BETA.md]

Keep it private until launch — I'll let you know when.

[yv]
