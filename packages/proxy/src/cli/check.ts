/// vault check — query the on-chain reputation score for an MCP server.
///
/// Reads VaultReputation.getScore(string) on Base. No private key required —
/// purely a public read. Address + RPC come from deployments.json, overridable
/// via VAULT_BASE_RPC_URL and VAULT_REPUTATION_CONTRACT.
///
/// Usage:
///   vault check <server>                  one server (URL, package name, or stdio:<cmd>)
///   vault check --all                     every server in the user's MCP configs
///   vault check <server> --json           machine-readable
///   vault check <server> --rpc-url <url>  override RPC
///   vault check --network base            base | base-sepolia (default base-sepolia)

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// ---- ANSI (same convention as audit-view.ts — no external color dep) -----

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

// ---- Help ----------------------------------------------------------------

const HELP = `vault check — on-chain reputation for an MCP server

Usage:
  vault check <server>                 check one server (URL or stdio:<cmd>)
  vault check --all                    every server in your MCP config(s)
  vault check <server> --json          machine-readable
  vault check --network base-sepolia   network (default: base-sepolia)
  vault check --rpc-url <url>          override RPC endpoint
  vault check --help, -h               this help

Examples:
  vault check https://mcp.example.com/v1
  vault check stdio:npx
  vault check --all
  vault check stdio:npx --json | jq .

Server identifier conventions match the Vault proxy:
  - http transport: full upstream URL  (https://...)
  - stdio transport: stdio:<command>   (e.g. stdio:npx, stdio:uvx)

If no scheme is present, "stdio:" is assumed.
`;

// ---- Types ---------------------------------------------------------------

interface ParsedArgs {
  server?: string;
  all: boolean;
  json: boolean;
  network: 'base' | 'base-sepolia';
  rpcUrl?: string;
  showHelp: boolean;
}

export interface CheckResult {
  server: string;
  score: number;
  scans: number;
  blocks: number;
  blockRate: number;
  explorer: string;
  interpretation: string;
}

interface Deployments {
  [network: string]: { vaultReputation?: string; eas?: string };
}

// ---- Parse ---------------------------------------------------------------

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    all: false,
    json: false,
    network: 'base-sepolia',
    showHelp: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      out.showHelp = true;
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

// ---- Normalize server identifier ----------------------------------------

export function normalizeServer(input: string): string {
  if (/^https?:\/\//i.test(input)) return input;
  if (input.startsWith('stdio:')) return input;
  // Bare package name or command → treat as stdio:<cmd>
  // Match the proxy's convention from stdio.ts: stdio:<cmd> (first token only).
  const cmd = input.split(/\s+/)[0]!;
  return `stdio:${cmd}`;
}

// ---- Deployments ---------------------------------------------------------

function loadDeployments(): Deployments {
  // Walk up from this file to find packages/contracts/deployments.json.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '../../../contracts/deployments.json'),
    path.resolve(here, '../../contracts/deployments.json'),
    path.resolve(process.cwd(), 'packages/contracts/deployments.json'),
    path.resolve(process.cwd(), 'deployments.json'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, 'utf8'));
      } catch {
        // keep trying
      }
    }
  }
  // Built-in fallback: the addresses we deployed on Base Sepolia.
  return {
    'base-sepolia': {
      vaultReputation: '0x3A977E4D8BA43367cc41BB4695feFF4615fec189',
    },
  };
}

// ---- Read MCP configs (used by --all) ------------------------------------

interface McpServer { command?: string; args?: string[]; url?: string; }
interface McpConfig { mcpServers?: Record<string, McpServer> }

export function findMcpConfigPaths(): string[] {
  const home = os.homedir();
  const candidates: string[] = [];
  // Claude Desktop
  if (process.platform === 'darwin') {
    candidates.push(path.join(home, 'Library/Application Support/Claude/claude_desktop_config.json'));
  } else if (process.platform === 'linux') {
    candidates.push(path.join(home, '.config/Claude/claude_desktop_config.json'));
  } else if (process.platform === 'win32') {
    if (process.env.APPDATA) {
      candidates.push(path.join(process.env.APPDATA, 'Claude/claude_desktop_config.json'));
    }
  }
  // Claude Code global + project-local
  candidates.push(path.join(home, '.claude/mcp_settings.json'));
  candidates.push(path.resolve(process.cwd(), '.claude/mcp_settings.json'));
  candidates.push(path.resolve(process.cwd(), 'mcp_settings.json'));
  return candidates.filter((p) => existsSync(p));
}

export function readMcpServersFromConfigs(): Array<{ name: string; identifier: string; source: string }> {
  const out: Array<{ name: string; identifier: string; source: string }> = [];
  const seen = new Set<string>();
  for (const cfgPath of findMcpConfigPaths()) {
    let cfg: McpConfig;
    try {
      cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) as McpConfig;
    } catch {
      continue;
    }
    const servers = cfg.mcpServers ?? {};
    for (const [name, s] of Object.entries(servers)) {
      let id: string | undefined;
      if (s.url) id = s.url;
      else if (s.command) id = `stdio:${s.command}`;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ name, identifier: id, source: cfgPath });
    }
  }
  return out;
}

// ---- On-chain read (lazy viem import) ------------------------------------

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

const RPC_DEFAULTS: Record<string, string> = {
  base: 'https://mainnet.base.org',
  'base-sepolia': 'https://base-sepolia-rpc.publicnode.com',
};

const EXPLORER: Record<string, string> = {
  base: 'https://basescan.org',
  'base-sepolia': 'https://sepolia.basescan.org',
};

export async function queryScore(
  server: string,
  network: 'base' | 'base-sepolia',
  contractAddress: `0x${string}`,
  rpcUrl: string,
): Promise<{ score: number; scans: number; blocks: number }> {
  const viem = await import('viem');
  const { createPublicClient, http } = viem;
  const client = createPublicClient({ transport: http(rpcUrl) });
  const result = await client.readContract({
    address: contractAddress,
    abi: REPUTATION_ABI,
    functionName: 'getScore',
    args: [server],
  });
  const [score, totalScans, totalBlocks] = result;
  return { score: Number(score), scans: Number(totalScans), blocks: Number(totalBlocks) };
}

// ---- Format --------------------------------------------------------------

export function scoreColor(score: number, scans: number): (s: string) => string {
  if (scans === 0) return dim; // no data yet
  if (score >= 800) return (s) => green(bold(s));
  if (score >= 500) return yellow;
  return (s) => red(bold(s));
}

export function interpretScore(score: number, scans: number, blocks: number): string {
  if (scans === 0) return 'no scans recorded yet — server is unknown to the Vault network';
  if (blocks === 0) return `${scans} clean scan${scans === 1 ? '' : 's'} on record, no threats detected`;
  const blockRate = (blocks / scans) * 100;
  if (score >= 800) return `low threat rate (${blockRate.toFixed(1)}% over ${scans} scans) — generally safe`;
  if (score >= 500) return `elevated threat rate (${blockRate.toFixed(1)}% over ${scans} scans) — review before connecting`;
  return `HIGH threat rate (${blockRate.toFixed(1)}% over ${scans} scans) — avoid or investigate`;
}

export function buildResult(
  server: string,
  raw: { score: number; scans: number; blocks: number },
  network: 'base' | 'base-sepolia',
  contractAddress: string,
): CheckResult {
  const blockRate = raw.scans === 0 ? 0 : raw.blocks / raw.scans;
  return {
    server,
    score: raw.score,
    scans: raw.scans,
    blocks: raw.blocks,
    blockRate,
    explorer: `${EXPLORER[network]}/address/${contractAddress}`,
    interpretation: interpretScore(raw.score, raw.scans, raw.blocks),
  };
}

export function renderHuman(r: CheckResult, scans: number): string {
  const tint = scoreColor(r.score, scans);
  const scoreStr = tint(`score ${r.score}/1000`);
  const lines: string[] = [];
  lines.push(`  ${bold(r.server.padEnd(40))} ${scoreStr}    ${dim(`scans ${r.scans}`)}    ${dim(`blocks ${r.blocks}`)}`);
  lines.push(`  ${' '.repeat(40)} ${dim(r.interpretation)}`);
  lines.push(`  ${' '.repeat(40)} ${dim('explorer:')} ${cyan(r.explorer)}`);
  return lines.join('\n');
}

// ---- Main ----------------------------------------------------------------

export async function runCheck(argv: string[]): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`vault check: ${(e as Error).message}\n`);
    process.stderr.write(HELP);
    return 2;
  }
  if (args.showHelp) {
    process.stdout.write(HELP);
    return 0;
  }
  if (!args.server && !args.all) {
    process.stderr.write('vault check: provide <server> or --all\n');
    process.stderr.write(HELP);
    return 2;
  }

  const deployments = loadDeployments();
  const net = deployments[args.network];
  const contractAddress = net?.vaultReputation as `0x${string}` | undefined;
  if (!contractAddress) {
    process.stderr.write(
      `vault check: no VaultReputation address known for network '${args.network}'. ` +
        `Set VAULT_REPUTATION_CONTRACT or add to packages/contracts/deployments.json.\n`,
    );
    return 1;
  }
  const rpcUrl =
    args.rpcUrl ?? process.env.VAULT_BASE_RPC_URL ?? RPC_DEFAULTS[args.network]!;

  const servers: string[] = [];
  if (args.all) {
    const found = readMcpServersFromConfigs();
    if (found.length === 0) {
      process.stderr.write(
        'vault check --all: no MCP configs found.\n' +
          '  Looked in: ~/Library/Application Support/Claude/, ~/.claude/, ./.claude/\n',
      );
      return 1;
    }
    for (const f of found) servers.push(normalizeServer(f.identifier));
    if (!args.json) {
      process.stderr.write(dim(`Checking ${servers.length} server${servers.length === 1 ? '' : 's'} from your MCP config(s)...\n\n`));
    }
  } else if (args.server) {
    servers.push(normalizeServer(args.server));
  }

  const results: CheckResult[] = [];
  for (const s of servers) {
    try {
      const raw = await queryScore(s, args.network, contractAddress, rpcUrl);
      results.push(buildResult(s, raw, args.network, contractAddress));
    } catch (e) {
      process.stderr.write(`vault check: query failed for ${s}: ${(e as Error).message}\n`);
      return 1;
    }
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(results.length === 1 ? results[0] : results, null, 2) + '\n');
  } else {
    for (const r of results) process.stdout.write(renderHuman(r, r.scans) + '\n\n');
  }
  return 0;
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  runCheck(process.argv.slice(2)).then((code) => process.exit(code));
}
