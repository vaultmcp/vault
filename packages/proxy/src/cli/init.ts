/// vault init — detect MCP configs on this machine and wrap every server's command
/// with `npx @vaultmcp/mcp-proxy --`, so the proxy intercepts tool responses before they
/// reach the agent. Idempotent. Backs up each config to <config>.vault-backup before
/// writing.
///
/// Usage:
///   vault init                       # interactive: diff preview, confirm before writing
///   vault init --yes                 # skip confirmation
///   vault init --dry-run             # show diff, do not write
///   vault init unwrap                # restore original commands (uses .vault-backup)
///   vault init --config <path>       # operate on a specific config file
///
/// Edge cases handled:
///   - HTTP/SSE servers ({"url": ...}) wrap as `--transport http --upstream <url>`
///   - bash -c "..." commands: warned, skipped (cannot wrap cleanly)
///   - Already-wrapped: silent skip, counted in summary
///   - Relative paths in args: resolved to absolute using the config file's directory
///   - {disabled: true} entries: skipped, preserved as-is

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';

// ---- ANSI ----------------------------------------------------------------

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

const HELP = `vault init — wrap your MCP servers with the Vault proxy

Usage:
  vault init                   detect configs, show diff, confirm, write
  vault init --yes             skip confirmation
  vault init --dry-run         preview only, never write
  vault init unwrap            restore from .vault-backup files
  vault init --config <path>   operate on one specific config file
  vault init --help, -h        this help

Telemetry is OFF by default for newly-wrapped servers. To opt in, set
VAULT_TELEMETRY=1 in your shell or in the wrapped server's env block.

Backups: every modified file is copied to <path>.vault-backup before writing.
Re-running vault init is safe — already-wrapped servers are skipped.
`;

// ---- Types ---------------------------------------------------------------

export interface McpServerEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  disabled?: boolean;
  [k: string]: unknown;
}

export interface McpConfig {
  mcpServers?: Record<string, McpServerEntry>;
  [k: string]: unknown;
}

export type WrapAction =
  | { kind: 'wrap-stdio'; name: string; before: McpServerEntry; after: McpServerEntry }
  | { kind: 'wrap-http'; name: string; before: McpServerEntry; after: McpServerEntry }
  | { kind: 'skip-wrapped'; name: string }
  | { kind: 'skip-disabled'; name: string }
  | { kind: 'skip-bash-shell'; name: string; reason: string }
  | { kind: 'skip-invalid'; name: string; reason: string };

export interface ConfigPlan {
  path: string;
  exists: boolean;
  actions: WrapAction[];
}

interface ParsedArgs {
  command: 'init' | 'unwrap';
  yes: boolean;
  dryRun: boolean;
  configOverride?: string;
  showHelp: boolean;
}

// ---- Parse ---------------------------------------------------------------

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { command: 'init', yes: false, dryRun: false, showHelp: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.showHelp = true;
    else if (a === '--yes' || a === '-y') out.yes = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--config') out.configOverride = argv[++i];
    else if (a === 'unwrap') out.command = 'unwrap';
    else if (a === 'init') out.command = 'init';
    else if (a?.startsWith('--')) throw new Error(`unknown flag: ${a}`);
  }
  return out;
}

// ---- Config discovery ----------------------------------------------------

export function defaultConfigPaths(): string[] {
  const home = os.homedir();
  const paths: string[] = [];
  if (process.platform === 'darwin') {
    paths.push(path.join(home, 'Library/Application Support/Claude/claude_desktop_config.json'));
  } else if (process.platform === 'linux') {
    paths.push(path.join(home, '.config/Claude/claude_desktop_config.json'));
  } else if (process.platform === 'win32' && process.env.APPDATA) {
    paths.push(path.join(process.env.APPDATA, 'Claude/claude_desktop_config.json'));
  }
  paths.push(path.join(home, '.claude/mcp_settings.json'));
  paths.push(path.resolve(process.cwd(), '.claude/mcp_settings.json'));
  return paths;
}

// ---- Wrap logic ----------------------------------------------------------

const VAULT_PACKAGE = '@vaultmcp/mcp-proxy';

/// True if the entry is already wrapped by vault (either npx @vaultmcp/mcp-proxy or a global mcp-proxy binary).
export function isAlreadyWrapped(entry: McpServerEntry): boolean {
  const cmd = entry.command?.toLowerCase() ?? '';
  const args = entry.args ?? [];
  if (cmd === 'mcp-proxy' || cmd === 'vault-mcp-proxy') return true;
  if ((cmd === 'npx' || cmd === 'npx.cmd' || cmd === 'bunx') && args.some((a) => a.includes(VAULT_PACKAGE))) {
    return true;
  }
  return false;
}

/// True if the entry uses a shell wrapper we can't safely rewrap.
export function isBashShellCommand(entry: McpServerEntry): boolean {
  const cmd = entry.command?.toLowerCase() ?? '';
  if (cmd !== 'bash' && cmd !== 'sh' && cmd !== 'zsh' && cmd !== 'cmd' && cmd !== 'cmd.exe') return false;
  const args = entry.args ?? [];
  return args.some((a) => a === '-c' || a === '/c');
}

/// Resolve any relative path args to absolute, using the config file's directory as base.
export function resolveRelativeArgs(args: string[], configDir: string): string[] {
  return args.map((a) => {
    if (typeof a !== 'string') return a;
    // Only resolve obvious filesystem path-like args (start with ./ or ../)
    if (a.startsWith('./') || a.startsWith('../')) {
      return path.resolve(configDir, a);
    }
    return a;
  });
}

export function planEntry(name: string, entry: McpServerEntry, configDir: string): WrapAction {
  if (entry.disabled === true) return { kind: 'skip-disabled', name };
  if (isAlreadyWrapped(entry)) return { kind: 'skip-wrapped', name };

  // HTTP/SSE server: { url: "..." } with no command
  if (entry.url && !entry.command) {
    if (!/^https?:\/\//i.test(entry.url)) {
      return { kind: 'skip-invalid', name, reason: `url is not http(s): ${entry.url}` };
    }
    const after: McpServerEntry = {
      ...entry,
      command: 'npx',
      args: ['-y', VAULT_PACKAGE, '--transport', 'http', '--upstream', entry.url],
    };
    delete after.url;
    return { kind: 'wrap-http', name, before: entry, after };
  }

  if (!entry.command) {
    return { kind: 'skip-invalid', name, reason: 'no command or url field' };
  }
  if (isBashShellCommand(entry)) {
    return {
      kind: 'skip-bash-shell',
      name,
      reason: `shell-wrapped command (${entry.command} -c ...) — cannot safely re-wrap`,
    };
  }

  const resolvedArgs = resolveRelativeArgs(entry.args ?? [], configDir);
  const after: McpServerEntry = {
    ...entry,
    command: 'npx',
    args: ['-y', VAULT_PACKAGE, '--', entry.command, ...resolvedArgs],
  };
  return { kind: 'wrap-stdio', name, before: entry, after };
}

export function planConfig(cfgPath: string): ConfigPlan {
  if (!existsSync(cfgPath)) return { path: cfgPath, exists: false, actions: [] };
  let cfg: McpConfig;
  try {
    cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) as McpConfig;
  } catch (e) {
    return {
      path: cfgPath,
      exists: true,
      actions: [{ kind: 'skip-invalid', name: '<file>', reason: `cannot parse JSON: ${(e as Error).message}` }],
    };
  }
  const servers = cfg.mcpServers ?? {};
  const dir = path.dirname(cfgPath);
  const actions: WrapAction[] = [];
  for (const [name, entry] of Object.entries(servers)) {
    actions.push(planEntry(name, entry, dir));
  }
  return { path: cfgPath, exists: true, actions };
}

// ---- Apply ---------------------------------------------------------------

export function applyPlan(plan: ConfigPlan): { wrapped: number; written: boolean } {
  if (!plan.exists) return { wrapped: 0, written: false };
  const cfg = JSON.parse(readFileSync(plan.path, 'utf8')) as McpConfig;
  if (!cfg.mcpServers) return { wrapped: 0, written: false };

  let wrapped = 0;
  for (const a of plan.actions) {
    if (a.kind === 'wrap-stdio' || a.kind === 'wrap-http') {
      cfg.mcpServers[a.name] = a.after;
      wrapped++;
    }
  }
  if (wrapped === 0) return { wrapped: 0, written: false };

  // Backup before writing
  const backupPath = plan.path + '.vault-backup';
  if (!existsSync(backupPath)) {
    copyFileSync(plan.path, backupPath);
  }
  writeFileSync(plan.path, JSON.stringify(cfg, null, 2) + '\n');
  return { wrapped, written: true };
}

export function applyUnwrap(cfgPath: string): { restored: boolean; reason?: string } {
  const backupPath = cfgPath + '.vault-backup';
  if (!existsSync(backupPath)) return { restored: false, reason: 'no .vault-backup file found' };
  copyFileSync(backupPath, cfgPath);
  return { restored: true };
}

// ---- Render diff ---------------------------------------------------------

function renderEntry(e: McpServerEntry): string {
  const view: Record<string, unknown> = {};
  if (e.command) view.command = e.command;
  if (e.args) view.args = e.args;
  if (e.url) view.url = e.url;
  return JSON.stringify(view);
}

export function renderPlan(plan: ConfigPlan): string {
  const lines: string[] = [];
  lines.push(bold(plan.path) + (plan.exists ? '' : dim(' (not found)')));
  if (!plan.exists || plan.actions.length === 0) {
    if (plan.exists) lines.push(dim('  (no mcpServers entries)'));
    return lines.join('\n');
  }
  for (const a of plan.actions) {
    if (a.kind === 'wrap-stdio' || a.kind === 'wrap-http') {
      lines.push(`  ${green('+')} ${bold(a.name)} ${dim(`(${a.kind})`)}`);
      lines.push(`      ${red('-')} ${dim(renderEntry(a.before))}`);
      lines.push(`      ${green('+')} ${renderEntry(a.after)}`);
    } else if (a.kind === 'skip-wrapped') {
      lines.push(`  ${dim('·')} ${a.name} ${dim('already wrapped')}`);
    } else if (a.kind === 'skip-disabled') {
      lines.push(`  ${dim('·')} ${a.name} ${dim('disabled')}`);
    } else if (a.kind === 'skip-bash-shell') {
      lines.push(`  ${yellow('!')} ${a.name} ${yellow('skipped:')} ${dim(a.reason)}`);
    } else if (a.kind === 'skip-invalid') {
      lines.push(`  ${red('!')} ${a.name} ${red('skipped:')} ${dim(a.reason)}`);
    }
  }
  return lines.join('\n');
}

// ---- Confirm prompt ------------------------------------------------------

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim().toLowerCase().startsWith('y'));
    });
  });
}

// ---- Main ----------------------------------------------------------------

export async function runInit(argv: string[]): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`vault init: ${(e as Error).message}\n`);
    process.stderr.write(HELP);
    return 2;
  }
  if (args.showHelp) {
    process.stdout.write(HELP);
    return 0;
  }

  const targets = args.configOverride ? [args.configOverride] : defaultConfigPaths();

  if (args.command === 'unwrap') {
    let restored = 0;
    for (const p of targets) {
      const r = applyUnwrap(p);
      if (r.restored) {
        process.stdout.write(`${green('restored')} ${p}\n`);
        restored++;
      } else if (existsSync(p)) {
        process.stdout.write(dim(`skipped  ${p} (${r.reason})\n`));
      }
    }
    if (restored === 0) {
      process.stderr.write('vault init unwrap: no .vault-backup files found\n');
      return 1;
    }
    return 0;
  }

  const plans = targets.map(planConfig);
  const presentPlans = plans.filter((p) => p.exists);

  if (presentPlans.length === 0) {
    process.stderr.write(
      'vault init: no MCP configs found in default locations.\n' +
        '  Looked in:\n' +
        targets.map((p) => `    - ${p}`).join('\n') +
        '\n  Pass --config <path> to operate on a specific file.\n',
    );
    return 1;
  }

  process.stdout.write(bold('Plan:\n'));
  for (const p of plans) {
    process.stdout.write(renderPlan(p) + '\n');
  }

  const totalWraps = plans.reduce(
    (n, p) => n + p.actions.filter((a) => a.kind === 'wrap-stdio' || a.kind === 'wrap-http').length,
    0,
  );

  if (totalWraps === 0) {
    process.stdout.write(dim('\nNothing to wrap (everything is already wrapped or skipped).\n'));
    return 0;
  }

  if (args.dryRun) {
    process.stdout.write(dim('\n--dry-run: not writing.\n'));
    return 0;
  }

  if (!args.yes) {
    const ok = await confirm(`\nWrap ${totalWraps} server${totalWraps === 1 ? '' : 's'}? [y/N] `);
    if (!ok) {
      process.stderr.write('aborted.\n');
      return 1;
    }
  }

  let wrapped = 0;
  for (const p of plans) {
    const r = applyPlan(p);
    if (r.written) {
      process.stdout.write(`${green('wrote')} ${p.path} ${dim(`(${r.wrapped} wrapped, backup → ${p.path}.vault-backup)`)}\n`);
      wrapped += r.wrapped;
    }
  }

  process.stdout.write('\n' + bold('Next steps:') + '\n');
  process.stdout.write(`  1. Restart Claude Code / Claude Desktop to pick up the new config.\n`);
  process.stdout.write(`  2. ${dim('Telemetry is OFF by default. To share threat data with the Vault network,')}\n`);
  process.stdout.write(`     ${dim('add VAULT_TELEMETRY=1 to your shell or to a wrapped server\'s env block.')}\n`);
  process.stdout.write(`  3. ${dim('Verify with:')} ${cyan('vault check --all')}\n`);
  process.stdout.write(`  4. ${dim('To revert:')} ${cyan('vault init unwrap')}\n`);
  return 0;
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  runInit(process.argv.slice(2)).then((code) => process.exit(code));
}
