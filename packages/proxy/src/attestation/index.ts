export {
  createAttestationClient,
  defaultSubmitFn,
  type AttestationClient,
  type CreateAttestationClientOpts,
  type SubmitFn,
} from './client.js';

export {
  createScanReporter,
  type ReporterDeps,
  type ReportInput,
  type ScanReporter,
} from './reporter.js';

export {
  encodeScanReceipt,
  encodeThreatRecord,
  encodeTradeReceipt,
} from './encoder.js';

export {
  buildTradeReceipt,
  emitTradeReceipt,
  aggregateToolReputation,
  classifyReason,
  DECISION,
  REASON_CODES,
  type TradeReceiptInput,
  type TradeReceiptSink,
  type ToolReputation,
  type ReceiptLike,
} from './trade-receipt.js';

export type {
  AttestationAddresses,
  AttestationConfig,
  AttestationItem,
  ScanReceiptPayload,
  ThreatRecordPayload,
  TradeReceiptPayload,
} from './types.js';
