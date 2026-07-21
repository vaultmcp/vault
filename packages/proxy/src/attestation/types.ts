/// Attestation types — payload shapes for the EAS schemas defined in @vaultmcp/contracts.

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

/// A public, verifiable record that Vault's trade guard saw a trading action and what it
/// decided. Privacy-preserving: the recipient is hashed and the value is bucketed to an
/// order of magnitude, so the receipt proves "this exact trade was cleared/blocked for
/// this reason" without publishing the wallet or the amount.
export interface TradeReceiptPayload {
  mcpServerUrl: string;
  toolName: string;
  decision: number; // 0=cleared, 1=warned, 2=blocked
  reasonCode: number; // see REASON_CODES in trade-receipt.ts
  recipientHash: Hex; // sha256(recipient) or zero
  token: string; // traded token symbol, if known
  valueBucket: number; // order-of-magnitude bucket of the amount (0=unknown)
  guardedAt: bigint; // unix seconds
}

export type AttestationItem =
  | { kind: 'scan'; payload: ScanReceiptPayload; localId: string }
  | { kind: 'threat'; payload: ThreatRecordPayload; localId: string }
  | { kind: 'trade'; payload: TradeReceiptPayload; localId: string };

export interface AttestationAddresses {
  eas: Hex;
  scanReceiptSchema: Hex;
  threatRecordSchema: Hex;
  tradeReceiptSchema?: Hex;
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
