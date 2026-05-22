# Launch tweet variants — v0.2.0-rc.1

Three variants. Pick one in the morning. Each is a main tweet (≤280 chars) followed by a
3–5-tweet reply thread.

**Style rules (apply to all):**
- Lowercase where it matches the site aesthetic.
- No "AI-powered" / "next-generation" / "Cloudflare for X".
- The `95.5%+` CI lower bound must appear in the main tweet OR the first reply.
- The "open methodology / public postmortem" line should appear in the thread.
- Link to `vaultmcp.io` first, github second (the site has the install command above the fold).

---

## Variant A — Direct technical (default, safe)

**Framing rationale:** lead with the product description, the install command, and the
number. The reader knows what it is, how to try it, and what to expect within 280 chars.
Most likely to surface in technical-twitter algorithms.

### Main tweet (270 chars)

> vault is a drop-in prompt-injection firewall for MCP. it sits in front of any mcp server
> and scans every tool response before your agent reads it.
>
> 100% TPR · 0% FPR on a public 80-attack holdout (95.5%+ CI lower bound).
>
> npx @aimcpvault/mcp-proxy@next demo
>
> vaultmcp.io

### Reply thread

**Reply 1/4** — what it actually does (problem framing):

> agents are starting to read tool outputs they didn't write. a malicious file, a poisoned
> web page, a tampered DB row — any of these can hijack the agent through the mcp channel.
> vault is the firewall layer that wasn't there.

**Reply 2/4** — how it works:

> four layers, each one cheaper than the last:
> L0 — deterministic decoder (base64, hex, html-entity)
> L1 — regex heuristics
> L2 — embedding similarity to a 200-entry corpus
> L3 — LLM judge (anthropic, openai, or local ollama)
> the cost-gating keeps it affordable per request.

**Reply 3/4** — methodology + postmortem:

> we caught and reverted an eval contamination incident before launch — postmortem is in
> the repo. the 100% number is from a v2 holdout built *after* detection code was frozen.
> methodology rigor is the differentiator, not the number.
>
> packages/POSTMORTEM-2026-05-20-contamination.md

**Reply 4/4** — install + community:

> one command, zero config change to your agent:
> npx @aimcpvault/mcp-proxy@next -- npx -y @modelcontextprotocol/server-filesystem /path
>
> open source · MIT · github.com/vaultmcp/vault
> bypass reports welcome — see incident-runbook for what to expect.

---

## Variant B — Artifact-first (lead with the install)

**Framing rationale:** the install command is the artifact. People who'd install something
will install it; people who wouldn't won't. Skips the abstract pitch entirely. Higher
conversion from technical readers, lower from broader twitter.

### Main tweet (250 chars)

> npx @aimcpvault/mcp-proxy@next demo
>
> 30 seconds. you'll see vault catch four classes of prompt injection through MCP — regex,
> embeddings, LLM judge, deterministic decoder for encoded payloads.
>
> 100% on a public 80-attack holdout (95.5%+ CI).
>
> vaultmcp.io

### Reply thread

**Reply 1/4** — why MCP specifically:

> every modern agent reads tool responses. claude desktop, cursor's MCP tabs, custom
> harnesses — they all consume content the agent didn't write. that's the prompt-injection
> surface. vault scans that surface, not the LLM's own output.

**Reply 2/4** — the cost story:

> the layered cascade matters. L0+L1+L2 handle ~95% of requests for ~12ms. only the
> ambiguous ones escalate to the L3 LLM judge. it stays affordable per request even on
> high-traffic MCP servers.

**Reply 3/4** — methodology:

> the eval is public. holdout sets, manifests, benign-v2 set, the limitations file, and
> the postmortem from when we caught our own eval contamination — all in the repo.
> if the numbers don't reproduce, we want to know.

**Reply 4/4** — install paths + scope:

> stdio (wrap any local mcp server): `npx @aimcpvault/mcp-proxy@next -- <command>`
> http (proxy a remote server): `--transport http --upstream <url>`
> works with anthropic, openai, or fully offline with ollama.
>
> github.com/vaultmcp/vault

---

## Variant C — Methodology-forward (lead with the postmortem)

**Framing rationale:** the postmortem is genuinely unusual — most security tools don't
publish their methodology failures. Leading with it positions Vault as "the project that
takes eval seriously," which is the deepest moat the product has against hand-wavy
competitors. Highest signal to the methodology-hawk audience. Riskier — some readers will
focus on "you contaminated your eval" without reading further.

### Main tweet (278 chars)

> we caught ourselves contaminating our own prompt-injection eval — TPR jumped 45% → 90%
> in one session because we'd tuned on the holdout. reverted the code, retired the holdout,
> rebuilt clean.
>
> the clean number on v2: 100% TPR / 0% FPR (95.5%+ CI).
>
> postmortem + product: vaultmcp.io

### Reply thread

**Reply 1/4** — what vault is (the deferred pitch):

> vault is a drop-in firewall for MCP — sits in front of any tool server, scans every tool
> response before your agent reads it. four layers, L0–L3. open source, MIT.
> npx @aimcpvault/mcp-proxy@next demo

**Reply 2/4** — the methodology details:

> the v2 holdout was built *after* detection code was frozen at a specific commit. corpus
> sources are public and per-entry. no eval-engineer reads the miss list. every holdout
> retires after one measurement cycle.
>
> packages/eval/README.md

**Reply 3/4** — why this matters:

> security tools that don't publish methodology are unfalsifiable. if you can't
> reproduce the number, the number isn't a number. the postmortem is in the repo for
> exactly this reason — if we'd hidden it, you'd never know the rigor was real.
>
> packages/POSTMORTEM-2026-05-20-contamination.md

**Reply 4/4** — install + adversarial welcome:

> we want bypass reports. if vault misses a real attack on your mcp server, file an issue;
> we triage publicly and the fix lands in a release, never silently in the corpus.
>
> github.com/vaultmcp/vault
> npx @aimcpvault/mcp-proxy@next demo

---

## Pre-tweet checklist (for all three variants)

- [ ] `vaultmcp.io` returns 200 and shows the new copy (see morning-launch-checklist.md § A)
- [ ] `npm view @aimcpvault/mcp-proxy dist-tags` shows `next: '0.2.0-rc.1'`
- [ ] Repo is public; `https://github.com/vaultmcp/vault` loads without auth
- [ ] You're at a laptop for the next 4–6 hours to answer replies
- [ ] Twitter bio updated to match (if you want to)
- [ ] Replies queued in a draft (copy from the variant above)
- [ ] Pin the main tweet immediately after posting

---

## Quote-tweet candidates (post-launch, 2–4 hours later)

These re-amplify the launch without spamming:

- *"first install (~2h in): X people through the demo, Y stars, Z issues — appreciate the
  early eyes. one false-positive report already triaged, fix landing in v0.2.1 by EOD."*

- *"answering the question several people asked: yes, the proxy works without any LLM
  API key — it just runs L0+L1+L2. set `ANTHROPIC_API_KEY` or `OLLAMA_HOST` for full
  detection. docs are explicit about this."*

- *"someone asked how the corpus is curated. every entry has a `source` field citing
  public literature, never a holdout entry ID. you can see the breakdown:
  `jq '[.[].source] | group_by(.) | map({source: .[0], count: length}) | sort_by(.count) | reverse' packages/corpus/injection-patterns.json`"*

---

## Things to NOT tweet (for at least the first week)

- Don't pre-announce v0.3 milestones (mainnet deploy, attester, etc.). Underpromise.
- Don't quote-tweet competitors. Not yet.
- Don't engage with rant-style criticism. Reply to specifics, ignore vibes.
- Don't promise dates you can't hit.
- Don't tweet during incident response. Fix the bug, then post the after-action.
