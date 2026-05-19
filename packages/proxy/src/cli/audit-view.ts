/// vault-audit — pretty-print and filter the JSONL audit log emitted by VAULT_AUDIT_LOG.
/// Lets operators eyeball what would have been blocked when running in `VAULT_MODE=log`
/// before flipping enforcement on.
///
/// Usage:
///   vault-audit                     # reads ${VAULT_AUDIT_LOG:-/tmp/vault-audit.jsonl}
///   vault-audit path/to/audit.jsonl
///   vault-audit --type capability --verdict malicious
///   vault-audit --tool read_file --since 1h
///   cat audit.jsonl | vault-audit -

import { readFileSync, existsSync } from 'node:fs';

interface AuditRow {
  ts: number;
  type: 'detection' | 'capability' | 'manifest';
  // detection
  toolName?: string;
  verdict?: 'clean' | 'suspicious' | 'malicious';
  layer?: number | null;
  confidence?: number;
  patterns?: string[];
  mode?: string;
  mutated?: boolean;
  reasoning?: string;
  contentPreview?: string;
  // capability
  action?: 'allow' | 'block' | 'warn';
  matchedPattern?: string;
  taintSources?: string[];
  reason?: string;
  argsPreview?: string;
  // manifest
  serverKey?: string;
  fingerprint?: string;
  status?: 'first-seen' | 'unchanged' | 'drift';
  changes?: string[];
}

interface Filter {
  type?: string;
  verdict?: string;
  tool?: string;
  sinceMs?: number;
  raw?: boolean;
}

const HELP = `vault-audit — pretty-print the Vault audit JSONL

Usage:
  vault-audit [path]                  default: \$VAULT_AUDIT_LOG or /tmp/vault-audit.jsonl
  vault-audit -                       read from stdin
  vault-audit --type capability       filter by event type (detection|capability|manifest)
  vault-audit --verdict malicious     filter by verdict (clean|suspicious|malicious)
  vault-audit --tool read_file        filter by tool name
  vault-audit --since 1h              only events newer than 1h (s/m/h/d)
  vault-audit --raw                   one line per event, no color (for grep/jq pipelines)
`;

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

function verdictPaint(v: string | undefined): string {
  if (v === 'malicious') return red(bold('malicious'));
  if (v === 'suspicious') return yellow('suspicious');
  if (v === 'clean') return green('clean');
  return dim(v ?? '?');
}

function actionPaint(a: string | undefined): string {
  if (a === 'block') return red(bold('block'));
  if (a === 'warn') return yellow('warn');
  if (a === 'allow') return green('allow');
  return dim(a ?? '?');
}

function statusPaint(s: string | undefined): string {
  if (s === 'drift') return red(bold('drift'));
  if (s === 'first-seen') return cyan('first-seen');
  if (s === 'unchanged') return dim('unchanged');
  return dim(s ?? '?');
}

// ---- parsing -------------------------------------------------------------

function parseSince(raw: string): number | undefined {
  const m = /^(\d+)([smhd])$/.exec(raw);
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = m[2];
  const mult = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return Date.now() - n * mult;
}

function parseArgs(argv: string[]): { filter: Filter; path?: string; help: boolean } {
  const filter: Filter = {};
  let path: string | undefined;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') help = true;
    else if (a === '--type') filter.type = argv[++i];
    else if (a === '--verdict') filter.verdict = argv[++i];
    else if (a === '--tool') filter.tool = argv[++i];
    else if (a === '--since') {
      const next = argv[++i] ?? '';
      filter.sinceMs = parseSince(next);
    } else if (a === '--raw') filter.raw = true;
    else if (a && !a.startsWith('--')) path = a;
  }
  return { filter, path, help };
}

function loadSource(path: string | undefined): string {
  if (path === '-') return readStdin();
  const resolved = path ?? process.env.VAULT_AUDIT_LOG ?? '/tmp/vault-audit.jsonl';
  if (!existsSync(resolved)) {
    throw new Error(`audit log not found: ${resolved}`);
  }
  return readFileSync(resolved, 'utf8');
}

function readStdin(): string {
  const chunks: Buffer[] = [];
  const fd = 0;
  // Synchronous stdin read for CLI simplicity.
  const buf = Buffer.alloc(64 * 1024);
  try {
    for (;;) {
      const { readFileSync: _rfs } = require('node:fs') as typeof import('node:fs');
      // Fallback: just read all of stdin via /dev/stdin if available.
      try {
        return _rfs('/dev/stdin', 'utf8');
      } catch {
        break;
      }
    }
  } catch {
    /* ignore */
  }
  // Last resort, build from sync reads.
  const fs = require('node:fs') as typeof import('node:fs');
  let total = 0;
  try {
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      chunks.push(buf.slice(0, n) as unknown as Buffer);
      total += n;
      if (total > 100 * 1024 * 1024) break; // safety cap
    }
  } catch {
    /* ignore */
  }
  return Buffer.concat(chunks).toString('utf8');
}

function passesFilter(row: AuditRow, f: Filter): boolean {
  if (f.type && row.type !== f.type) return false;
  if (f.verdict && row.verdict !== f.verdict) return false;
  if (f.tool && row.toolName !== f.tool) return false;
  if (f.sinceMs && row.ts < f.sinceMs) return false;
  return true;
}

function fmtTs(ts: number): string {
  const d = new Date(ts);
  return d.toISOString().replace('T', ' ').replace(/\..+/, '');
}

// ---- rendering -----------------------------------------------------------

function renderRow(row: AuditRow, raw: boolean): string {
  if (raw) return JSON.stringify(row);

  const t = dim(fmtTs(row.ts));

  if (row.type === 'detection') {
    const v = verdictPaint(row.verdict);
    const L = row.layer != null ? `L${row.layer}` : 'L?';
    const m = row.mutated ? red('mut') : dim('-');
    const tool = cyan(row.toolName ?? '?');
    const preview = (row.contentPreview ?? '').slice(0, 80).replace(/\n/g, ' ');
    const patterns = row.patterns && row.patterns.length > 0 ? dim(` [${row.patterns.slice(0, 3).join(',')}]`) : '';
    return `${t}  ${dim('det')}  ${L}  ${v}  ${tool}  mode=${row.mode ?? '?'}  ${m}${patterns}\n         ${dim('└')} ${preview}`;
  }
  if (row.type === 'capability') {
    const a = actionPaint(row.action);
    const tool = cyan(row.toolName ?? '?');
    const sources = row.taintSources && row.taintSources.length > 0 ? dim(` ← ${row.taintSources.slice(0, 3).join(',')}`) : '';
    const args = (row.argsPreview ?? '').slice(0, 80).replace(/\n/g, ' ');
    return `${t}  ${dim('cap')}  --  ${a}      ${tool}${sources}\n         ${dim('└')} ${args}`;
  }
  if (row.type === 'manifest') {
    const s = statusPaint(row.status);
    const fp = dim((row.fingerprint ?? '').slice(0, 12));
    const changes = row.changes && row.changes.length > 0
      ? '\n         ' + row.changes.map((c) => dim('└ ') + yellow(c)).join('\n         ')
      : '';
    return `${t}  ${dim('mfs')}  --  ${s}  ${fp}${changes}`;
  }
  return JSON.stringify(row);
}

function summarize(rows: AuditRow[]): string {
  const byType: Record<string, number> = { detection: 0, capability: 0, manifest: 0 };
  const byVerdict: Record<string, number> = { clean: 0, suspicious: 0, malicious: 0 };
  const byAction: Record<string, number> = { allow: 0, warn: 0, block: 0 };
  const byManifest: Record<string, number> = { 'first-seen': 0, unchanged: 0, drift: 0 };
  const tools = new Map<string, number>();
  for (const r of rows) {
    byType[r.type] = (byType[r.type] ?? 0) + 1;
    if (r.verdict) byVerdict[r.verdict] = (byVerdict[r.verdict] ?? 0) + 1;
    if (r.action) byAction[r.action] = (byAction[r.action] ?? 0) + 1;
    if (r.status) byManifest[r.status] = (byManifest[r.status] ?? 0) + 1;
    if (r.toolName) tools.set(r.toolName, (tools.get(r.toolName) ?? 0) + 1);
  }
  const topTools = [...tools.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const lines: string[] = [];
  lines.push('');
  lines.push(dim('────────────────────────────────────────────'));
  lines.push(bold('summary'));
  lines.push(`  events:   ${rows.length}`);
  lines.push(
    `  by type:  detection=${byType.detection}  capability=${byType.capability}  manifest=${byType.manifest}`,
  );
  lines.push(
    `  verdicts: ${green(`clean=${byVerdict.clean}`)}  ${yellow(`suspicious=${byVerdict.suspicious}`)}  ${red(`malicious=${byVerdict.malicious}`)}`,
  );
  lines.push(
    `  actions:  ${green(`allow=${byAction.allow}`)}  ${yellow(`warn=${byAction.warn}`)}  ${red(`block=${byAction.block}`)}`,
  );
  lines.push(
    `  manifest: ${cyan(`first-seen=${byManifest['first-seen']}`)}  ${dim(`unchanged=${byManifest.unchanged}`)}  ${red(`drift=${byManifest.drift}`)}`,
  );
  if (topTools.length > 0) {
    lines.push(`  top tools: ${topTools.map(([t, n]) => `${cyan(t)}:${n}`).join('  ')}`);
  }
  return lines.join('\n');
}

// ---- exports / entry -----------------------------------------------------

export function parseJsonl(raw: string): AuditRow[] {
  const rows: AuditRow[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      /* skip malformed lines */
    }
  }
  return rows;
}

export function render(rows: AuditRow[], filter: Filter): string {
  const matched = rows.filter((r) => passesFilter(r, filter));
  const lines = matched.map((r) => renderRow(r, filter.raw ?? false));
  if (filter.raw) return lines.join('\n');
  return lines.join('\n') + '\n' + summarize(matched);
}

function main(): void {
  const argv = process.argv.slice(2);
  const { filter, path, help } = parseArgs(argv);
  if (help) {
    process.stdout.write(HELP);
    process.exit(0);
  }
  let raw: string;
  try {
    raw = loadSource(path);
  } catch (err) {
    process.stderr.write(`vault-audit: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  }
  const rows = parseJsonl(raw);
  process.stdout.write(render(rows, filter) + '\n');
}

main();
