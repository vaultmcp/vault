import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startProxy } from './transports/stdio.js';
import { startHttpProxy } from './transports/http.js';

function readVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // dist/index.js → ../package.json; src/index.ts → ../../package.json
    for (const rel of ['../package.json', '../../package.json']) {
      const p = path.resolve(here, rel);
      try {
        const pkg = JSON.parse(readFileSync(p, 'utf8'));
        if (pkg.name && pkg.version) return String(pkg.version);
      } catch {
        /* keep trying */
      }
    }
  } catch {
    /* ignore */
  }
  return '0.0.0';
}

const HELP = `vault mcp-proxy — scans MCP tool responses for prompt injection

Usage
  npx @vault/mcp-proxy -- <command> [args...]                      # stdio (wrap a local MCP server)
  npx @vault/mcp-proxy --transport http --upstream <url> [--port]  # http (proxy a remote MCP server)

Examples
  npx @vault/mcp-proxy -- npx -y @modelcontextprotocol/server-filesystem /tmp
  npx @vault/mcp-proxy --transport http --upstream https://mcp.example.com/v1 --port 8800

Flags
  --transport <stdio|http>   default: stdio
  --upstream <url>           required when --transport http
  --port, --listen-port <n>  default: 8800 (http mode only)
  --host <addr>              default: 127.0.0.1 (http mode only)
  --version, -v              print version
  --help, -h                 this help

Detection (env)
  VAULT_MODE                 block (default) | warn | log
  VAULT_LAYER2_THRESHOLD     cosine distance cutoff for L2 (default 0.35)
  VAULT_LAYER3_PROVIDER      anthropic | openai | custom         (default: auto-detect from key)
  VAULT_LAYER3_MODEL         model id override
  VAULT_LAYER3_BASE_URL      OpenAI-compatible endpoint (custom)
  VAULT_LAYER3_TIMEOUT_MS    judge call hard timeout (default 5000)
  ANTHROPIC_API_KEY          BYO key for Layer 3 (Anthropic)
  OPENAI_API_KEY             BYO key for Layer 3 (OpenAI / compat)

Capability firewall (env, default off)
  VAULT_CAPABILITY                 1 to enable taint-tracking + gate
  VAULT_CAPABILITY_MODE            block (default) | warn
  VAULT_TAINT_MIN_OVERLAP          chars of overlap to gate (default 32)
  VAULT_TAINT_WINDOW_SIZE          recent responses tracked (default 10)
  VAULT_SENSITIVE_TOOL_PATTERNS    comma-separated regexes added to defaults

Manifest verification (env)
  VAULT_MANIFEST_CHECK             on (default) | off | strict
  VAULT_MANIFEST_CACHE_DIR         override \$XDG_CACHE_HOME/vault/manifests

Telemetry (env, default on when URL configured)
  VAULT_TELEMETRY                  0 to disable
  VAULT_TELEMETRY_URL              collector ingest URL
  VAULT_TELEMETRY_SECRET           optional Bearer token
  VAULT_TELEMETRY_BATCH            batch size (default 100)
  VAULT_TELEMETRY_FLUSH_MS         flush interval (default 5000)
  VAULT_TELEMETRY_INSTALL_ID       stable install id (hashed before send)

Audit log (env, default off)
  VAULT_AUDIT_LOG                  path to append-only JSONL of every decision

On-chain attestation (env, default off)
  VAULT_ATTEST                     1 to enable EAS attestations on Base
  VAULT_BASE_RPC_URL               default: https://mainnet.base.org
  VAULT_ATTESTER_PRIVATE_KEY       hot wallet (fund with ~0.05 ETH on Base)
  VAULT_EAS_ADDRESS                EAS contract (default: OP-stack predeploy)
  VAULT_SCAN_RECEIPT_SCHEMA        ScanReceipt schema UID (Sepolia default built-in)
  VAULT_THREAT_RECORD_SCHEMA       ThreatRecord schema UID (Sepolia default built-in)
  VAULT_REPUTATION_CONTRACT        VaultReputation address (Sepolia default built-in)
  VAULT_ATTEST_SAMPLE_RATE_L1L2    sampling for clean L1/L2 (default 0.1)

Privacy: see PRIVACY.md. SHA-256 hashes only — raw content never leaves the proxy.
`;

interface ParsedArgs {
  transport: 'stdio' | 'http';
  upstream?: string;
  port?: number;
  host?: string;
  stdioTarget?: { cmd: string; args: string[] };
  showHelp: boolean;
  noArgs: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length === 0) return { transport: 'stdio', showHelp: true, noArgs: true };
  if (argv.includes('--version') || argv.includes('-v')) {
    process.stdout.write(`@vault/mcp-proxy ${readVersion()}\n`);
    process.exit(0);
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    return { transport: 'stdio', showHelp: true, noArgs: false };
  }

  const sepIdx = argv.indexOf('--');
  const flagArgs = sepIdx >= 0 ? argv.slice(0, sepIdx) : argv;
  const afterSep = sepIdx >= 0 ? argv.slice(sepIdx + 1) : [];

  let transport: 'stdio' | 'http' = 'stdio';
  let upstream: string | undefined;
  let port: number | undefined;
  let host: string | undefined;

  for (let i = 0; i < flagArgs.length; i++) {
    const a = flagArgs[i];
    if (a === '--transport') {
      const v = flagArgs[++i];
      if (v === 'http') transport = 'http';
      else if (v === 'stdio') transport = 'stdio';
      else throw new Error(`unknown transport: ${v}`);
    } else if (a === '--upstream') {
      upstream = flagArgs[++i];
    } else if (a === '--port' || a === '--listen-port') {
      const v = flagArgs[++i];
      port = v ? Number.parseInt(v, 10) : undefined;
    } else if (a === '--host') {
      host = flagArgs[++i];
    } else if (a && a.startsWith('--')) {
      throw new Error(`unknown flag: ${a}`);
    }
  }

  if (transport === 'http') {
    if (!upstream) throw new Error('--transport http requires --upstream <url>');
    return { transport, upstream, port: port ?? 8800, host: host ?? '127.0.0.1', showHelp: false, noArgs: false };
  }

  // stdio
  const target = sepIdx >= 0 ? afterSep : flagArgs;
  const cmd = target[0];
  const args = target.slice(1);
  if (!cmd) throw new Error('no target command (use `--` to separate args)');
  return { transport: 'stdio', stdioTarget: { cmd, args }, showHelp: false, noArgs: false };
}

function main(): void {
  const argv = process.argv.slice(2);
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`vault: ${err instanceof Error ? err.message : String(err)}\n`);
    process.stderr.write(HELP);
    process.exit(2);
  }

  if (parsed.showHelp) {
    process.stdout.write(HELP);
    process.exit(parsed.noArgs ? 2 : 0);
  }

  if (parsed.transport === 'http') {
    startHttpProxy({ upstream: parsed.upstream!, listenPort: parsed.port!, listenHost: parsed.host });
    return;
  }

  const { cmd, args } = parsed.stdioTarget!;
  startProxy(cmd, args);
}

main();
