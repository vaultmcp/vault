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
} from './encoder.js';

export type {
  AttestationAddresses,
  AttestationConfig,
  AttestationItem,
  ScanReceiptPayload,
  ThreatRecordPayload,
} from './types.js';
