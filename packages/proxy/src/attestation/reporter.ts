/// Reporter — translates per-scan detection outcomes into one or two AttestationItems
/// (ScanReceipt for every scan emitted by the gate; ThreatRecord additionally for malicious).

import { randomUUID } from 'node:crypto';
import type { Hex } from 'viem';
import type { DetectionResult } from '../detection/types.js';
import { sha256Hex } from '../telemetry/index.js';
import type { AttestationClient } from './client.js';
import type { AttestationItem } from './types.js';

export interface ReportInput {
  toolName: string;
  mcpServerUrl: string;
  contentHash: string; // hex sha256 (already computed by transport)
  result: DetectionResult | null;
  verdict: 'clean' | 'suspicious' | 'malicious';
  layer: number | null;
  /// Set true if the scan was actually performed (vs sampled-out for L1/L2 clean cases).
  shouldEmitReceipt: boolean;
  /// Set true to emit a ThreatRecord paired with the ScanReceipt.
  shouldEmitThreat: boolean;
}

export interface ReporterDeps {
  client: AttestationClient;
  sampleRateL1L2: number;
  /// Override the sampling decision for tests.
  rng?: () => number;
}

export interface ScanReporter {
  enabled: boolean;
  /// Decide what to emit for this scan and enqueue. Returns the routing decision for telemetry/audit.
  report(input: Omit<ReportInput, 'shouldEmitReceipt' | 'shouldEmitThreat'>): {
    emittedReceipt: boolean;
    emittedThreat: boolean;
  };
}

function toHex32(hex: string): Hex {
  const normalized = hex.startsWith('0x') ? hex : `0x${hex}`;
  return normalized as Hex;
}

function verdictCode(v: 'clean' | 'suspicious' | 'malicious'): number {
  return v === 'malicious' ? 2 : v === 'suspicious' ? 1 : 0;
}

function layersBitfield(layer: number | null): number {
  if (layer === 1) return 0b001;
  if (layer === 2) return 0b010;
  if (layer === 3) return 0b100;
  return 0;
}

export function createScanReporter(deps: ReporterDeps): ScanReporter {
  const { client, sampleRateL1L2 } = deps;
  const rng = deps.rng ?? Math.random;

  if (!client.enabled) {
    return { enabled: false, report: () => ({ emittedReceipt: false, emittedThreat: false }) };
  }

  return {
    enabled: true,
    report(input) {
      const isMalicious = input.verdict === 'malicious' && (input.result?.confidence ?? 0) >= 0.7;
      const isSuspicious = input.verdict === 'suspicious';
      const isL3 = input.layer === 3;
      const isCleanFromL1L2 = input.verdict === 'clean' && (input.layer === 1 || input.layer === 2);

      // Decide receipt emission.
      let emitReceipt = false;
      if (isMalicious || isSuspicious) emitReceipt = true;
      else if (isL3) emitReceipt = true; // clean from L3 still attests
      else if (isCleanFromL1L2) emitReceipt = rng() < sampleRateL1L2;

      const emitThreat = isMalicious;

      const scannedAt = BigInt(Math.floor(Date.now() / 1000));
      const receiptLocalId = randomUUID();

      if (emitReceipt) {
        const scan: Extract<AttestationItem, { kind: 'scan' }> = {
          kind: 'scan',
          localId: receiptLocalId,
          payload: {
            contentHash: toHex32(input.contentHash),
            mcpServerUrl: input.mcpServerUrl,
            toolName: input.toolName,
            verdict: verdictCode(input.verdict),
            confidence: Math.max(0, Math.min(100, Math.round((input.result?.confidence ?? 0) * 100))),
            layersRun: layersBitfield(input.layer),
            detectedPatterns: input.result?.detectedPatterns ?? [],
            scannedAt,
          },
        };
        client.enqueueScanReceipt(scan);
      }

      if (emitThreat) {
        const matchedCategory = input.result?.matchedCategory ?? 'novel';
        // Pair the threat to the local-id-derived ref hash. The on-chain refUID for the
        // ScanReceipt isn't known until after the EAS tx confirms, so we use a deterministic
        // ref-bytes derived from the localId — VaultReputation's idempotent backfill handles this.
        const refHex = toHex32(sha256Hex(`receipt-ref:${receiptLocalId}`).slice(0, 64));
        const threat: Extract<AttestationItem, { kind: 'threat' }> = {
          kind: 'threat',
          localId: randomUUID(),
          payload: {
            contentHash: toHex32(input.contentHash),
            mcpServerUrl: input.mcpServerUrl,
            toolName: input.toolName,
            category: matchedCategory,
            receiptRefUID: refHex,
            detectedAt: scannedAt,
          },
        };
        client.enqueueThreatRecord(threat);
      }

      return { emittedReceipt: emitReceipt, emittedThreat: emitThreat };
    },
  };
}
