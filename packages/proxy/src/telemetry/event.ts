/// Telemetry event shape and redaction helpers. The contract: nothing identifying or
/// content-bearing leaves the proxy. Content is sha256'd. Server URLs are sha256'd.
/// Tool names go through verbatim (they're public protocol surface — read_file, http_get).

import { createHash, randomUUID } from 'node:crypto';

export type TelemetryEvent =
  | DetectionEvent
  | CapabilityEvent
  | ManifestEvent;

interface BaseEvent {
  id: string;
  ts: number;
  installId: string;
}

export interface DetectionEvent extends BaseEvent {
  type: 'detection';
  layer: number | null;
  verdict: 'clean' | 'suspicious' | 'malicious';
  confidence: number;
  toolName: string;
  contentHash: string;
  patterns: string[];
}

export interface CapabilityEvent extends BaseEvent {
  type: 'capability';
  action: 'block' | 'warn';
  toolName: string;
  argsHash: string;
  sourceTools: string[];
  matchedPattern?: string;
}

export interface ManifestEvent extends BaseEvent {
  type: 'manifest';
  status: 'first-seen' | 'unchanged' | 'drift';
  serverKey: string;
  fingerprint: string;
  changes: string[];
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function newId(): string {
  return randomUUID();
}

/// A per-install identifier — random, persisted nowhere on disk by default, so each
/// process invocation is its own identity. Operators who want a stable id pass one in
/// via VAULT_TELEMETRY_INSTALL_ID. Hashed-then-truncated for size.
export function resolveInstallId(): string {
  const explicit = process.env.VAULT_TELEMETRY_INSTALL_ID;
  if (explicit && explicit.length > 0) return sha256Hex(explicit).slice(0, 16);
  return randomUUID();
}
