# @vaultmcp/rh-registry

An **MCP-server safety registry** for the Robinhood Chain ecosystem — a directory
of which trading MCP servers have been scanned by [Vault](https://vaultmcp.io) for
prompt injection, and their current safety status.

Vault is an MCP prompt-injection proxy: you wrap any trading MCP server with
`npx @aimcpvault/mcp-proxy -- <server>` and it scans tool responses for injection
attacks before they reach your agent. This package is the public-facing *directory*
that answers "has server X been checked, and what did Vault find?".

> **The entries in `src/registry.seed.json` are EXAMPLES.** They are named and
> annotated to make that obvious. Replace them with real scan results before using
> this as a live registry.

## Safety status model

Each entry carries a **scan status**:

| Status      | Meaning                                              | UI            |
| ----------- | ---------------------------------------------------- | ------------- |
| `scanned`   | Passed through Vault, no findings                    | ✓ scanned     |
| `flagged`   | Scanned, Vault surfaced N findings                   | ⚠ flagged · N |
| `unscanned` | Not yet run through Vault — status unknown           | – unscanned   |

## Attestation is on the roadmap (honest)

Vault's attestation story is **Base + EAS**, and it is **roadmap, not shipped**.
So every entry's `attestation` defaults to:

```json
{ "status": "pending" }
```

An entry only reads `attested` when a **real** EAS reference is supplied
(`{ "status": "attested", "chain": "base", "easUid": "0x…" }`). The store actively
**strips any `easUid`/`chain` from a `pending` attestation** so no fabricated
on-chain proof can leak into the registry. We never invent attestation hashes.

When Vault's Base/EAS attestation ships, scanning a server will mint an EAS
attestation on Base and the registry will carry its real UID here — flipping
`pending` → `attested` with a verifiable reference.

## Run the status page

```bash
pnpm --filter @vaultmcp/rh-registry serve      # http://localhost:5179
PORT=8080 pnpm --filter @vaultmcp/rh-registry serve
```

- `GET /` — HTML status page (Vault palette: green `#00ff66` on near-black
  `#050505`) rendering entries as a table with scan status and attestation.
- `GET /registry.json` — the registry as JSON: `{ entries, summary }`.

The server is **zero-dependency** (Node builtins only) and mirrors
`packages/rh-demo/src/web.ts`: it reads `index.html` once via `readFileSync` and
serves the JSON from an in-memory store loaded from the seed at boot.

## Store API

```ts
import { loadStore, RegistryStore } from './src/store.js';

const store = loadStore();          // from src/registry.seed.json
store.list();                       // RegistryEntry[]
store.get('rh-example-yield-router');
store.upsert(entry);                // insert/replace by id (normalizes attestation)
store.summary();                    // counts by scan + attestation status
store.payload();                    // { entries, summary } — the /registry.json body
```

Timestamps are carried as **data** (ISO strings / `null`) — this package never
reads the wall clock, so the store stays pure and testable.

## Scripts

```bash
pnpm --filter @vaultmcp/rh-registry test        # vitest run
pnpm --filter @vaultmcp/rh-registry typecheck   # tsc --noEmit
```
