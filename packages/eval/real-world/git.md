# Real-world battery: mcp-server-git

## What I ran

- Command: `node packages/proxy/dist/index.js -- /tmp/vault-venv-git/bin/python -m mcp_server_git --repository /path/to/vault`
- Env: VAULT_MODE=log, VAULT_TELEMETRY=0, ANTHROPIC_API_KEY=unset (L3 disabled)
- Upstream: PyPI `mcp-server-git` installed into `/tmp/vault-venv-git`
- Wall-clock: 11.9s

## Manifest verdict lines

- `vault: manifest first-seen for 'mcp-git' (fp=075ebabe0fa1, 12 tools)`

## Operations

| # | tool | args | verdict | layer | latency (ms) | preview |
|---|---|---|---|---|---|---|
| 1 | git_status | {"repo_path":"/path/to/vault… | clean |  |  | Repository status: On branch main Your branch is up to date with 'origin/main'. Untracked files: (use "git add <file>..." to include in what… |
| 2 | git_log | {"repo_path":"/path/to/vault… | malicious | 1 | 1663 | Commit history: Commit: '98c962db32f2a343d197f15bc5acfd1805ca1b91' Author: <git.Actor "vault <vault@vaultmcp.io>"> Date: 2026-05-19 23:05:50… |
| 3 | git_diff_unstaged | {"repo_path":"/path/to/vault… | clean |  |  | Unstaged changes: |
| 4 | git_diff_staged | {"repo_path":"/path/to/vault… | clean |  |  | Staged changes: |
| 5 | git_branch | {"repo_path":"/path/to/vault… | clean |  |  | * main |
| 6 | git_show | {"repo_path":"/path/to/vault… | clean |  |  | Commit: '98c962db32f2a343d197f15bc5acfd1805ca1b91' Author: <git.Actor "vault <vault@vaultmcp.io>"> Date: datetime.datetime(2026, 5, 19, 23, … |
| 7 | git_show | {"repo_path":"/path/to/vault… | clean |  |  | Commit: '795b0f17a51c2da021431a5839d5584c41fc0fdf' Author: <git.Actor "vault <vault@vaultmcp.io>"> Date: datetime.datetime(2026, 5, 19, 22, … |
| 8 | git_show | {"repo_path":"/path/to/vault… | clean |  |  | Commit: '6b578f6ce58ffc6f4dc0d9ce2a0aabccf1e5070a' Author: <git.Actor "vault <vault@vaultmcp.io>"> Date: datetime.datetime(2026, 5, 19, 22, … |
| 9 | git_show | {"repo_path":"/path/to/vault… | clean |  |  | Commit: '1343e9d595e689492cbd03eb24a57f8003c3cb3b' Author: <git.Actor "vault <vault@vaultmcp.io>"> Date: datetime.datetime(2026, 5, 19, 22, … |
| 10 | git_show | {"repo_path":"/path/to/vault… | clean |  |  | Commit: 'c0d0b4b653ce20afedb04013e1762a17af04957a' Author: <git.Actor "vault <vault@vaultmcp.io>"> Date: datetime.datetime(2026, 5, 19, 22, … |
| 11 | git_show | {"repo_path":"/path/to/vault… | clean |  |  | Commit: '29b3c4fb34c8b3bacd6e2428731b80a14677422f' Author: <git.Actor "vault <vault@vaultmcp.io>"> Date: datetime.datetime(2026, 5, 19, 21, … |
| 12 | git_show | {"repo_path":"/path/to/vault… | malicious | 1 | 3857 | Commit: '1e82da02cf6f261bc911e7215715fffcbd32afa7' Author: <git.Actor "vault <vault@vaultmcp.io>"> Date: datetime.datetime(2026, 5, 19, 21, … |
| 13 | git_show | {"repo_path":"/path/to/vault… | malicious | 1 | 3820 | Commit: '3d9c777aeb528ceb8206054868b028ae06b172ed' Author: <git.Actor "vault <vault@vaultmcp.io>"> Date: datetime.datetime(2026, 5, 19, 21, … |
| 14 | git_show | {"repo_path":"/path/to/vault… | malicious | 1 | 1740 | Commit: '06168eb65d3d6db8798526122a2f49a7e9d590f2' Author: <git.Actor "vault <vault@vaultmcp.io>"> Date: datetime.datetime(2026, 5, 19, 21, … |
| 15 | git_show | {"repo_path":"/path/to/vault… | malicious | 1 | 1565 | Commit: '7ba7b7e14e23ef2c5aab65188e1c5323212698e2' Author: <git.Actor "vault <vault@vaultmcp.io>"> Date: datetime.datetime(2026, 5, 19, 21, … |

## False positives

### git_log (15)

- Tool: `git_log`
- Args: `{"repo_path":"/path/to/vault","max_count":15}`
- Verdict: `malicious` (L1)
- Verdict line: `vault: malicious (L1) response from 'git_log' (mode=log)`
- Preview: Commit history: Commit: '98c962db32f2a343d197f15bc5acfd1805ca1b91' Author: <git.Actor "vault <vault@vaultmcp.io>"> Date: 2026-05-19 23:05:50…

### git_show 1e82da0

- Tool: `git_show`
- Args: `{"repo_path":"/path/to/vault","revision":"1e82da02cf6f261bc911e7215715fffcbd32afa7"}`
- Verdict: `malicious` (L1)
- Verdict line: `vault: malicious (L1) response from 'git_show' (mode=log)`
- Preview: Commit: '1e82da02cf6f261bc911e7215715fffcbd32afa7' Author: <git.Actor "vault <vault@vaultmcp.io>"> Date: datetime.datetime(2026, 5, 19, 21, …

### git_show 3d9c777

- Tool: `git_show`
- Args: `{"repo_path":"/path/to/vault","revision":"3d9c777aeb528ceb8206054868b028ae06b172ed"}`
- Verdict: `malicious` (L1)
- Verdict line: `vault: malicious (L1) response from 'git_show' (mode=log)`
- Preview: Commit: '3d9c777aeb528ceb8206054868b028ae06b172ed' Author: <git.Actor "vault <vault@vaultmcp.io>"> Date: datetime.datetime(2026, 5, 19, 21, …

### git_show 06168eb

- Tool: `git_show`
- Args: `{"repo_path":"/path/to/vault","revision":"06168eb65d3d6db8798526122a2f49a7e9d590f2"}`
- Verdict: `malicious` (L1)
- Verdict line: `vault: malicious (L1) response from 'git_show' (mode=log)`
- Preview: Commit: '06168eb65d3d6db8798526122a2f49a7e9d590f2' Author: <git.Actor "vault <vault@vaultmcp.io>"> Date: datetime.datetime(2026, 5, 19, 21, …

### git_show 7ba7b7e

- Tool: `git_show`
- Args: `{"repo_path":"/path/to/vault","revision":"7ba7b7e14e23ef2c5aab65188e1c5323212698e2"}`
- Verdict: `malicious` (L1)
- Verdict line: `vault: malicious (L1) response from 'git_show' (mode=log)`
- Preview: Commit: '7ba7b7e14e23ef2c5aab65188e1c5323212698e2' Author: <git.Actor "vault <vault@vaultmcp.io>"> Date: datetime.datetime(2026, 5, 19, 21, …

## False negatives

N/A — commits are our own benign work.

## Protocol oddities

- op git_show 98c962d: large text response (425345 chars)
- op git_show 795b0f1: large text response (542933 chars)
- op git_show 29b3c4f: large text response (2368133 chars)

## Summary

- Total ops: 15
- Clean: 10
- Non-clean (FPs against benign content): 5
- Protocol oddities noted: 3
- Battery exit reason: idle
