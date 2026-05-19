/// Audit logger — durable, structured, append-only JSONL of every decision Vault makes.
/// Designed for the "run in log mode for a week, see what would've been blocked" use case.
/// Writes the full unredacted decision context (operator-only, never leaves the host).

import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import path from 'node:path';

export interface AuditConfig {
  enabled: boolean;
  filepath?: string;
}

export interface DetectionAuditEntry {
  type: 'detection';
  ts: number;
  toolName: string;
  layer: number | null;
  verdict: 'clean' | 'suspicious' | 'malicious';
  confidence: number;
  patterns: string[];
  mode: string;
  mutated: boolean;
  reasoning?: string;
  contentPreview?: string;
}

export interface CapabilityAuditEntry {
  type: 'capability';
  ts: number;
  toolName: string;
  action: 'allow' | 'block' | 'warn';
  matchedPattern?: string;
  taintSources?: string[];
  reason?: string;
  argsPreview?: string;
}

export interface ManifestAuditEntry {
  type: 'manifest';
  ts: number;
  serverKey: string;
  fingerprint: string;
  status: 'first-seen' | 'unchanged' | 'drift';
  changes: string[];
}

export type AuditEntry = DetectionAuditEntry | CapabilityAuditEntry | ManifestAuditEntry;

export type AuditEntryInput =
  | Omit<DetectionAuditEntry, 'ts'>
  | Omit<CapabilityAuditEntry, 'ts'>
  | Omit<ManifestAuditEntry, 'ts'>;

export interface AuditLogger {
  readonly enabled: boolean;
  log(entry: AuditEntryInput): void;
  shutdown(): Promise<void>;
}

const NOOP: AuditLogger = {
  enabled: false,
  log() {},
  async shutdown() {},
};

export function createAuditLogger(config: AuditConfig): AuditLogger {
  if (!config.enabled || !config.filepath) return NOOP;

  let stream: WriteStream;
  try {
    const dir = path.dirname(config.filepath);
    if (dir && dir !== '.') mkdirSync(dir, { recursive: true });
    stream = createWriteStream(config.filepath, { flags: 'a' });
  } catch (err) {
    process.stderr.write(
      `vault: audit log unavailable at ${config.filepath} (${err instanceof Error ? err.message : String(err)}); disabling\n`,
    );
    return NOOP;
  }

  stream.on('error', (err) => {
    process.stderr.write(`vault: audit log write error: ${err.message}\n`);
  });

  let closed = false;

  return {
    enabled: true,
    log(entry: AuditEntryInput) {
      if (closed) return;
      stream.write(JSON.stringify({ ...(entry as object), ts: Date.now() }) + '\n');
    },
    shutdown() {
      if (closed) return Promise.resolve();
      closed = true;
      return new Promise<void>((resolve) => {
        stream.end(() => resolve());
      });
    },
  };
}

export function preview(text: string, max = 200): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `...[+${text.length - max} chars]`;
}
