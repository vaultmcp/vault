# Pre-Launch Audit — VaultMCP
**Date:** 2026-05-21  
**Auditor:** Claude (read-only investigation pass)  
**Scope:** Secrets, Identity, Functionality, Launch Readiness  
**Status:** FINDINGS — DO NOT FLIP REPO PUBLIC UNTIL BLOCKERS CLEARED

---

## Part 1 — Secrets Audit

### Findings Table

| # | Location | What | Severity | Action Required |
|---|----------|------|----------|----------------|
| S-01 | git history: 3 commits (`d4266e7`, `f6e68ed`, `b57c535`) | `.next/` build artifacts committed — contain Next.js-generated `previewModeSigningKey`, `previewModeEncryptionKey`, `encryptionKey`. Not production keys (Docker build generates fresh ones), but cryptographic material in history. Gitleaks "generic-api-key" rule. | HIGH | Purge via filter-repo (`--invert-paths` on `packages/demo-site/.next`) before repo goes public |
| S-02 | git history: 7+ blob/commit combos | EC2 IP `vaultmcp.io` in blobs of `scripts/deploy-demo.sh`, `packages/proxy/BETA.md`, `scripts/beta-status.mjs`, `launch-assets/outreach-template.md` (commits `2d22f61`, `4dff5fc`, `3660122`, `cb5ac8c`). Current HEAD is clean but history exposes the infra target. | HIGH | Purge via filter-repo `--replace-text` (same pass as S-01) |
| S-03 | npm registry | Maintainer/publisher shows `mcpvault <mcpvault@gmail.com>`. Need to confirm this is a project-owned account, not yv's personal npm account. | MEDIUM | yv confirms: project Gmail vs personal Gmail |
| S-04 | `scripts/deploy-demo.sh` (current HEAD) | SSH key path `~/.ssh/deploy-key.pem` in script. Standard path; key itself never committed. Script is superseded by ECS deployment. | LOW | Can delete or replace this script if ECS is permanent |
| S-05 | `.env.sepolia`, `.env.mainnet` (working tree only) | Both files present locally. Contain real private keys. **Were never committed** (verified: `git log` returned nothing for both files; `.env.*` pattern is gitignored). | INFORMATIONAL | No action — correctly excluded |
| S-06 | Live endpoints | `https://vaultmcp.io/.env` → 404, `https://vaultmcp.io/.git/config` → 404, `https://vaultmcp.io/api/debug` → 404 | CLEAN | None |
| S-07 | Client-side JS bundle | `ANTHROPIC_API_KEY`, `PRIVATE_KEY`, EC2 IP — none found in page JS chunks | CLEAN | None |
| S-08 | `NEXT_PUBLIC_COLLECTOR_URL` | Defaults to `'/api'` in page.tsx — no external URL or credential exposed client-side | CLEAN | None |
| S-09 | All git blobs | No real Anthropic key (`sk-ant-...`), OpenAI key, or real AWS access key in any blob. `AKIAIOSFODNN7EXAMPLE` appears only in eval corpus as intentional attack payload. | CLEAN | None |
| S-10 | Attester wallet `0xFbBB87...` | Not found in any source file or git blob. Address only in `.env.*` files (gitignored). | CLEAN | None |
| S-11 | Gitleaks scan | 6 findings — all point to `packages/demo-site/.next/` preview keys in same 3 commits as S-01. No additional findings. | see S-01 | — |

**Tools used:** gitleaks (installed, ran clean except S-01), trufflehog (not installed — used grep patterns), manual blob grep via `git rev-list --all | xargs git grep`.

---

## Part 2 — Identity Audit

> **NOTE:** The audit below searched for operator-identifying strings derived from local filesystem paths, email patterns, and all prior project names listed in the audit spec.

### Findings Table

| # | Location | What | Severity | Action Required |
|---|----------|------|----------|----------------|
| I-01 | git history: commits `d4266e7`, `f6e68ed`, `b57c535` (same as S-01) | Personal filesystem path `vault-workspace` embedded in `.next/standalone/` directory structure — committed when `.next/` was accidentally included. Path appears in file names within those commits. | HIGH | Same filter-repo purge as S-01 removes this — purging `.next/` removes these file paths entirely |
| I-02 | `scripts/deploy-demo.sh` (current HEAD + history) | Hardcoded path: `REMOTE_APP="$HOST:/opt/vault/demo-site/vault-workspace/..."` and rsync source path contains `vault-workspace`. This script is in current HEAD. | HIGH | Replace script with ECS-equivalent or delete it (it's superseded). Run filter-repo `--replace-text` to scrub path from history blobs. |
| I-03 | `launch-assets/outreach-template.md` lines 28, 52, 74 | `[yv]` appears as a signature placeholder in the outreach template. Initials only — not a full name. File will be public if repo goes public. | MEDIUM | Decide: leave as `[yv]` (fine, just initials) or replace with `[your name]` to remove all yv references |
| I-04 | `packages/eval/results/eval-clean-baseline-v2-2026-05-21.md` (line 202, 460) | Text: "Recommended investigation for yv" and "Recommended actions for yv (morning briefing)". This is internal eval report text that will be public. | MEDIUM | Replace "yv" with "the operator" in those two sections |
| I-05 | `packages/eval/red-team/2026-05-19-categorization.md` line 94 | "would require design work overnight that yv should weigh in on" — internal note, will be public. | MEDIUM | Replace "yv" with "the operator" |
| I-06 | git blob search: operator handle | blob grep for operator handle → **CLEAN — zero matches** | CLEAN | None |
| I-07 | All git commit author/committer | `git log --all --format="%an <%ae>"` → single identity: `vault <vault@vaultmcp.io>`. All 72 commits. | CLEAN | None |
| I-08 | All git blobs: `elytrasec` | `git rev-list --all | xargs git grep "elytrasec"` → **CLEAN — zero matches**. Filter-repo scrub confirmed complete. | CLEAN | None |
| I-09 | Prior project names | grep across all files + history for: sentinel, phantom, carapace, aegis, dungeonroll, control-plane, 0xdirectping, agenthire, chainmind, aura-security → **CLEAN — zero matches** | CLEAN | None |
| I-10 | `packages/proxy/package.json` | No `author` or `contributors` field. `license: MIT` declared. | CLEAN | None |
| I-11 | LICENSE file | **Missing.** package.json declares `"license": "MIT"` but no LICENSE file exists at repo root or `packages/proxy/`. | HIGH | Create `LICENSE` (MIT, copyright "VaultMCP Contributors") before npm publish |
| I-12 | Domain WHOIS | Namecheap WhoisGuard active: registrant shows "Internet Administrator" / Diego Garcia placeholder address. Personal info not exposed. | CLEAN | None |
| I-13 | Full name + personal email | **NOT YET SEARCHED** — yv must provide these strings. Identity audit is incomplete without them. | PENDING | yv provides name + email; re-run `git rev-list --all | xargs git grep "<name>"` |

---

## Part 3 — End-to-End Functionality

### 3A — npm install

```
$ npx @aimcpvault/mcp-proxy@beta --help
```

**Result: PARTIAL PASS / BLOCKER**

- Install succeeds. Help text renders.
- **FAIL:** Help text shows `npx @vaultmcp/mcp-proxy` (old package name from `0.1.0-beta.2`). Current package is `@aimcpvault/mcp-proxy`. Mismatch confuses users.
- **FAIL:** Published version is `0.1.0-beta.2`. Current local codebase is `0.1.0-rc.1` with significantly improved detection (L2 threshold 0.27 vs 0.35, 9 new L1 patterns, Layer 0 decoder). Users installing today get a worse version than what's been tested.
- npm dist-tags: `{ beta: '0.1.0-beta.2', latest: '0.1.0-beta.2' }` — both tags point to stale build.

### 3B — Wrap a real MCP server

**Result: NOT TESTED (manual test required)**

The proxy binary installs. Wrapping a filesystem server requires an interactive terminal session with a running MCP inspector. Run:
```bash
npx @aimcpvault/mcp-proxy@beta -- npx -y @modelcontextprotocol/server-filesystem /tmp
```
Then send a `tools/list` JSON-RPC call via stdin and observe the response. **yv should run this manually** before launch. Flag: the published `@beta` may not detect novel attacks at the same rate as the local rc.1 codebase.

### 3C — L3 path test

**Result: NOT TESTED** — requires `ANTHROPIC_API_KEY` in environment. Run locally with key set, use a borderline input, confirm L3 fires and verdict returns in <2s.

### 3D — Attestation pipeline

**Result: NOT TESTED** — requires `VAULT_ATTEST=1` + testnet attester key. Manual test.

### 3E — Demo site interactive scan

**Result: PARTIALLY VERIFIED**

- Site live: `https://vaultmcp.io` → HTTP 200 ✓
- No secrets in HTML or JS bundle ✓
- Rate limiter implemented (10 req/60s/IP) ✓
- Demo scan route (`/api/scan-demo`) runs real L1 inline; L2/L3 are narrated simulation with delays — **confirmed no chain writes from demo endpoint** ✓ (demo mode bypass is effectively implemented by design — the route never calls attestation)
- **NOT TESTED:** manually clicking each demo button to verify verdicts

### 3F — Demo site live data

**Result: PARTIALLY VERIFIED**

- `https://vaultmcp.io/api/feed` proxies to collector. Collector currently at `https://vaultmcp.io/api` (updated from IP in latest commit).
- VaultReputation contract at `0x3A977E4D8BA43367cc41BB4695feFF4615fec189` (Base Sepolia) — not independently verified in this audit pass.
- **NOT TESTED:** whether threat feed shows real attestations in the UI.

### 3G — README command verification

**Result: NOT TESTED** — requires manual interactive test of each code block.

### 3H — LIMITATIONS.md and POSTMORTEM

- `packages/LIMITATIONS.md` → EXISTS ✓
- `packages/SECURITY_MODEL.md` → EXISTS ✓
- `POSTMORTEM-2026-05-20-contamination.md` → **DOES NOT EXIST** ✗

The following locations reference the POSTMORTEM file:
1. `packages/demo-site/src/components/WhatWePublish.tsx` line 18 — links to `${REPO}/POSTMORTEM-2026-05-20-contamination.md`
2. `launch-assets/launch-claims.md` line 27 — references it by name
3. Commit message `e53015a` — "retired per POSTMORTEM"

When the repo goes public, WhatWePublish will display a broken GitHub link. **This must be created before launch.**

### 3I — llms.txt / agents.md

- `https://vaultmcp.io/llms.txt` → 404
- `https://vaultmcp.io/agents.md` → 404
- Neither file exists locally either.

**Recommendation:** Create `public/llms.txt` in the demo-site with a brief description of Vault for AI crawlers. Not a launch blocker, but a missed discoverability opportunity given the audience.

---

## Part 4 — Launch Readiness

### 4A — Mainnet decision

Status: **DEFERRED** — Sepolia only. When yv is ready:

```bash
# Generate mainnet wallet (or use existing — never reuse Sepolia keys on mainnet)
pnpm --filter @vaultmcp/contracts tsx script/generate-wallet.ts

# Deploy
DEPLOYER_PRIVATE_KEY=0x... \
VAULT_OWNER=0x... \
VAULT_RPC_URL=https://mainnet.base.org \
pnpm --filter @vaultmcp/contracts tsx script/deploy.ts

# Register schemas on mainnet EAS
DEPLOYER_PRIVATE_KEY=0x... \
VAULT_RPC_URL=https://mainnet.base.org \
pnpm --filter @vaultmcp/contracts tsx script/register-schemas.ts

# Post-deploy: update packages/proxy/src/config.ts with mainnet addresses
# Post-deploy: update BuildOnVault.tsx with mainnet address + Basescan link
# Post-deploy: update demo-site VAULT_BASE_RPC_URL env var in ECS task definition
```

### 4B — Demo mode bypass

**Status: COMPLETE by design.** The `/api/scan-demo` route is self-contained — it runs L1 inline and narrates L2/L3, never calling the proxy attestation client. Chain writes cannot occur from the demo. No additional bypass flag needed.

### 4C — npm publish status

```
Current published: @aimcpvault/mcp-proxy@0.1.0-beta.2
Current local:     @aimcpvault/mcp-proxy@0.1.0-rc.1 (not published)
```

**These are NOT identical.** rc.1 includes: Layer 0 decoder, 9 new L1 patterns, L2 threshold 0.27, 100% TPR clean baseline. Before launch, publish rc.1 and update tags:

```bash
pnpm --filter @aimcpvault/mcp-proxy build
npm publish packages/proxy --tag beta
npm dist-tag add @aimcpvault/mcp-proxy@0.1.0-rc.1 beta
# At public launch: npm dist-tag add @aimcpvault/mcp-proxy@0.1.0-rc.1 latest
```

### 4D — Repo visibility flip checklist

| Check | Status |
|-------|--------|
| Secrets audit clean | PENDING (S-01, S-02 must be purged) |
| Identity audit clean | PENDING (I-01, I-02 purge; I-13 full name/email check) |
| POSTMORTEM file exists | FAIL — must create |
| LICENSE file exists | FAIL — must create |
| npm @beta points to rc.1 | FAIL — must publish rc.1 |
| `[yv]` / identity strings in eval reports removed | FAIL — 3 files to update |
| Demo mode bypass confirmed | PASS |
| Manual functionality tests (B, C, D, E buttons) | PENDING — yv runs |
| Mainnet decision made | DEFERRED (can launch Sepolia-only) |
| Reviewer DM template ready | PENDING — yv writes |
| Launch tweet drafted | PENDING — yv writes |
| `scripts/deploy-demo.sh` updated or deleted | FAIL — contains personal path in current HEAD |

---

## Critical Path (Ordered)

| # | Action | Who | Est. Time | Blocks |
|---|--------|-----|-----------|--------|
| 1 | yv provides real first name, last name, personal email, GitHub username for identity re-scan | yv | 5 min | I-13 |
| 2 | Create `POSTMORTEM-2026-05-20-contamination.md` at repo root | Claude | 20 min | 3H, landing page link |
| 3 | Create `LICENSE` (MIT, "VaultMCP Contributors") at repo root | Claude | 5 min | I-11, npm publish |
| 4 | Replace `[yv]` / "yv" in eval reports and deploy script | Claude | 10 min | I-03, I-04, I-05 |
| 5 | Delete or rewrite `scripts/deploy-demo.sh` (remove personal path) | Claude | 5 min | I-02, S-04 |
| 6 | Filter-repo purge: remove `.next/` from history + replace EC2 IP + personal path in all blobs | Claude + yv approves force push | 15 min | S-01, S-02, I-01, I-02 |
| 7 | Build and publish `0.1.0-rc.1` to npm `@beta` tag | Claude + yv runs `npm publish` | 20 min | 3A blocker |
| 8 | Run full manual functionality test (wrap filesystem server, L3, demo buttons) | yv | 30 min | 3B, 3C, 3E |
| 9 | Force push cleaned history to GitHub | yv | 2 min | all history fixes |
| 10 | Flip repo public | yv | 1 min | — |
| 11 | At launch: `npm dist-tag add latest` | yv | 1 min | — |

---

## Risk Register

| Risk | Severity | Accept-as-is or Fix |
|------|----------|---------------------|
| Next.js preview keys in history | HIGH | **Must purge** — cryptographic material should not be in public history even if stale |
| EC2 IP in history | HIGH | **Must purge** — allows direct attacks on EC2 bypassing ALB |
| Personal path in history | HIGH | **Must purge** — identity leak |
| POSTMORTEM file missing | HIGH | **Must create** — landing page link will 404 |
| npm @beta stale | HIGH | **Must publish rc.1** — users get worse detection |
| LICENSE file missing | HIGH | **Must create** — MIT declared but no file |
| `mcpvault@gmail.com` npm maintainer | MEDIUM | yv confirms if this is project vs personal |
| `[yv]` / "yv" in eval reports | MEDIUM | **Should fix** — initials in public docs, low but visible |
| No llms.txt | LOW | Accept — add post-launch if desired |
| Page title vs OG title mismatch | LOW | Accept-as-is or fix in one line |
| L3 / attestation not manually tested | MEDIUM | yv runs manual test before launch day |
| Demo interactive buttons not verified | MEDIUM | yv runs before launch |

---

## Summary

**6 blockers before the repo can go public.** None are catastrophic secrets (no real private keys found). The primary risks are:

1. Build artifacts + personal path in 3 git history commits → **filter-repo purge required**
2. POSTMORTEM file doesn't exist → **create it**
3. LICENSE file missing → **add it**
4. npm @beta is a stale build with old package name → **publish rc.1**
5. `deploy-demo.sh` has personal path in current HEAD → **delete/replace**
6. `yv` identifier in eval reports → **replace with "the operator"**

After those 6 fixes plus a manual functionality test run from yv, the repo is ready to flip public.

**One pending item Claude cannot complete without yv:** full name + email identity scan (I-13). Please provide those strings so the final blob scan can be run before the force push.
