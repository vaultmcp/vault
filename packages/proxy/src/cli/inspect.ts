/// vault inspect — read Claude Desktop's MCP config and report each server's
/// on-chain reputation. Default: Sepolia (testnet). Override via env / flags.

import { readClaudeDesktopConfig, defaultConfigPath, type McpServerEntry } from './inspect-config.js';
import {
  classify,
  createReputationReader,
  type TrustEval,
  type Verdict,
} from './inspect-reputation.js';
import type { Address } from 'viem';

const HELP = `vault inspect — show on-chain reputation for Claude Desktop's MCP servers

Usage:
  vault inspect [flags]

Flags
  --config <path>            override Claude Desktop config path
  --rpc <url>                EVM RPC URL (default: https://sepolia.base.org)
  --contract <addr>          VaultReputation contract address
                             (default: Sepolia 0x3A977E4D8BA43367cc41BB4695feFF4615fec189)
  --json                     emit JSON (one record per server)
  --strict                   exit code 1 if any server is UNTRUSTED
  --help, -h                 this help

Verdicts
  TRUSTED    score ≥ 0.95 AND totalScans ≥ 100
  UNTRUSTED  maliciousRate ≥ 0.10
  CAUTION    totalScans ≥ 10 AND maliciousRate ≥ 0.01
  NEW        totalScans < 10

Network
  Default RPC is Sepolia (testnet). When mainnet is live, point --rpc at it.
`;

const SEPOLIA_RPC = 'https://sepolia.base.org';
const SEPOLIA_REPUTATION = '0x3A977E4D8BA43367cc41BB4695feFF4615fec189' as Address;

export interface InspectOptions {
  configPath?: string;
  rpcUrl?: string;
  contractAddress?: Address;
  json?: boolean;
  strict?: boolean;
  /** Inject a reputation reader for tests. */
  reader?: { read(mcpServerUrl: string): Promise<{ scoreRaw: number; totalScans: number; totalBlocks: number }> };
  out?: { write(s: string): void };
  noColor?: boolean;
}

export function parseInspectArgs(argv: string[]): InspectOptions & { help?: boolean } {
  const out: InspectOptions & { help?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { out.help = true; continue; }
    if (a === '--config') { out.configPath = argv[++i]; continue; }
    if (a === '--rpc') { out.rpcUrl = argv[++i]; continue; }
    if (a === '--contract') { out.contractAddress = argv[++i] as Address; continue; }
    if (a === '--json') { out.json = true; continue; }
    if (a === '--strict') { out.strict = true; continue; }
    if (a && a.startsWith('--')) throw new Error(`unknown flag: ${a}`);
  }
  return out;
}

function ansi(useColor: boolean) {
  const c = (s: string, code: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
  return {
    green: (s: string) => c(s, '32'),
    yellow: (s: string) => c(s, '33'),
    red: (s: string) => c(s, '31'),
    cyan: (s: string) => c(s, '36'),
    dim: (s: string) => c(s, '2;37'),
    bold: (s: string) => c(s, '1'),
  };
}

function fmtVerdict(v: Verdict, col: ReturnType<typeof ansi>): string {
  if (v === 'TRUSTED') return col.green('TRUSTED');
  if (v === 'CAUTION') return col.yellow('CAUTION');
  if (v === 'UNTRUSTED') return col.red('UNTRUSTED');
  return col.dim('NEW    ');
}

function padRight(s: string, n: number): string {
  // Pad accounting for ANSI escapes (very rough; only used for our fixed labels).
  const visible = s.replace(/\x1b\[[0-9;]*m/g, '');
  if (visible.length >= n) return s;
  return s + ' '.repeat(n - visible.length);
}

export interface InspectRecord {
  name: string;
  command: string;
  args: string[];
  identifier: string;
  url?: string;
  verdict: Verdict;
  score: number;
  totalScans: number;
  totalBlocks: number;
  maliciousRate: number;
}

export async function runInspect(opts: InspectOptions = {}): Promise<number> {
  const out = opts.out ?? process.stdout;
  const hasTTY = process.stdout.isTTY === true;
  const useColor = opts.noColor === true ? false : hasTTY && !process.env.NO_COLOR;
  const col = ansi(useColor);

  let config;
  try {
    config = readClaudeDesktopConfig(opts.configPath);
  } catch (err) {
    out.write(`vault inspect: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  if (config.servers.length === 0) {
    out.write(`vault inspect: no MCP servers found.\n`);
    out.write(`  expected ${config.configPath}\n`);
    out.write(`  (configure Claude Desktop's mcpServers map, or pass --config <path>)\n`);
    return opts.strict ? 1 : 0;
  }

  const rpcUrl = opts.rpcUrl ?? process.env.VAULT_BASE_RPC_URL ?? SEPOLIA_RPC;
  const contractAddress = opts.contractAddress ?? (process.env.VAULT_REPUTATION_CONTRACT as Address | undefined) ?? SEPOLIA_REPUTATION;
  const isSepolia = rpcUrl.includes('sepolia') || rpcUrl.includes('84532');

  const reader = opts.reader ?? (await createReputationReader({ rpcUrl, contractAddress }));

  const records: InspectRecord[] = [];
  let anyUntrusted = false;

  if (!opts.json) {
    out.write(`${col.bold('vault inspect')} ${col.dim(`(${config.servers.length} MCP server${config.servers.length === 1 ? '' : 's'})`)}\n`);
    out.write(`  ${col.dim(`config:   ${config.configPath}`)}\n`);
    out.write(`  ${col.dim(`network:  ${isSepolia ? 'Sepolia (testnet)' : rpcUrl}`)}\n`);
    out.write(`  ${col.dim(`contract: ${contractAddress}`)}\n`);
    if (isSepolia) {
      out.write(`  ${col.yellow('⚠ reading from Sepolia testnet — mainnet figures may differ once deployed')}\n`);
    }
    out.write('\n');
  }

  for (const server of config.servers) {
    let evaluation: TrustEval;
    try {
      const raw = await reader.read(server.identifier);
      evaluation = classify(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
      if (opts.json) {
        out.write(JSON.stringify({ name: server.name, identifier: server.identifier, error: msg }) + '\n');
      } else {
        out.write(`  ${col.red('ERROR')}   ${col.cyan(server.name)} — ${msg}\n`);
      }
      continue;
    }

    if (evaluation.verdict === 'UNTRUSTED') anyUntrusted = true;
    const record: InspectRecord = {
      name: server.name, command: server.command, args: server.args,
      identifier: server.identifier, url: server.url,
      verdict: evaluation.verdict,
      score: evaluation.score,
      totalScans: evaluation.totalScans,
      totalBlocks: evaluation.totalBlocks,
      maliciousRate: evaluation.maliciousRate,
    };
    records.push(record);

    if (opts.json) {
      out.write(JSON.stringify(record) + '\n');
    } else {
      const v = padRight(fmtVerdict(evaluation.verdict, col), 11);
      out.write(`  ${v} ${col.cyan(server.name)} ${col.dim(`[${server.identifier}]`)}\n`);
      out.write(`             ${col.dim(`score=${evaluation.score.toFixed(3)} scans=${evaluation.totalScans} blocks=${evaluation.totalBlocks} maliciousRate=${(evaluation.maliciousRate * 100).toFixed(1)}%`)}\n`);
    }
  }

  if (!opts.json) {
    out.write('\n');
    if (anyUntrusted) {
      out.write(`  ${col.red('⚠ at least one server is UNTRUSTED — consider removing it from your config.')}\n`);
    }
  }
  return opts.strict && anyUntrusted ? 1 : 0;
}

export async function runInspectCli(argv: string[]): Promise<number> {
  let parsed: InspectOptions & { help?: boolean };
  try {
    parsed = parseInspectArgs(argv);
  } catch (err) {
    process.stderr.write(`vault inspect: ${err instanceof Error ? err.message : String(err)}\n`);
    process.stderr.write(HELP);
    return 2;
  }
  if (parsed.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (!parsed.configPath && !parsed.contractAddress) {
    // For first-time users, surface where we're going to look.
    process.stderr.write(`vault inspect: reading config from ${defaultConfigPath()}\n`);
  }
  return runInspect(parsed);
}
