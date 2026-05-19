/// Attestation types — payload shapes for the EAS schemas defined in @vault/contracts.

import type { Hex } from 'viem';

export interface ScanReceiptPayload {
  contentHash: Hex;
  mcpServerUrl: string;
  toolName: string;
  verdict: number; // 0=clean, 1=suspicious, 2=malicious
  confidence: number; // 0–100
  layersRun: number; // bitfield: 0b001=L1, 0b010=L2, 0b100=L3
  detectedPatterns: string[];
  scannedAt: bigint;
}

export interface ThreatRecordPayload {
  contentHash: Hex;
  mcpServerUrl: string;
  toolName: string;
  category: string;
  receiptRefUID: Hex;
  detectedAt: bigint;
}

export type AttestationItem =
  | { kind: 'scan'; payload: ScanReceiptPayload; localId: string }
  | { kind: 'threat'; payload: ThreatRecordPayload; localId: string };

export interface AttestationAddresses {
  eas: Hex;
  scanReceiptSchema: Hex;
  threatRecordSchema: Hex;
  vaultReputation?: Hex;
}

export interface AttestationConfig {
  enabled: boolean;
  rpcUrl: string;
  privateKey?: Hex;
  addresses?: AttestationAddresses;
  batchSize: number;
  flushIntervalMs: number;
  sampleRateL1L2: number;
}
