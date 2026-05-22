# Morning launch checklist — v0.2.0-rc.1

Walk this top-to-bottom. Each step has the exact command, the expected output, and a "fail
mode" line in case it doesn't return what's described.

State at end of overnight sprint (for reference):
- npm `@aimcpvault/mcp-proxy@next` → `0.2.0-rc.1` (gitHead empty, see NOTES_FOR_YV.md)
- Git tag `v0.2.0-rc.1` → commit `7045d7a` on `origin/main`
- Demo site (vaultmcp.io) — ECS rollout in progress at sprint end; verify in Section A
- Repo `vaultmcp/vault` still **private**

Sequence: A → B → C → D → E. Expected total time first-pass: ~45 min.

---

## A. Sanity checks (5 min)

### A1. Live demo site is up

```
curl -I https://vaultmcp.io | head -3
```
Expect `HTTP/2 200`.
**Fail mode:** if 502/503/504 — ECS task is unhealthy. Jump to `launch-commands.md` § "ECS
force-restart". If 404 — DNS issue, page yv's network/Cloudflare/Vercel-side config.

### A2. Live site reflects the v0.2 copy revisions

```
curl -s https://vaultmcp.io/ > /tmp/morning-site.html
echo "every catch becomes...    $(grep -c 'every catch becomes an attestation' /tmp/morning-site.html)  (want 0)"
echo "LLM-grade detection...    $(grep -c 'LLM-grade detection at MCP scale' /tmp/morning-site.html)    (want 1+)"
echo "Stop prompt injection...  $(grep -c 'Stop prompt injection in MCP' /tmp/morning-site.html)        (want 1+)"
echo "buildonvault refs...      $(grep -ci 'buildonvault\\|build-on-vault' /tmp/morning-site.html)      (want 0)"
echo "counterstrip refs...      $(grep -ci 'counterstrip' /tmp/morning-site.html)                       (want 0)"
echo "95.5...                   $(grep -c '95.5' /tmp/morning-site.html)                                (want 1+)"
```
**Fail mode:** if "LLM-grade detection..." is still 0 after the rollout — the overnight
ECS rollover didn't pick up the new image. Run `launch-commands.md` § "Demo site
force-redeploy" with the existing `latest` ECR image (which is the correct amd64 build, just
needs ECS to pull it again).

### A3. npm @next still resolves to 0.2.0-rc.1

```
npm view @aimcpvault/mcp-proxy dist-tags
```
Expect `{ latest: '0.1.0-beta.2', beta: '0.1.0-rc.1', next: '0.2.0-rc.1' }`.
**Fail mode:** if `next` field is missing or different — someone (you, npm support, or the
@aimcpvault account) modified dist-tags overnight. Stop and investigate before flipping the
repo public.

### A4. Cold install works on a fresh box

```
mkdir -p /tmp/morning-check && cd /tmp/morning-check
NO_COLOR=1 npx --yes @aimcpvault/mcp-proxy@next --help | head -10
```
Expect the help banner starting with `vault mcp-proxy — scans MCP tool responses...`.
**Fail mode:** if the npx install errors — paste the full output into NOTES_FOR_YV.md and
stop. Don't tweet a broken install command.

### A5. GitHub repo health (any unexpected activity overnight?)

```
gh auth switch -h github.com -u elytrasec-lang   # in case Claude Code left it on yvasisht
gh repo view vaultmcp/vault --json visibility,pushedAt,defaultBranchRef
gh api repos/vaultmcp/vault/issues?state=open --jq 'length'
gh api repos/vaultmcp/vault/commits --jq '.[0].sha + " " + .[0].commit.message[:60]'
```
Expect: `visibility=PRIVATE`, latest commit = `7045d7a chore: bump version to 0.2.0-rc.1`,
0 open issues.
**Fail mode:** if visibility is already PUBLIC — someone flipped it. Fine, but verify the
content is what you intended before tweeting.

### A6. ECS task health (read-only)

```
aws ecs describe-services --cluster vaultmcp --services demo-site \
  --query 'services[0].{desired:desiredCount,running:runningCount,rollout:deployments[0].rolloutState}' \
  --output table
```
Expect `desired=1, running=1, rollout=COMPLETED`.
**Fail mode:** if rollout is still IN_PROGRESS hours after the overnight sprint — open
CloudWatch for the task and look at events. The most common cause was an arch mismatch
(arm64 vs amd64); the v0.2.0-rc.1 image has been confirmed amd64 multi-arch.

### A7. EC2 collector + demo backend health

```
ssh -i ~/.ssh/elytrasec-key.pem ubuntu@98.80.190.10 'pm2 list'
```
Expect both `vault-collector` and `vault-demo` `online`. Restart count should be low
single digits (sprint-time restarts only).
**Fail mode:** if either is `errored` or restart count is >20 — tail logs:
```
ssh -i ~/.ssh/elytrasec-key.pem ubuntu@98.80.190.10 'pm2 logs vault-collector --lines 50 --nostream'
```

---

## B. Repo public flip (1 min)

**Pre-flight, one last time:**

```
gh repo view vaultmcp/vault --json visibility
# expect "PRIVATE"
git log --oneline | head -5
# top commit should be 7045d7a chore: bump version to 0.2.0-rc.1
```

**Option 1: GitHub web UI** (recommended — gives you the typed-confirmation safety net)

1. Open `https://github.com/vaultmcp/vault/settings`
2. Scroll to bottom → **Danger Zone**
3. Click **"Change repository visibility"**
4. Select **"Make public"**
5. Type `vaultmcp/vault` to confirm
6. Click **"I understand, change repository visibility"**

**Option 2: gh CLI** (faster, no typed confirmation)

```
gh repo edit vaultmcp/vault --visibility public --accept-visibility-change-consequences
```

**Verification (run both, regardless of which option above):**

```
# README is publicly fetchable without auth
curl -s https://raw.githubusercontent.com/vaultmcp/vault/main/README.md | head -3

# Repo lists in unauthenticated context
curl -s https://api.github.com/repos/vaultmcp/vault | jq '{visibility, stargazers_count, public}'
```
Expect README first 3 lines + `visibility: "public", public: true`.

**Fail mode:** if the README curl returns "404 not found" — wait 30s (GitHub propagation)
and retry. If still 404 after 2 min, the visibility change didn't take. Re-run via the web UI.

---

## C. Reviewer DM sequence (20–30 min)

Goal: 5–10 trusted reviewers get a heads-up before the public tweet, so the first 30 min
of post-tweet eyes have real testers among them, not just lurkers.

**Recommended ordering:**

1. **Tier 1 (highest trust, send first, 5-min stagger between):** people who'll dig into the
   eval methodology and the postmortem — security researchers, MCP-aware infra folks. Two
   personalized sentences each. Ask: "any glaring methodology gaps? adversarial test welcome."
2. **Tier 2 (medium trust, send in batch):** MCP server authors. Same template, single batch.
   Ask: "would the reputation badge be useful on your repo? attestation is opt-in for v0.2,
   continuous feed lands v0.3."
3. **Tier 3 (broader awareness, send last):** AI/agent dev twitter folks who'd amplify. Lighter
   ask: "release dropped today, would value your eye on the install UX."

**Skeleton DM template (personalize per recipient):**

> hey [name] — shipped v0.2 of vault tonight. it's a prompt-injection firewall for MCP that
> drops in front of any tool server. 100% TPR on a public 80-attack holdout (95.5%+ CI),
> 0% FPR. one-line install: `npx @aimcpvault/mcp-proxy@next demo` shows the four-layer
> cascade in 30s.
>
> repo just went public: https://github.com/vaultmcp/vault
> site: https://vaultmcp.io
>
> [personalized ask here — one sentence specific to them]
>
> tweet is going out at [time] — would value your eye before then if you have a few min.

**Personalized ask suggestions by recipient lens:**
- **Adversarial researcher:** "the holdout is in `packages/eval/datasets/holdout-v2-*/`.
  I'd value any false-negative you can find — happy to add to a public hall-of-fame if
  novel."
- **MCP server author:** "if you maintain an MCP server, `vault inspect` already reads
  your config and reports an on-chain reputation score. Reputation feed itself is sparse
  until v0.3 — flagging upfront."
- **Methodology hawk:** "the eval contamination postmortem is at
  `packages/POSTMORTEM-2026-05-20-contamination.md`. We caught and reverted a 90.3%
  contaminated result before launch. Would value your read on whether the disclosure is
  adequate."
- **Install-UX folks:** "the npx install on a clean box takes ~15s including the
  `better-sqlite3` prebuild. Any breakage on your platform → I want to know in the first hour."

---

## D. Launch tweet (10 min)

Three variants live in `launch-assets/launch-tweet-variants.md` (A direct technical /
B artifact-first / C methodology-forward). Pick one — A is the safe default if you can't decide
in 60 seconds. Skim the others for stealable lines.

**Timing recommendation:**
- Tuesday–Thursday, 9–11am PT is the highest-engagement window for security/infra twitter.
- If today is Friday/weekend, hold for Tuesday unless something's forcing the date.
- Whenever you tweet, **post when you can be available for the next 4–6 hours** to answer
  replies. A launch tweet with delayed answers reads like the project is abandoned.

**Pre-tweet:**
1. Pin the launch tweet to your profile.
2. Update your bio one-liner to match the launch framing if it doesn't already.
3. Have the GitHub repo open in a tab so you can quickly link to specific files when asked.

**Post-tweet:**
- Reply-thread immediately (don't wait): paste the three follow-up tweets from
  `launch-tweet-variants.md` as a thread.
- Quote-tweet your own post 2-3 hours later with the first piece of feedback ("a user found X,
  here's what we shipped to address it") to keep it in the timeline.

---

## E. First-hour monitoring

Open these in tabs before tweeting:

| signal | how to watch |
|---|---|
| npm install errors | `npm view @aimcpvault/mcp-proxy time` (every 30 min — new install pings show up as date entries) |
| GitHub stars / forks / issues | `gh repo view vaultmcp/vault --json stargazerCount,forkCount,issues` (every 5 min for first hour) |
| Twitter mentions | search `vaultmcp.io OR @aimcpvault OR "vault mcp"` in twitter search, sort by Latest |
| Demo site error rate | `aws logs tail /ecs/vaultmcp-demo-site --follow --since 10m` (live) |
| ECS task crashes | `aws ecs describe-services --cluster vaultmcp --services demo-site --query 'services[0].events[0:5]'` |
| Twitter DMs | watch the @aimcpvaultbase account directly |

**Things that warrant an immediate quote-reply tweet:**
- Someone posts a false negative → "Caught! fix lands in v0.2.1 by EOD" (only if it's
  actually fixable that fast — see `incident-runbook.md` § 1)
- Someone posts a false positive → "Reproduced. PR up at <link> in 30 min" (same caveat)
- A reviewer publicly endorses methodology → quote-tweet, lightweight thanks
- Someone misrepresents what the product does → factual reply, no defensive edge

**Things that do NOT warrant a reply:**
- Generic hot-takes on "AI security is hopeless" or similar
- Comparisons to products that aren't actually competitors
- People asking when mainnet contract deploys → "v0.3, weeks not days" and move on

---

## What `done` looks like at the end of the morning

- vaultmcp.io live with new copy + the install command on the hero
- npm install works on a clean box
- Repo is public, README renders on github.com/vaultmcp/vault
- 5–10 reviewer DMs sent
- Launch tweet posted + replied-to thread
- First-hour monitoring active
- Coffee
