# First-24h incident runbook — v0.2.0-rc.1 launch

For each scenario: what it looks like, what to do, what to say. Keep replies factual, calm,
and non-defensive. The product survives criticism; the framing dies if you sound rattled.

---

## 1. Researcher posts a bypass / false negative

**Looks like:** a tweet with an attack payload + a screenshot/transcript showing Vault returned
`clean` or `suspicious` when the attack should have been blocked.

**First 5 min:**
1. Reproduce locally: `echo '<payload>' | npx @aimcpvault/mcp-proxy@next -- node -e 'process.stdin.pipe(process.stdout)'`.
   Confirm the verdict.
2. Classify: is this a real miss or a configuration issue (no API key, wrong threshold)?

**If real:**
- Reply factually: *"reproduced — thanks. Tracking in [issue link]. v0.2.1 with the fix will
  land this week. The payload is now in our triage queue, not in the corpus (we don't tune on
  observed misses — see POSTMORTEM-2026-05-20)."*
- Open a GitHub issue tagged `bypass`. Don't add the payload to the corpus.
- Add to v0.3 backlog as material for the next holdout rotation.

**If configuration:**
- Reply: *"this hit with `<config they used>` — Vault catches it with `ANTHROPIC_API_KEY` set
  (L3 enabled). Offline mode is documented as L1+L2 only; here's the LIMITATIONS link. Want
  me to flag this in the demo so the L3-disabled caveat is louder?"*

**Do not:** silently patch and add the exact payload to the corpus. That's the contamination
loop the postmortem documents.

---

## 2. Researcher posts a false positive on real benign content

**Looks like:** a tweet showing Vault blocking a legitimate document (security research write-up,
SQL injection education page, etc.).

**First 5 min:**
1. Reproduce. Confirm verdict + layer.
2. Check which layer fired. L1 → likely a heuristic over-match. L2 → corpus collision with
   a paraphrase. L3 → judge misclassification.

**Response:**
- Reply: *"reproduced. The L<N> path triggered because <reason>. We track this category as
  'security-research-meta' FPs — see LIMITATIONS.md §12. Workaround for now: `VAULT_MODE=warn`
  preserves the content with a header. Real fix is in v0.3 source-domain hinting."*
- Open a GitHub issue tagged `false-positive`. Triage; don't rush.

**Known FP categories (don't re-litigate in public):**
- Content *about* prompt injection ("How to defend against ignore-previous attacks") trips L1.
- Documents containing security playbook examples trip L2.
- Both are documented in `packages/eval/results/eval-clean-baseline-v2-*.md` and
  `packages/LIMITATIONS.md` §12.

---

## 3. npm install fails on Windows or specific Linux distro

**Looks like:** a tweet or GitHub issue with a stack trace mentioning `better-sqlite3`,
`node-gyp`, `prebuild-install`, or a missing native binding.

**First 5 min:**
1. Get the exact OS + Node version + arch from the report.
2. Check `https://github.com/WiseLibs/better-sqlite3/releases` for that platform's prebuild.

**Response:**
- If a prebuild exists but didn't fetch: *"thanks — looks like a `prebuild-install` retry
  bug. Workaround: `npm install @aimcpvault/mcp-proxy@next --build-from-source`. We're
  watching the upstream `prebuild-install` deprecation; pinning the workaround in our README
  this week."*
- If no prebuild for that platform: *"better-sqlite3 doesn't ship a prebuild for `<platform>`
  yet. You can build from source if you have python+make+gcc, or use the proxy without
  `VAULT_PERSIST=1` — persistence is opt-in and the only feature that needs the native
  module."*

**Persistence-disabled workaround for users who can't compile:**
```bash
# better-sqlite3 only loaded if VAULT_PERSIST=1
# leave persistence off → core proxy still works
unset VAULT_PERSIST
npx @aimcpvault/mcp-proxy@next -- <your mcp server>
```

---

## 4. Demo site goes down (ECS task crashes)

**Looks like:** `https://vaultmcp.io/` returns 502/503/504 OR `aws ecs describe-services`
shows `runningCount=0`.

**Sequence:**
1. `aws ecs describe-services --cluster vaultmcp --services demo-site --query 'services[0].events[0:5]'`
2. `aws logs tail /ecs/vaultmcp-demo-site --since 30m`
3. If image pull error → check ECR. If startup error → check the logs for a stack trace.
4. Force-restart: `aws ecs update-service --cluster vaultmcp --service demo-site --force-new-deployment`
5. If restart doesn't recover within 5 min, roll back the ECR `latest` tag to the prior
   working digest (see `launch-commands.md` § "Emergency").

**Reply (if anyone notices):**
- *"site was down 7 min — rolled out a fix. npm package wasn't affected; you can install
  with `npx @aimcpvault/mcp-proxy@next` and the proxy works locally regardless of the
  marketing site's health."*

---

## 5. Eval methodology is publicly questioned

**Looks like:** *"How did you get 100% TPR? Did you tune on the holdout?"* or *"What's
the corpus source?"* or *"Show me the raw eval output."*

**Response (lean on what's already published — don't ad-hoc):**
- Eval methodology: `packages/eval/README.md`
- Holdout MANIFESTs: `packages/eval/datasets/holdout-v2-novel/MANIFEST.md` +
  `packages/eval/datasets/holdout-v2-paraphrase/MANIFEST.md`
- Raw eval output: `packages/eval/results/eval-clean-baseline-v2-L3-enabled-2026-05-21.md`
- Corpus source provenance: every entry has a `source` field; bulk view via:
  `jq '[.[] | .source] | group_by(.) | map({source: .[0], count: length}) | sort_by(.count) | reverse' packages/corpus/injection-patterns.json`

**Standard reply pattern:**
> *"good question — the methodology is public at `packages/eval/README.md`. Detection code
> was frozen at `8d230e4` before the v2 holdout was constructed. Source provenance for every
> corpus entry is in the `source` field of `injection-patterns.json`. Happy to walk through
> any specific concern."*

**If they bring up the prior 90.3% contaminated number:**
> *"yes — caught it ourselves, postmortem at `packages/POSTMORTEM-2026-05-20-contamination.md`.
> The 90.3% was never published; the 100% is from the v2 clean holdout built after the freeze.
> Methodology rigor is the differentiator, not the number."*

---

## 6. Someone asks why @latest is still 0.1.0-beta.2

**Looks like:** *"`npm install @aimcpvault/mcp-proxy` gives me 0.1.0-beta.2, is the v0.2
release real?"*

**Response:**
> *"v0.2.0-rc.1 is intentionally at `@next` for a 24-48h soak. `npm install @aimcpvault/mcp-proxy@next`
> or `npx @aimcpvault/mcp-proxy@next` gets you v0.2. Promotion to `@latest` happens
> [Wednesday-ish] assuming no P0 surfaces."*

---

## 7. A researcher requests data export of all scans

**Looks like:** *"You're shipping a proxy that scans every tool response — can I get my data
out?"*

**Response (truthful and short):**
> *"Persistence is opt-in (`VAULT_PERSIST=1`). When enabled, scans go to `~/.vault/scans.db`
> on the operator's machine — never to us. The local `vault history` command + JSON export
> + dashboard read directly from that file. No upload, no central store. Telemetry to our
> hosted collector is also opt-in and sends SHA-256 hashes only, never raw content. The whole
> thing is in `packages/proxy/src/persistence/` and `packages/proxy/PRIVACY.md`."*

---

## 8. Claude Code or another AI tool tries to claim Vault as theirs

**Looks like:** a tweet/blog from an AI tool or aggregator implying they built or shipped
Vault.

**Response:** factual, single tweet, no escalation.
> *"vault is built by [yv handle] and shipped under @aimcpvault. open source, MIT, all code
> in github.com/vaultmcp/vault — direct contributors only. happy to be cited, not
> attributed."*

Don't engage further unless they amplify.

---

## 9. The Sepolia attester contract is referenced and someone notes the testnet caveat

**Looks like:** *"Your reputation contract is on testnet — how is the score meaningful?"*

**Response:**
> *"Correct — contract is on Sepolia for v0.2. The always-on attester + mainnet deploy land
> with v0.3, weeks not days. v0.2 ships the proxy capability (operator can opt-in to attest
> today via VAULT_ATTEST=1); the continuous public feed is post-launch work. README and
> `WhyVault` were rewritten this week to not headline the on-chain story for exactly this
> reason."*

---

## 10. The postmortem is brought up adversarially

**Looks like:** *"You admit you contaminated your eval and now we should trust your new
numbers?"*

**Response (lean in, don't defend):**
> *"Yes — caught it, reverted the code, retired the holdout, built v2 from disjoint sources
> with the detection code frozen first. The whole methodology audit is in the postmortem.
> If we'd buried it, you'd never know the discipline; that's the differentiator. Numbers
> stand or fall on the v2 methodology, not on trust."*

If they keep pushing: *"happy to walk through specific steps you think we got wrong"* and
let them name one. Most adversarial threads die when the person has to be specific.

---

## Meta-rules for all 10 scenarios

- **Reproduce before responding.** Don't acknowledge a bug you haven't seen.
- **One tweet per response.** No threads. No back-to-back replies to the same person.
- **Cite files, not opinions.** If LIMITATIONS.md covers it, link the section.
- **Time-box public engagement.** 30 min on any single thread, then close out with "moving
  to GitHub issue, will update there."
- **Don't apologize for things that aren't bugs.** Defaults are defaults.
- **Don't promise dates you can't hit.** "This week" only if you'll ship in 5 days. "v0.3"
  for everything else.
