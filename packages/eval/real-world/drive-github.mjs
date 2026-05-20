// drive-github.mjs — placeholder. We skip this server during the overnight P3 sweep
// because it requires GITHUB_TOKEN. The reason is captured here so the report file
// gets generated alongside the others.

import { writeReport } from './_lib.mjs';

const lines = [
  '# Real-world battery: @modelcontextprotocol/server-github (SKIPPED)',
  '',
  '## What I ran',
  '',
  '- Nothing. This server requires `GITHUB_TOKEN` to talk to the GitHub API and the sprint env does not have one set. Running without a token would just produce 401 responses, which would tell us nothing about Vault\'s behavior on real GitHub tool outputs (issue bodies, PR descriptions, README contents fetched via the API).',
  '',
  '## Why we skipped',
  '',
  '- Per the sprint prompt: "SKIP unless GITHUB_TOKEN env var is set".',
  '- `process.env.GITHUB_TOKEN` is unset in this overnight sprint env.',
  '',
  '## Recommendation for post-launch',
  '',
  '- The GitHub MCP server is a high-value target: issue/PR bodies are exactly the kind of attacker-controlled content prompt-injection attacks exploit. After launch, re-run this battery with a low-scoped read-only PAT against `anthropics/anthropic-sdk-python` (or similar) and at least 20 real issue bodies plus the response from the `search_issues` tool.',
  '- Key things to watch for:',
  '  - FPs on `search_issues` against detection/red-team repos (they will contain attack vocabulary in titles).',
  '  - FNs on issue bodies containing real injection PoCs in markdown comments or hidden code blocks.',
  '  - Large-payload behavior: `get_issue_comments` can return many KB of text. Streaming pipeline coverage is exercised here.',
  '',
  '## Summary',
  '',
  '- 0 ops run. Documented skip. Re-run post-launch with a PAT.',
  '',
];

writeReport('github.md', lines.join('\n'));
console.log('github: skipped (no GITHUB_TOKEN). Stub report written.');
