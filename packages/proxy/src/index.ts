import { startProxy } from './transports/stdio.js';
import { startHttpProxy } from './transports/http.js';

const HELP = `vault mcp-proxy — scans MCP tool responses for prompt injection

Usage:
  # stdio (default — wrap a local MCP server)
  npx @vault/mcp-proxy -- <command> [args...]

  # http (proxy a remote MCP server through a local listener)
  npx @vault/mcp-proxy --transport http --upstream https://mcp.example.com/v1 [--port 8800]

Examples:
  npx @vault/mcp-proxy -- npx -y @modelcontextprotocol/server-filesystem /tmp
  npx @vault/mcp-proxy --transport http --upstream https://gmailmcp.googleapis.com/mcp/v1 --port 8800

Env:
  VAULT_MODE                 block (default) | warn | log
  VAULT_CAPABILITY           1 to enable capability firewall (default off)
  VAULT_TELEMETRY            0 to disable (default on when VAULT_TELEMETRY_URL is set)
  VAULT_TELEMETRY_URL        collector ingest URL
  VAULT_AUDIT_LOG            path to append-only audit log
  VAULT_MANIFEST_CHECK       on (default) | off | strict
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
