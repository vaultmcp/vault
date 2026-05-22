/// vault history — print recent scans from the local SQLite store.
/// Filters: --server, --verdict, --since, --json, --limit.

import { createScanStore, defaultDbPath, type ScanFilter, type ScanRecord } from '../persistence/index.js';
import { existsSync } from 'node:fs';

export interface HistoryOptions {
  out?: { write(s: string): void };
  noColor?: boolean;
  dbPath?: string;
  filter?: ScanFilter;
  json?: boolean;
}

const HELP = `vault history — show recent local scan history

Usage:
  vault history [flags]

Flags
  --server <key>     filter by serverKey (e.g. http://... or stdio:npx:<pkg>)
  --verdict <v>      clean | suspicious | malicious
  --since <when>     ISO date, '24h', '7d', '30d', or unix-ms
  --limit <n>        max rows (default 50)
  --json             output one JSON record per line
  --db <path>        override DB path (default ~/.vault/scans.db)
  --help, -h         this help

Notes
  Local-only. Reads ~/.vault/scans.db written when the proxy ran with VAULT_PERSIST=1.
`;

function parseSince(raw: string): number {
  const m = /^(\d+)([hd])$/.exec(raw);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2] === 'h' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    return Date.now() - n * unit;
  }
  const asNum = Number(raw);
  if (Number.isFinite(asNum) && asNum > 1_000_000_000_000) return asNum; // ms epoch
  const asDate = Date.parse(raw);
  if (Number.isFinite(asDate)) return asDate;
  throw new Error(`--since: cannot parse '${raw}' (try '24h', '7d', ISO date, or unix-ms)`);
}

export function parseHistoryArgs(argv: string[]): HistoryOptions & { help?: boolean } {
  const out: HistoryOptions & { help?: boolean } = { filter: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { out.help = true; continue; }
    if (a === '--json') { out.json = true; continue; }
    if (a === '--server') { out.filter!.serverKey = argv[++i]; continue; }
    if (a === '--verdict') {
      const v = argv[++i];
      if (v !== 'clean' && v !== 'suspicious' && v !== 'malicious') {
        throw new Error(`--verdict must be clean|suspicious|malicious, got '${v}'`);
      }
      out.filter!.verdict = v;
      continue;
    }
    if (a === '--since') { out.filter!.since = parseSince(argv[++i]!); continue; }
    if (a === '--limit') { out.filter!.limit = Number.parseInt(argv[++i]!, 10); continue; }
    if (a === '--db') { out.dbPath = argv[++i]; continue; }
    if (a && a.startsWith('--')) throw new Error(`unknown flag: ${a}`);
  }
  return out;
}

function ansi(useColor: boolean) {
  const c = (s: string, code: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
  return {
    red: (s: string) => c(s, '31'),
    yellow: (s: string) => c(s, '33'),
    green: (s: string) => c(s, '32'),
    cyan: (s: string) => c(s, '36'),
    dim: (s: string) => c(s, '2;37'),
    bold: (s: string) => c(s, '1'),
  };
}

function fmtVerdict(v: string, col: ReturnType<typeof ansi>): string {
  if (v === 'malicious') return col.red('✗ MALICIOUS');
  if (v === 'suspicious') return col.yellow('⚠ SUSPICIOUS');
  return col.green('✓ CLEAN');
}

function fmtAge(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function runHistory(opts: HistoryOptions = {}): number {
  const out = opts.out ?? process.stdout;
  const hasTTY = process.stdout.isTTY === true;
  const useColor = opts.noColor === true ? false : hasTTY && !process.env.NO_COLOR;
  const col = ansi(useColor);

  const dbPath = opts.dbPath ?? process.env.VAULT_PERSIST_PATH ?? defaultDbPath();
  if (!existsSync(dbPath)) {
    out.write(`vault history: no scan database at ${dbPath}\n`);
    out.write(`  Run vault with VAULT_PERSIST=1 to start recording scans.\n`);
    return 1;
  }

  const store = createScanStore({ enabled: true, dbPath, retentionDays: 0 /* don't purge on read */ });
  if (!store.enabled) {
    out.write(`vault history: failed to open ${dbPath}\n`);
    return 1;
  }

  const rows: ScanRecord[] = store.list({ ...opts.filter, limit: opts.filter?.limit ?? 50 });

  if (opts.json) {
    for (const r of rows) out.write(JSON.stringify(r) + '\n');
    store.close();
    return 0;
  }

  if (rows.length === 0) {
    out.write('No matching scans.\n');
    store.close();
    return 0;
  }

  out.write(`${col.bold(`${rows.length} scan${rows.length === 1 ? '' : 's'}`)} ${col.dim(`from ${dbPath}`)}\n\n`);
  for (const r of rows) {
    out.write(`${fmtVerdict(r.verdict, col)} ${col.dim(fmtAge(r.ts))} `);
    out.write(`${col.cyan(r.toolName)} ${col.dim(`[L${r.layer ?? '?'} conf=${r.confidence.toFixed(2)} server=${r.serverKey}]`)}\n`);
    if (r.contentPreview) {
      out.write(`  ${col.dim(r.contentPreview.replace(/\n+/g, ' ').slice(0, 160))}\n`);
    }
  }

  store.close();
  return 0;
}

export function runHistoryCli(argv: string[]): number {
  let parsed: HistoryOptions & { help?: boolean };
  try {
    parsed = parseHistoryArgs(argv);
  } catch (err) {
    process.stderr.write(`vault history: ${err instanceof Error ? err.message : String(err)}\n`);
    process.stderr.write(HELP);
    return 2;
  }
  if (parsed.help) {
    process.stdout.write(HELP);
    return 0;
  }
  return runHistory(parsed);
}
