import { startProxy } from './transports/stdio.js';

const HELP = `vault mcp-proxy — scans MCP tool responses for prompt injection

Usage:
  npx @vault/mcp-proxy -- <command> [args...]

Examples:
  npx @vault/mcp-proxy -- npx -y @modelcontextprotocol/server-filesystem /tmp

Env:
  VAULT_MODE   block (default) | warn | log
`;

function main(): void {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    process.exit(argv.length === 0 ? 2 : 0);
  }

  const sepIdx = argv.indexOf('--');
  const target = sepIdx >= 0 ? argv.slice(sepIdx + 1) : argv;
  const cmd = target[0];
  const args = target.slice(1);

  if (!cmd) {
    process.stderr.write('vault: no target command\n');
    process.exit(2);
  }

  startProxy(cmd, args);
}

main();
