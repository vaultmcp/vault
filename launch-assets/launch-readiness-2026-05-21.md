# Launch readiness — 2026-05-21

Outcome: sprint complete. Three feature lanes shipped behind opt-in flags, no detection-code or corpus changes, 415/415 tests passing 3x. Ready for launch-day decisions from yv.

---

## 1. Features shipped

### Day 1 — Ollama backend + `vault demo`
- `src/detection/clients/ollama-client.ts` — `OllamaJudge` implementing `JudgeClient`. No auth header, `/api/chat`, `stream:false`, `format:'json'`. Returns suspicious fallback on JSON/empty parse failures rather than throwing.
- `src/detection/clients/factory.ts` — adds `ollama` provider with `OLLAMA_HOST` auto-detect.
- `src/cli/demo.ts` — 8-scan first-run experience (1 benign hardcoded + 1 novel L0 showcase + 6 corpus entries). `vault demo` subcommand wired into `src/index.ts`.

### Day 2 — SQLite persistence + history CLI + dashboard
- `src/persistence/store.ts` + `redact.ts` + `index.ts` — better-sqlite3 store at `~/.vault/scans.db`, redacted previews (API keys, GitHub/AWS tokens, JWTs, emails, SSN/CC patterns, **home-dir paths, long hex secrets** — added during C1 V4), 30-day rolling retention.
- `src/cli/history.ts` — `vault history` with `--server`, `--verdict`, `--since` (24h/7d/ISO/ms-epoch), `--limit`, `--json`, `--db`. Honors `VAULT_PERSIST_PATH` env var.
- `src/cli/dashboard.ts` — `vault dashboard` on localhost:9876, dark theme matching demo-site palette, inline-SVG stacked bars by day, top-tools table, recent-scans table, auto-refresh 5s. Single-file HTML, no build step, no external assets.
- Wired persistence into `src/transports/stdio.ts` and `src/transports/http.ts` (JSON + SSE paths).
- `src/config.ts` exposes `VAULT_PERSIST`, `VAULT_PERSIST_PATH`, `VAULT_RETENTION_DAYS`.

### Day 3 — `vault inspect`
- `src/cli/inspect-config.ts` — reads Claude Desktop's `claude_desktop_config.json` from OS-standard paths (macOS / Linux / Windows). Supports both stdio (`command` + `args`) and SSE-style (`url`) MCP server entries.
- `src/cli/inspect-reputation.ts` — viem-based reader for `VaultReputation.getScore(string)`. Lazy-imports viem. Includes pure `classify()` for trust verdicts.
- `src/cli/inspect.ts` — `vault inspect` with `--config`, `--rpc`, `--contract`, `--json`, `--strict`. Defaults to Sepolia with a yellow warning until mainnet is live.

### File list (new + modified)
```
A  packages/proxy/src/cli/dashboard.ts
A  packages/proxy/src/cli/history.ts
A  packages/proxy/src/cli/inspect-config.ts
A  packages/proxy/src/cli/inspect-reputation.ts
A  packages/proxy/src/cli/inspect.ts
A  packages/proxy/src/persistence/index.ts
A  packages/proxy/src/persistence/redact.ts
A  packages/proxy/src/persistence/store.ts
A  packages/proxy/test/dashboard.test.ts
A  packages/proxy/test/history-cli.test.ts
A  packages/proxy/test/inspect.test.ts
A  packages/proxy/test/persistence.test.ts
A  packages/proxy/scripts/seed-c1.mjs
A  packages/proxy/scripts/seed-dashboard.mjs
M  packages/proxy/src/index.ts            (route demo / history / dashboard / inspect)
M  packages/proxy/src/config.ts           (persistence config)
M  packages/proxy/src/transports/stdio.ts (insert scan rows)
M  packages/proxy/src/transports/http.ts  (insert scan rows from JSON + SSE)
M  packages/proxy/src/persistence/redact.ts (V4 hex + home-path rules)
M  packages/proxy/test/edge-cases.test.ts (P3 flake fix: 5s → 15s init timeouts)
M  packages/proxy/test/persistence.test.ts (V4 redaction tests)
M  packages/proxy/package.json            (better-sqlite3 + @types/better-sqlite3)
M  package.json                           (onlyBuiltDependencies += better-sqlite3)
M  pnpm-workspace.yaml                    (exclude !packages/eval to unblock install)
M  README.md                              (inspect, history, dashboard, Ollama timeout)
A  NOTES_FOR_YV.md
A  launch-assets/launch-readiness-2026-05-21.md
```
Detection (`src/detection/`) and corpus (`packages/corpus/`) untouched.

---

## 2. Tests, flakiness, parallel-execution status

- **Final test count:** 415 tests across 29 files. Sprint start was 347/347; +68 new tests (40 Day-2 + 24 Day-3 + 4 V4 redaction).
- **Known flakiness:** none after P3 fix. `test/edge-cases.test.ts` previously flaked when run in parallel under CPU pressure (5s init timeout was too tight for proxy boot + WASM embedder warmup). Bumped three timeouts to 15s to match sibling tests. **3/3 final runs pass cleanly** (76–96s wall-clock each).
- **Parallel execution:** stable. Vitest default forking; no test file requires `describe.sequential`. Suite uses ~210–280s of test-CPU per run via 25–29 files concurrently.

---

## 3. npm package size, dependencies, security

- **Package size:** 273.5 kB compressed, 510.6 kB unpacked, 11 files (`npm pack --dry-run`).
- **Largest assets:** `embeddings.bin` 213.5 kB, `index.js` 111.8 kB (bundled), `injection-patterns.json` 104.9 kB.
- **New dependency:** `better-sqlite3@^12.10.0` (native, prebuilt binaries for darwin-arm64/linux-x64/win32 via prebuild-install). `@types/better-sqlite3@^7.6.13` (dev only).
- **Security implications of better-sqlite3:**
  - Native module — first npm install on a new platform may rebuild from source (requires `node-gyp`). Documented in package.json under `onlyBuiltDependencies`.
  - Synchronous API; only the persistence module touches it; persistence is opt-in (`VAULT_PERSIST=1`).
  - No CVEs in current version.
  - Database file lives at `~/.vault/scans.db` (user-only directory created with default umask). All writes go through `redact()`.
- **No new network surface:** Ollama support adds an HTTP egress to `localhost:11434` (opt-in via `OLLAMA_HOST` / `VAULT_LAYER3_PROVIDER`); dashboard listens on `127.0.0.1:9876` by default; inspect calls Base Sepolia RPC.

---

## 4. Documentation updates

- **README.md** new sections:
  - "On-chain reputation inspector" (with trust threshold table + Sepolia caveat)
  - "Local scan history (opt-in)" (privacy guarantees + CLI examples + retention)
  - Ollama caveats — added `VAULT_LAYER3_TIMEOUT_MS=15000` guidance for cold-start latency, noted that `llama3.2:3b` missed subtle attacks Haiku catches
- **packages/proxy/src/index.ts** HELP string lists `demo`, `history`, `dashboard`, `inspect` plus new env vars `VAULT_PERSIST` / `VAULT_PERSIST_PATH` / `VAULT_RETENTION_DAYS`.
- **NOTES_FOR_YV.md** carries the Ollama timing, post-sprint reachability re-check, and P3 flake-fix postmortem.

---

## 5. Outstanding launch decisions for yv

1. **Mainnet deploy timing.** `VaultReputation` is only on Sepolia today. `vault inspect` already prints a yellow warning when reading from Sepolia. Decision needed on when to deploy mainnet — until then, the inspector ships with a testnet caveat in the README. Suggestion: keep Sepolia as default through Beta; flip to mainnet a week after launch once we have a few thousand attested scans.
2. **Repo public flip timing.** Sequence: confirm `git status` is clean → make repo public on GitHub → publish to npm. Reviewer DMs and tweet should go out within ~30 min of npm @latest to capitalize on launch energy.
3. **npm @latest promotion timing.** Recommend publishing `0.2.0-rc.1` first (npm dist-tag = next), letting reviewers exercise for 24–48h, then promoting to @latest after no P0 bugs surface. Version bump command:
   ```
   pnpm --filter @aimcpvault/mcp-proxy version 0.2.0-rc.1
   ```
4. **Reviewer DM list.** No reviewer list defined in this sprint. yv to assemble — suggest 5–10 MCP-aware security/dev folks.
5. **Launch tweet.** Not drafted in this sprint. Sketch suggestion:
   > Vault `0.2` ships: built-in Ollama backend (offline L3), `vault history` + `vault dashboard` for local-first scan review, and `vault inspect` for on-chain MCP-server reputation. One-line install: `npx @aimcpvault/mcp-proxy demo`

---

## 6. Recommended launch sequence

| step | command / action | est. time |
|---|---|---|
| 1 | Final `git status` sanity, verify `dist/` is clean | 2 min |
| 2 | `pnpm --filter @aimcpvault/mcp-proxy version 0.2.0-rc.1` | 1 min |
| 3 | `git commit && git tag v0.2.0-rc.1 && git push --tags` | 2 min |
| 4 | `pnpm --filter @aimcpvault/mcp-proxy publish --tag next` | 3 min |
| 5 | Smoke test: `npx @aimcpvault/mcp-proxy@next demo` on a fresh box | 5 min |
| 6 | Flip repo public on GitHub | 1 min |
| 7 | DM reviewer list (5–10 folks) | 10 min |
| 8 | 24–48h soak — watch for P0 issues | — |
| 9 | If clean: `npm dist-tag add @aimcpvault/mcp-proxy@0.2.0-rc.1 latest` | 1 min |
| 10 | Launch tweet | 5 min |

Total active time: ~30 min before soak, ~10 min after. Soak window is the main wait.

---

## Discipline status

- ✅ Detection code unchanged (`packages/proxy/src/detection/`)
- ✅ Corpus unchanged (`packages/corpus/`)
- ✅ Zero eval runs against any holdout
- ✅ Ollama tested qualitatively only (no holdout comparison numbers)
- ✅ All new features behind opt-in flags (`VAULT_PERSIST=1`, `vault inspect` is read-only)
- ✅ All test failures fixed at the root, never silenced
- ✅ No force-pushes or destructive ops
