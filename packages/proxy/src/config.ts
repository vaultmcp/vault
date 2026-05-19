import type { CapabilityConfig, CapabilityMode } from './capability/index.js';
import type { ManifestConfig, ManifestMode } from './manifest/index.js';
import type { TelemetryConfig } from './telemetry/index.js';
import type { AuditConfig } from './audit/index.js';

export type VaultMode = 'block' | 'warn' | 'log';

export interface VaultConfig {
  mode: VaultMode;
  capability: CapabilityConfig;
  manifest: ManifestConfig;
  telemetry: TelemetryConfig;
  audit: AuditConfig;
}

export function loadConfig(): VaultConfig {
  const raw = process.env.VAULT_MODE?.toLowerCase();
  const mode: VaultMode = raw === 'warn' || raw === 'log' ? raw : 'block';
  return {
    mode,
    capability: loadCapabilityConfig(),
    manifest: loadManifestConfig(),
    telemetry: loadTelemetryConfig(),
    audit: loadAuditConfig(),
  };
}

function loadAuditConfig(): AuditConfig {
  const filepath = process.env.VAULT_AUDIT_LOG;
  return { enabled: !!filepath, filepath };
}

function loadTelemetryConfig(): TelemetryConfig {
  // Default-on once a collector URL is configured. Opt out with VAULT_TELEMETRY in
  // {0, false, off, no}. See packages/proxy/PRIVACY.md.
  const flag = process.env.VAULT_TELEMETRY?.toLowerCase();
  const explicitlyOff =
    flag === '0' || flag === 'false' || flag === 'off' || flag === 'no';
  const explicitlyOn = flag === '1' || flag === 'true' || flag === 'on';
  const url = process.env.VAULT_TELEMETRY_URL;
  const enabled = !explicitlyOff && !!url;
  const secret = process.env.VAULT_TELEMETRY_SECRET;
  const batchSize = positiveInt(process.env.VAULT_TELEMETRY_BATCH, 100);
  const flushIntervalMs = positiveInt(process.env.VAULT_TELEMETRY_FLUSH_MS, 5000);
  return {
    enabled,
    url,
    secret,
    batchSize,
    flushIntervalMs,
    bannerOnStart: enabled && !explicitlyOn, // implicit-on path
  };
}

function loadManifestConfig(): ManifestConfig {
  const raw = process.env.VAULT_MANIFEST_CHECK?.toLowerCase();
  let mode: ManifestMode;
  if (raw === 'off' || raw === '0' || raw === 'false') mode = 'off';
  else if (raw === 'strict') mode = 'strict';
  else mode = 'on';
  const cacheDir = process.env.VAULT_MANIFEST_CACHE_DIR;
  return { mode, cacheDir };
}

function loadCapabilityConfig(): CapabilityConfig {
  const flag = process.env.VAULT_CAPABILITY?.toLowerCase();
  const enabled = flag === '1' || flag === 'true' || flag === 'on';
  const modeRaw = process.env.VAULT_CAPABILITY_MODE?.toLowerCase();
  const mode: CapabilityMode = modeRaw === 'warn' ? 'warn' : 'block';

  const extraPatterns: RegExp[] = [];
  const rawPatterns = process.env.VAULT_SENSITIVE_TOOL_PATTERNS ?? '';
  for (const piece of rawPatterns.split(',')) {
    const trimmed = piece.trim();
    if (!trimmed) continue;
    try {
      extraPatterns.push(new RegExp(trimmed, 'i'));
    } catch {
      process.stderr.write(`vault: invalid VAULT_SENSITIVE_TOOL_PATTERNS entry '${trimmed}', skipping\n`);
    }
  }

  const minOverlap = positiveInt(process.env.VAULT_TAINT_MIN_OVERLAP, 32);
  const windowSize = positiveInt(process.env.VAULT_TAINT_WINDOW_SIZE, 10);

  return { enabled, mode, extraPatterns, minOverlap, windowSize };
}

function positiveInt(raw: string | undefined, def: number): number {
  if (!raw) return def;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}
