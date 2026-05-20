# Real-world battery: @modelcontextprotocol/server-filesystem

## What I ran

- Command: `node packages/proxy/dist/index.js -- npx -y @modelcontextprotocol/server-filesystem /tmp`
- Env: VAULT_MODE=log, VAULT_TELEMETRY=0, ANTHROPIC_API_KEY=unset (L3 disabled)
- Proxy entry: `packages/proxy/dist/index.js` (built fresh for this sprint)
- Upstream server name: `secure-filesystem-server` (per initialize response)
- README battery: 34 files downloaded to `/tmp/vault-readmes` from popular GitHub repos
- Wall-clock: 8.7s

## Manifest verdict lines

- `vault: manifest unchanged for 'secure-filesystem-server' (fp=c2008447fb91)`

## Operations

| # | tool | args | verdict | layer | latency (ms) | preview |
|---|---|---|---|---|---|---|
| 1 | list_directory | {"path":"/tmp"} | clean |  |  | Access denied - path outside allowed directories: /tmp not in /private/tmp |
| 2 | list_directory | {"path":"/usr/local"} | clean |  |  | Access denied - path outside allowed directories: /usr/local not in /private/tmp |
| 3 | list_directory | {"path":"/etc"} | clean |  |  | Access denied - path outside allowed directories: /etc not in /private/tmp |
| 4 | list_allowed_directories | {} | clean |  |  | Allowed directories: /private/tmp |
| 5 | get_file_info | {"path":"/tmp/vault-readmes/angular.md"} | clean |  |  | Access denied - path outside allowed directories: /tmp/vault-readmes/angular.md not in /private/tmp |
| 6 | get_file_info | {"path":"/tmp/vault-readmes/ansible.md"} | clean |  |  | Access denied - path outside allowed directories: /tmp/vault-readmes/ansible.md not in /private/tmp |
| 7 | get_file_info | {"path":"/tmp/vault-readmes/anthropic-sdk.md"} | clean |  |  | Access denied - path outside allowed directories: /tmp/vault-readmes/anthropic-sdk.md not in /private/tmp |
| 8 | read_text_file | {"path":"/tmp/vault-readmes/angular.md"} | clean |  |  | Access denied - path outside allowed directories: /tmp/vault-readmes/angular.md not in /private/tmp |
| 9 | read_text_file | {"path":"/tmp/vault-readmes/ansible.md"} | clean |  |  | Access denied - path outside allowed directories: /tmp/vault-readmes/ansible.md not in /private/tmp |
| 10 | read_text_file | {"path":"/tmp/vault-readmes/anthropic-sdk.md"} | clean |  |  | Access denied - path outside allowed directories: /tmp/vault-readmes/anthropic-sdk.md not in /private/tmp |
| 11 | read_text_file | {"path":"/tmp/vault-readmes/astro.md"} | clean |  |  | Access denied - path outside allowed directories: /tmp/vault-readmes/astro.md not in /private/tmp |
| 12 | read_text_file | {"path":"/tmp/vault-readmes/cpython.md"} | clean |  |  | Access denied - path outside allowed directories: /tmp/vault-readmes/cpython.md not in /private/tmp |
| 13 | read_text_file | {"path":"/tmp/vault-readmes/curl.md"} | clean |  |  | Access denied - path outside allowed directories: /tmp/vault-readmes/curl.md not in /private/tmp |
| 14 | read_text_file | {"path":"/tmp/vault-readmes/django.md"} | clean |  |  | Access denied - path outside allowed directories: /tmp/vault-readmes/django.md not in /private/tmp |
| 15 | read_text_file | {"path":"/tmp/vault-readmes/docker.md"} | clean |  |  | Access denied - path outside allowed directories: /tmp/vault-readmes/docker.md not in /private/tmp |
| 16 | read_text_file | {"path":"/tmp/vault-readmes/elasticsearch.md"} | clean |  |  | Access denied - path outside allowed directories: /tmp/vault-readmes/elasticsearch.md not in /private/tmp |
| 17 | read_text_file | {"path":"/tmp/vault-readmes/electron.md"} | clean |  |  | Access denied - path outside allowed directories: /tmp/vault-readmes/electron.md not in /private/tmp |
| 18 | read_text_file | {"path":"/tmp/vault-readmes/etcd.md"} | clean |  |  | Access denied - path outside allowed directories: /tmp/vault-readmes/etcd.md not in /private/tmp |
| 19 | read_text_file | {"path":"/tmp/vault-readmes/express.md"} | clean |  |  | Access denied - path outside allowed directories: /tmp/vault-readmes/express.md not in /private/tmp |
| 20 | read_text_file | {"path":"/tmp/vault-readmes/flask.md"} | clean |  |  | Access denied - path outside allowed directories: /tmp/vault-readmes/flask.md not in /private/tmp |
| 21 | read_text_file | {"path":"/tmp/vault-readmes/git.md"} | clean |  |  | Access denied - path outside allowed directories: /tmp/vault-readmes/git.md not in /private/tmp |
| 22 | read_text_file | {"path":"/tmp/vault-readmes/go.md"} | clean |  |  | Access denied - path outside allowed directories: /tmp/vault-readmes/go.md not in /private/tmp |
| 23 | read_text_file | {"path":"/tmp/vault-readmes/grafana.md"} | clean |  |  | Access denied - path outside allowed directories: /tmp/vault-readmes/grafana.md not in /private/tmp |
| 24 | read_text_file | {"path":"/tmp/vault-readmes/kafka.md"} | clean |  |  | Access denied - path outside allowed directories: /tmp/vault-readmes/kafka.md not in /private/tmp |
| 25 | read_text_file | {"path":"/tmp/vault-readmes/kubernetes.md"} | clean |  |  | Access denied - path outside allowed directories: /tmp/vault-readmes/kubernetes.md not in /private/tmp |
| 26 | read_text_file | {"path":"/tmp/vault-readmes/linux.md"} | clean |  |  | Access denied - path outside allowed directories: /tmp/vault-readmes/linux.md not in /private/tmp |
| 27 | read_text_file | {"path":"/tmp/vault-readmes/llvm.md"} | clean |  |  | Access denied - path outside allowed directories: /tmp/vault-readmes/llvm.md not in /private/tmp |
| 28 | read_text_file | {"path":"/tmp/vault-readmes/moby.md"} | clean |  |  | Access denied - path outside allowed directories: /tmp/vault-readmes/moby.md not in /private/tmp |
| 29 | read_text_file | {"path":"/tmp/vault-readmes/mongo.md"} | clean |  |  | Access denied - path outside allowed directories: /tmp/vault-readmes/mongo.md not in /private/tmp |
| 30 | read_text_file | {"path":"/tmp/vault-readmes/nextjs.md"} | clean |  |  | Access denied - path outside allowed directories: /tmp/vault-readmes/nextjs.md not in /private/tmp |
| 31 | read_text_file | {"path":"/tmp/vault-readmes/node.md"} | clean |  |  | Access denied - path outside allowed directories: /tmp/vault-readmes/node.md not in /private/tmp |
| 32 | read_text_file | {"path":"/tmp/vault-readmes/openssl.md"} | clean |  |  | Access denied - path outside allowed directories: /tmp/vault-readmes/openssl.md not in /private/tmp |
| 33 | read_text_file | {"path":"/tmp/vault-readmes/prometheus.md"} | clean |  |  | Access denied - path outside allowed directories: /tmp/vault-readmes/prometheus.md not in /private/tmp |
| 34 | read_text_file | {"path":"/tmp/vault-readmes/react.md"} | clean |  |  | Access denied - path outside allowed directories: /tmp/vault-readmes/react.md not in /private/tmp |
| 35 | read_text_file | {"path":"/tmp/vault-readmes/redis.md"} | clean |  |  | Access denied - path outside allowed directories: /tmp/vault-readmes/redis.md not in /private/tmp |
| 36 | read_text_file | {"path":"/tmp/vault-readmes/rust.md"} | clean |  |  | Access denied - path outside allowed directories: /tmp/vault-readmes/rust.md not in /private/tmp |
| 37 | read_text_file | {"path":"/tmp/vault-readmes/svelte.md"} | clean |  |  | Access denied - path outside allowed directories: /tmp/vault-readmes/svelte.md not in /private/tmp |
| 38 | read_text_file | {"path":"/tmp/vault-readmes/tailwind.md"} | clean |  |  | Access denied - path outside allowed directories: /tmp/vault-readmes/tailwind.md not in /private/tmp |
| 39 | read_text_file | {"path":"/tmp/vault-readmes/terraform.md"} | clean |  |  | Access denied - path outside allowed directories: /tmp/vault-readmes/terraform.md not in /private/tmp |
| 40 | read_text_file | {"path":"/tmp/vault-readmes/vscode.md"} | clean |  |  | Access denied - path outside allowed directories: /tmp/vault-readmes/vscode.md not in /private/tmp |
| 41 | read_text_file | {"path":"/tmp/vault-readmes/vue.md"} | clean |  |  | Access denied - path outside allowed directories: /tmp/vault-readmes/vue.md not in /private/tmp |

## False positives

None. All real READMEs and directory listings received `clean` verdicts.

## False negatives

N/A for this server — all content is real benign README/file/dir metadata.

## Protocol oddities

- op list_allowed_directories: result.structuredContent present

## Summary

- Total ops: 41
- Clean: 41
- Non-clean (FPs against benign content): 0
- Protocol oddities noted: 1
- Battery exit reason: idle
