/// @vaultmcp/check — standalone on-chain reputation lookup for MCP servers.
///
/// Read-only. No key needed. Queries VaultReputation.getScore on Base via viem.
///
/// Usage:
///   npx @vaultmcp/check <server>           one server
///   npx @vaultmcp/check --all              every server in your MCP config(s)
///   npx @vaultmcp/check <server> --json    machine-readable
///   npx @vaultmcp/check --network base     base | base-sepolia (default base-sepolia
///                                          until mainnet deploy)
///   npx @vaultmcp/check --rpc-url <url>    override RPC endpoint

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ---- ANSI ---------------------------------------------------------------

const HAS_TTY = process.stdout.isTTY && !process.env.NO_COLOR;
function color(s: string, code: string): string {
  if (!HAS_TTY) return s;
  return `\x1b[${code}m${s}\x1b[0m`;
}
const dim = (s: string) => color(s, '2;37');
const red = (s: string) => color(s, '31');
const yellow = (s: string) => color(s, '33');
const green = (s: string) => color(s, '32');
const cyan = (s: string) => color(s, '36');
const bold = (s: string) => color(s, '1');

// ---- Help ---------------------------------------------------------------

const HELP = `@vaultmcp/check — on-chain reputation lookup for an MCP server

Usage:
  npx @vaultmcp/check <server>                check one server (URL or stdio:<cmd>)
  npx @vaultmcp/check --all                   every server in your MCP config(s)
  npx @vaultmcp/check <server> --json         machine-readable output
  npx @vaultmcp/check --network base-sepolia  network (default: base-sepolia)
  npx @vaultmcp/check --rpc-url <url>         override RPC endpoint
  npx @vaultmcp/check --help, -h              this help
  npx @vaultmcp/check --version, -v           print version

Examples:
  npx @vaultmcp/check https://mcp.example.com/v1
  npx @vaultmcp/check stdio:npx:@modelcontextprotocol/server-filesystem
  npx @vaultmcp/check --all
  npx @vaultmcp/check stdio:npx --json | jq .

Server identifier conventions:
  - http transport: full upstream URL  (https://...)
  - stdio transport: stdio:<cmd>:<package or module>

Site: https://vaultmcp.io
`;

const VERSION = '0.0.1';

// ---- Built-in deployments map ------------------------------------------

const DEPLOYMENTS: Record<string, { vaultReputation: `0x${string}` }> = {
  'base-sepolia': { vaultReputation: '0x3A977E4D8BA43367cc41BB4695feFF4615fec189' },
  // Mainnet address gets filled in after the mainnet deploy. Until then, --network base
  // will return an explicit "no deployment" error.
};

const RPC_DEFAULTS: Record<string, string> = {
  base: 'https://mainnet.base.org',
  'base-sepolia': 'https://base-sepolia-rpc.publicnode.com',
};

const EXPLORER: Record<string, string> = {
  base: 'https://basescan.org',
  'base-sepolia': 'https://sepolia.basescan.org',
};

// ---- Parse --------------------------------------------------------------

export type Network = 'base' | 'base-sepolia';

export interface ParsedArgs {
  server?: string;
  all: boolean;
  json: boolean;
  network: Network;
  rpcUrl?: string;
  showHelp: boolean;
  showVersion: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    all: false,
    json: false,
    network: 'base-sepolia',
    showHelp: false,
    showVersion: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      out.showHelp = true;
    } else if (a === '--version' || a === '-v') {
      out.showVersion = true;
    } else if (a === '--all') {
      out.all = true;
    } else if (a === '--json') {
      out.json = true;
    } else if (a === '--network') {
      const v = argv[++i];
      if (v === 'base' || v === 'base-sepolia') out.network = v;
      else throw new Error(`unknown network: ${v} (expected base|base-sepolia)`);
    } else if (a === '--rpc-url') {
      out.rpcUrl = argv[++i];
    } else if (a && !a.startsWith('--') && !out.server) {
      out.server = a;
    } else if (a?.startsWith('--')) {
      throw new Error(`unknown flag: ${a}`);
    }
  }
  return out;
}

// ---- Normalize identifier ----------------------------------------------

export function normalizeServer(input: string): string {
  if (/^https?:\/\//i.test(input)) return input;
  if (input.startsWith('stdio:')) return input;
  const cmd = input.split(/\s+/)[0]!;
  return `stdio:${cmd}`;
}

// ---- MCP config discovery (for --all) ----------------------------------

interface McpServer { command?: string; args?: string[]; url?: string; }
interface McpConfig { mcpServers?: Record<string, McpServer> }

export function findMcpConfigPaths(): string[] {
  const home = os.homedir();
  const c: string[] = [];
  if (process.platform === 'darwin') {
    c.push(path.join(home, 'Library/Application Support/Claude/claude_desktop_config.json'));
  } else if (process.platform === 'linux') {
    c.push(path.join(home, '.config/Claude/claude_desktop_config.json'));
  } else if (process.platform === 'win32' && process.env.APPDATA) {
    c.push(path.join(process.env.APPDATA, 'Claude/claude_desktop_config.json'));
  }
  c.push(path.join(home, '.claude/mcp_settings.json'));
  c.push(path.resolve(process.cwd(), '.claude/mcp_settings.json'));
  return c.filter((p) => existsSync(p));
}

export function readMcpServers(): Array<{ name: string; identifier: string }> {
  const out: Array<{ name: string; identifier: string }> = [];
  const seen = new Set<string>();
  for (const p of findMcpConfigPaths()) {
    let cfg: McpConfig;
    try {
      cfg = JSON.parse(readFileSync(p, 'utf8')) as McpConfig;
    } catch {
      continue;
    }
    for (const [name, s] of Object.entries(cfg.mcpServers ?? {})) {
      let id: string | undefined;
      if (s.url) id = s.url;
      else if (s.command) id = `stdio:${s.command}`;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ name, identifier: id });
    }
  }
  return out;
}

// ---- On-chain read (lazy viem import) ----------------------------------

const REPUTATION_ABI = [
  {
    type: 'function',
    name: 'getScore',
    stateMutability: 'view',
    inputs: [{ name: 'mcpServerUrl', type: 'string' }],
    outputs: [
      { name: 'score', type: 'uint16' },
      { name: 'totalScans', type: 'uint32' },
      { name: 'totalBlocks', type: 'uint32' },
    ],
  },
] as const;

export interface CheckResult {
  server: string;
  network: Network;
  score: number;
  scans: number;
  blocks: number;
  blockRate: number;
  explorer: string;
  interpretation: string;
}

export async function queryScore(
  server: string,
  network: Network,
  contractAddress: `0x${string}`,
  rpcUrl: string,
): Promise<{ score: number; scans: number; blocks: number }> {
  const viem = await import('viem');
  const { createPublicClient, http } = viem;
  const client = createPublicClient({ transport: http(rpcUrl) });
  const [score, totalScans, totalBlocks] = await client.readContract({
    address: contractAddress,
    abi: REPUTATION_ABI,
    functionName: 'getScore',
    args: [server],
  });
  return { score: Number(score), scans: Number(totalScans), blocks: Number(totalBlocks) };
}

// ---- Interpretation / formatting ---------------------------------------

export function interpretScore(score: number, scans: number, blocks: number): string {
  if (scans === 0) return 'no scans recorded yet — server is unknown to the Vault network';
  if (blocks === 0) return `${scans} clean scan${scans === 1 ? '' : 's'} on record, no threats detected`;
  const r = (blocks / scans) * 100;
  if (score >= 800) return `low threat rate (${r.toFixed(1)}% over ${scans} scans) — generally safe`;
  if (score >= 500) return `elevated threat rate (${r.toFixed(1)}% over ${scans} scans) — review before connecting`;
  return `HIGH threat rate (${r.toFixed(1)}% over ${scans} scans) — avoid or investigate`;
}

export function buildResult(
  server: string,
  raw: { score: number; scans: number; blocks: number },
  network: Network,
  contractAddress: string,
): CheckResult {
  return {
    server,
    network,
    score: raw.score,
    scans: raw.scans,
    blocks: raw.blocks,
    blockRate: raw.scans === 0 ? 0 : raw.blocks / raw.scans,
    explorer: `${EXPLORER[network]}/address/${contractAddress}`,
    interpretation: interpretScore(raw.score, raw.scans, raw.blocks),
  };
}

export function scoreColor(score: number, scans: number): (s: string) => string {
  if (scans === 0) return dim;
  if (score >= 800) return (s) => green(bold(s));
  if (score >= 500) return yellow;
  return (s) => red(bold(s));
}

export function renderHuman(r: CheckResult): string {
  const tint = scoreColor(r.score, r.scans);
  const lines: string[] = [];
  lines.push(`  ${bold(r.server.padEnd(40))} ${tint(`score ${r.score}/1000`)}    ${dim(`scans ${r.scans}`)}    ${dim(`blocks ${r.blocks}`)}`);
  lines.push(`  ${' '.repeat(40)} ${dim(r.interpretation)}`);
  lines.push(`  ${' '.repeat(40)} ${dim('explorer:')} ${cyan(r.explorer)}`);
  return lines.join('\n');
}

// ---- Main ---------------------------------------------------------------

export async function runCheck(argv: string[]): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`vault-check: ${(e as Error).message}\n`);
    process.stderr.write(HELP);
    return 2;
  }
  if (args.showHelp) {
    process.stdout.write(HELP);
    return 0;
  }
  if (args.showVersion) {
    process.stdout.write(`@vaultmcp/check ${VERSION}\n`);
    return 0;
  }
  if (!args.server && !args.all) {
    process.stderr.write('vault-check: provide <server> or --all\n');
    process.stderr.write(HELP);
    return 2;
  }

  const dep = DEPLOYMENTS[args.network];
  if (!dep) {
    process.stderr.write(
      `vault-check: no VaultReputation address known for network '${args.network}'.\n` +
        `Once mainnet is deployed this address ships with the package.\n`,
    );
    return 1;
  }
  const rpc = args.rpcUrl ?? process.env.VAULT_BASE_RPC_URL ?? RPC_DEFAULTS[args.network]!;

  const servers: string[] = [];
  if (args.all) {
    const found = readMcpServers();
    if (found.length === 0) {
      process.stderr.write(
        'vault-check --all: no MCP configs found in default locations.\n',
      );
      return 1;
    }
    for (const f of found) servers.push(normalizeServer(f.identifier));
    if (!args.json) {
      process.stderr.write(dim(`Checking ${servers.length} server(s) from your MCP config(s)...\n\n`));
    }
  } else if (args.server) {
    servers.push(normalizeServer(args.server));
  }

  const results: CheckResult[] = [];
  for (const s of servers) {
    try {
      const raw = await queryScore(s, args.network, dep.vaultReputation, rpc);
      results.push(buildResult(s, raw, args.network, dep.vaultReputation));
    } catch (e) {
      process.stderr.write(`vault-check: query failed for ${s}: ${(e as Error).message}\n`);
      return 1;
    }
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(results.length === 1 ? results[0] : results, null, 2) + '\n');
  } else {
    for (const r of results) process.stdout.write(renderHuman(r) + '\n\n');
  }
  return 0;
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  runCheck(process.argv.slice(2)).then((code) => process.exit(code));
}
