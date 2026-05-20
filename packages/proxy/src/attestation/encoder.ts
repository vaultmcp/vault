/// ABI encoders for the two Vault EAS schemas. Schema strings (must match the registered
/// schema strings in @vaultmcp/contracts/script/register-schemas.ts):
///   ScanReceipt:   "bytes32 contentHash,string mcpServerUrl,string toolName,uint8 verdict,
///                   uint8 confidence,uint8 layersRun,string[] detectedPatterns,uint64 scannedAt"
///   ThreatRecord:  "bytes32 contentHash,string mcpServerUrl,string toolName,string category,
///                   bytes32 receiptRefUID,uint64 detectedAt"

import { encodeAbiParameters, type Hex } from 'viem';
import type { ScanReceiptPayload, ThreatRecordPayload } from './types.js';

const SCAN_PARAMS = [
  { type: 'bytes32', name: 'contentHash' },
  { type: 'string', name: 'mcpServerUrl' },
  { type: 'string', name: 'toolName' },
  { type: 'uint8', name: 'verdict' },
  { type: 'uint8', name: 'confidence' },
  { type: 'uint8', name: 'layersRun' },
  { type: 'string[]', name: 'detectedPatterns' },
  { type: 'uint64', name: 'scannedAt' },
] as const;

const THREAT_PARAMS = [
  { type: 'bytes32', name: 'contentHash' },
  { type: 'string', name: 'mcpServerUrl' },
  { type: 'string', name: 'toolName' },
  { type: 'string', name: 'category' },
  { type: 'bytes32', name: 'receiptRefUID' },
  { type: 'uint64', name: 'detectedAt' },
] as const;

export function encodeScanReceipt(p: ScanReceiptPayload): Hex {
  return encodeAbiParameters(SCAN_PARAMS, [
    p.contentHash,
    p.mcpServerUrl,
    p.toolName,
    p.verdict,
    p.confidence,
    p.layersRun,
    p.detectedPatterns,
    p.scannedAt,
  ]);
}

export function encodeThreatRecord(p: ThreatRecordPayload): Hex {
  return encodeAbiParameters(THREAT_PARAMS, [
    p.contentHash,
    p.mcpServerUrl,
    p.toolName,
    p.category,
    p.receiptRefUID,
    p.detectedAt,
  ]);
}
