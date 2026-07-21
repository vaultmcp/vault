import type { CapabilityConfig, CapabilityMode, TradePolicyConfig } from './capability/index.js';
import type { ManifestConfig, ManifestMode } from './manifest/index.js';
import type { TelemetryConfig } from './telemetry/index.js';
import type { AuditConfig } from './audit/index.js';
import type { AttestationConfig } from './attestation/index.js';
import { loadScanStoreConfig, type ScanStoreConfig } from './persistence/index.js';
import type { Hex } from 'viem';

export type VaultMode = 'block' | 'warn' | 'log';

export interface VaultConfig {
  mode: VaultMode;
  capability: CapabilityConfig;
  tradePolicy: TradePolicyConfig;
  manifest: ManifestConfig;
  telemetry: TelemetryConfig;
  audit: AuditConfig;
  attestation: AttestationConfig;
  persistence: ScanStoreConfig;
}

export function loadConfig(): VaultConfig {
  const raw = process.env.VAULT_MODE?.toLowerCase();
  const mode: VaultMode = raw === 'warn' || raw === 'log' ? raw : 'block';
  return {
    mode,
    capability: loadCapabilityConfig(),
    tradePolicy: loadTradePolicyConfig(),
    manifest: loadManifestConfig(),
    telemetry: loadTelemetryConfig(),
    audit: loadAuditConfig(),
    attestation: loadAttestationConfig(),
    persistence: loadScanStoreConfig(),
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
  // Optional — trade attestation stays off until this schema UID is set, independent of scans.
  const tradeReceiptSchema = process.env.VAULT_TRADE_RECEIPT_SCHEMA as Hex | undefined;

  const addresses =
    eas && scanReceiptSchema && threatRecordSchema
      ? { eas, scanReceiptSchema, threatRecordSchema, tradeReceiptSchema, vaultReputation }
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

function compilePatterns(raw: string | undefined, defaults: RegExp[]): RegExp[] {
  if (!raw) return defaults;
  const out: RegExp[] = [];
  for (const piece of raw.split(',')) {
    const trimmed = piece.trim();
    if (!trimmed) continue;
    try {
      out.push(new RegExp(trimmed, 'i'));
    } catch {
      process.stderr.write(`vault: invalid trade-policy pattern '${trimmed}', skipping\n`);
    }
  }
  return out.length > 0 ? out : defaults;
}

function csvList(raw: string | undefined, defaults: string[]): string[] {
  if (raw === undefined) return defaults;
  const out = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return out.length > 0 ? out : defaults;
}

function loadTradePolicyConfig(): TradePolicyConfig {
  const flag = process.env.VAULT_TRADE_GUARD?.toLowerCase();
  const enabled = flag === '1' || flag === 'true' || flag === 'on';
  const modeRaw = process.env.VAULT_TRADE_GUARD_MODE?.toLowerCase();
  const mode: CapabilityMode = modeRaw === 'warn' ? 'warn' : 'block';

  const recipientAllowlist = new Set(
    (process.env.VAULT_TRADE_ALLOWLIST ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

  const swapPatterns = compilePatterns(process.env.VAULT_TRADE_SWAP_TOOLS, [
    /swap/i,
    /trade/i,
    /transfer/i,
    /^send(_|$)/i,
    /execute_?swap/i,
  ]);
  const approvePatterns = compilePatterns(process.env.VAULT_TRADE_APPROVE_TOOLS, [
    /approve/i,
    /allowance/i,
    /permit/i,
  ]);
  const recipientKeys = csvList(process.env.VAULT_TRADE_RECIPIENT_KEYS, [
    'recipient',
    'to',
    'spender',
    'destination',
    'dest',
    'receiver',
  ]);
  const amountKeys = csvList(process.env.VAULT_TRADE_AMOUNT_KEYS, [
    'amount',
    'amountIn',
    'value',
    'allowance',
    'approvalAmount',
  ]);
  const tokenKeys = csvList(process.env.VAULT_TRADE_TOKEN_KEYS, [
    'symbol',
    'token',
    'tokenOut',
    'asset',
    'ticker',
  ]);

  const bigintEnv = (raw: string | undefined, def: bigint | null): bigint | null => {
    if (!raw || !/^\d+$/.test(raw.trim())) return def;
    try {
      return BigInt(raw.trim());
    } catch {
      return def;
    }
  };

  const maxApproval = bigintEnv(process.env.VAULT_TRADE_MAX_APPROVAL, 2n ** 200n) ?? 2n ** 200n;
  const maxTradeValue = bigintEnv(process.env.VAULT_TRADE_MAX_VALUE, null);
  const maxValuePerWindow = bigintEnv(process.env.VAULT_TRADE_MAX_VALUE_PER_WINDOW, null);
  const maxValuePerToken = bigintEnv(process.env.VAULT_TRADE_MAX_VALUE_PER_TOKEN, null);

  const rawPerWindow = process.env.VAULT_TRADE_MAX_PER_WINDOW;
  const maxPerWindow =
    rawPerWindow && /^\d+$/.test(rawPerWindow.trim()) ? Number.parseInt(rawPerWindow.trim(), 10) : null;

  const rawBreaker = process.env.VAULT_TRADE_BREAKER_THRESHOLD;
  const breakerThreshold =
    rawBreaker && /^\d+$/.test(rawBreaker.trim()) ? Number.parseInt(rawBreaker.trim(), 10) : null;

  const marketHours = parseMarketHours(process.env.VAULT_TRADE_MARKET_HOURS);
  const windowMs = positiveInt(process.env.VAULT_TRADE_WINDOW_MS, 60_000);

  return {
    enabled,
    mode,
    recipientAllowlist,
    swapPatterns,
    approvePatterns,
    recipientKeys,
    amountKeys,
    tokenKeys,
    maxApproval,
    maxTradeValue,
    maxPerWindow,
    maxValuePerWindow,
    maxValuePerToken,
    breakerThreshold,
    marketHours,
    windowMs,
  };
}

/// Parse "HH:MM-HH:MM" (UTC) into minutes-of-day. Returns null on anything malformed,
/// which leaves the market always open.
function parseMarketHours(raw: string | undefined): { startMin: number; endMin: number } | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [sh, sm, eh, em] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (sh > 23 || eh > 23 || sm > 59 || em > 59) return null;
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  if (endMin <= startMin) return null;
  return { startMin, endMin };
}

function positiveInt(raw: string | undefined, def: number): number {
  if (!raw) return def;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}
