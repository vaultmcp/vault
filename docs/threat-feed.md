# How the threat feed works (and why it's honest)

The "recent attacks blocked" panel on vaultmcp.io shows real scan verdicts produced by the
published proxy — not a scripted animation, and not events written directly to the feed.

## Seeding a new deployment

A brand-new collector has an empty feed. `scripts/seed-launch-traffic.mjs` primes it, and
every event it produces is a **real detection**:

- It picks attack payloads from the **public** detection corpus
  (`packages/corpus/injection-patterns.json`) and synthesizes a handful of plausible benign
  tool responses (weather, file listings, HTTP status, commit notes). It **never** reads any
  holdout/eval dataset — corpus only, per the
  [contamination postmortem](../POSTMORTEM-2026-05-20-contamination.md).
- It writes them as real files, then spawns the **published npm proxy**
  (`@aimcpvault/mcp-proxy@next`) wrapping `@modelcontextprotocol/server-filesystem`.
- It drives real `read_file` tool calls through the proxy. The proxy genuinely scans each
  response and POSTs the resulting telemetry. **There is no direct write path to the feed** —
  every row corresponds to a verdict the detector actually produced.

So the panel is "here is the detector running against known-public payloads," not "here is
live attacker traffic in the wild." Seeded bring-up events age off as real traffic arrives.

## Feed transport

Browsers do not hit the collector directly (that trips mixed-content + CORS). The client
fetches the same-origin Next.js `/api/feed` route, which proxies to the collector
server-side. If the panel is empty, check that route and the collector — not the browser
console (transport errors are logged to devtools only, not surfaced to visitors).
