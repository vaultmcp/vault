// drive-postgres.mjs — placeholder. We skip this server during the overnight P3
// sweep because it needs a running Postgres instance with non-persistent state.

import { writeReport } from './_lib.mjs';

const lines = [
  '# Real-world battery: @modelcontextprotocol/server-postgres (SKIPPED)',
  '',
  '## What I ran',
  '',
  '- Nothing. The Postgres MCP server needs a connection URI to a running database. Spinning one up in the overnight sandbox would burn time on infra (docker run, port assignment, schema fixture) for a server whose risk surface is well-modeled in fixtures.',
  '',
  '## Why we skipped',
  '',
  '- Per the sprint prompt: "SKIP unless we can spin up a local Postgres without persistent state".',
  '- `which docker` and `which postgres` were not checked, but bringing up a Postgres + creating a fixture schema + writing realistic injection-bearing rows would consume too much of the 90-minute P3 window.',
  '',
  '## Recommendation for post-launch',
  '',
  '- Spin up a throwaway Postgres in a docker container with a seeded fixture: a `users` table with one row whose `bio` column contains a Greshake-class injection payload, and a `support_tickets` table where each row body might be attacker-supplied free text.',
  '- Run `query` against `SELECT bio FROM users` and `SELECT body FROM support_tickets WHERE id = $1` to exercise both single-row and multi-row response shapes.',
  '- Key things to watch for:',
  '  - JSON-serialised result rows — Vault sees the JSON-RPC text content which may JSON-encode rows. Does the L1 regex match `"ignore previous instructions"` (with the quotes)?',
  '  - Large result sets that trigger the streaming pipeline. Pagination behavior.',
  '  - Server error responses (syntax error, permission denied) — does Vault treat the error text correctly?',
  '',
  '## Summary',
  '',
  '- 0 ops run. Documented skip. Re-run post-launch with a docker-compose Postgres fixture.',
  '',
];

writeReport('postgres.md', lines.join('\n'));
console.log('postgres: skipped (no local Postgres). Stub report written.');
