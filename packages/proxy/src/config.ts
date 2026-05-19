import type { CapabilityConfig, CapabilityMode } from './capability/index.js';
import type { ManifestConfig, ManifestMode } from './manifest/index.js';
import type { TelemetryConfig } from './telemetry/index.js';
import type { AuditConfig } from './audit/index.js';
import type { AttestationConfig } from './attestation/index.js';
import type { Hex } from 'viem';

export type VaultMode = 'block' | 'warn' | 'log';

export interface VaultConfig {
  mode: VaultMode;
  capability: CapabilityConfig;
  manifest: ManifestConfig;
  telemetry: TelemetryConfig;
  audit: AuditConfig;
  attestation: AttestationConfig;
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
    attestation: loadAttestationConfig(),
  };
}

// Deployed Base Sepolia addresses (chain 84532). Used as defaults when the RPC URL points
// at Base Sepolia and the operator hasn't overridden the schema UIDs manually.
const SEPOLIA_DEFAULTS = {
  eas: '0x4200000000000000000000000000000000000021' as Hex,
  scanReceiptSchema: '0xc1d5e8e4f62f3652366e7c7b75d8d77ff8ca59e85f307935d4bffbe61c68f9ec' as Hex,
  threatRecordSchema: '0xae2b5da24401f0a261dd6cfbbc300fddafcf47692c71d968e0942cba2177dd65' as Hex,
  vaultReputation: '0x3A977E4D8BA43367cc41BB4695feFF4615fec189' as Hex,
} as const;

function isSepolia(rpcUrl: string): boolean {
  return rpcUrl.includes('sepolia') || rpcUrl.includes('84532');
}

function loadAttestationConfig(): AttestationConfig {
  const flag = process.env.VAULT_ATTEST?.toLowerCase();
  const enabled = flag === '1' || flag === 'true' || flag === 'on';
  const rpcUrl = process.env.VAULT_BASE_RPC_URL ?? 'https://mainnet.base.org';
  const privateKey = process.env.VAULT_ATTESTER_PRIVATE_KEY as Hex | undefined;

  const defaults = isSepolia(rpcUrl) ? SEPOLIA_DEFAULTS : null;
  const eas = (process.env.VAULT_EAS_ADDRESS as Hex | undefined) ?? defaults?.eas;
  const scanReceiptSchema =
    (process.env.VAULT_SCAN_RECEIPT_SCHEMA as Hex | undefined) ?? defaults?.scanReceiptSchema;
  const threatRecordSchema =
    (process.env.VAULT_THREAT_RECORD_SCHEMA as Hex | undefined) ?? defaults?.threatRecordSchema;
  const vaultReputation =
    (process.env.VAULT_REPUTATION_CONTRACT as Hex | undefined) ?? defaults?.vaultReputation;

  const addresses =
    eas && scanReceiptSchema && threatRecordSchema
      ? { eas, scanReceiptSchema, threatRecordSchema, vaultReputation }
      : undefined;

  const batchSize = positiveInt(process.env.VAULT_ATTEST_BATCH, 50);
  const flushIntervalMs = positiveInt(process.env.VAULT_ATTEST_FLUSH_MS, 5000);
  const sampleRaw = process.env.VAULT_ATTEST_SAMPLE_RATE_L1L2;
  const sampleParsed = sampleRaw ? Number.parseFloat(sampleRaw) : NaN;
  const sampleRateL1L2 =
    Number.isFinite(sampleParsed) && sampleParsed >= 0 && sampleParsed <= 1 ? sampleParsed : 0.1;

  return {
    enabled,
    rpcUrl,
    privateKey,
    addresses,
    batchSize,
    flushIntervalMs,
    sampleRateL1L2,
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
