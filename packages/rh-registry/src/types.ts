/// Data model for the Vault × Robinhood Chain MCP-server safety registry.
///
/// A registry entry describes a single trading MCP server and whether Vault has
/// scanned it for prompt-injection risk. Timestamps are carried as DATA (ISO
/// strings) — this module never reads the wall clock, so the store stays pure
/// and testable and callers stay in control of "when".
///
/// Attestation reflects Vault's honest roadmap: on-chain proof lives on Base via
/// EAS, but that is NOT shipped yet. So attestation defaults to `pending` and is
/// only ever `attested` when a real EAS reference is supplied. We never fabricate
/// an easUid.

/// Whether Vault has scanned this server and what it found.
///  - `scanned`   — passed through Vault, no injection findings
///  - `flagged`   — scanned, but Vault surfaced one or more findings
///  - `unscanned` — not yet run through Vault
export type ScanStatus = 'scanned' | 'unscanned' | 'flagged';

/// On-chain attestation state. `pending` until a real EAS attestation exists.
export type AttestationStatus = 'pending' | 'attested';

/// The blockchain an attestation is anchored to. Vault's roadmap is Base-only.
export type AttestationChain = 'base';

/// On-chain attestation reference for a registry entry.
///
/// Invariant (enforced by the store): when `status` is `pending` there is no
/// `easUid` and no `chain`. An `easUid` may only appear alongside `attested`.
export interface Attestation {
  status: AttestationStatus;
  /** Only present when attested. Vault anchors to Base. */
  chain?: AttestationChain;
  /** The EAS attestation UID. Only present when attested — never fabricated. */
  easUid?: string;
}

/// A single trading MCP server in the registry.
export interface RegistryEntry {
  /** Stable slug id, e.g. `rh-example-official-quotes`. */
  id: string;
  /** Human-readable server name. */
  name: string;
  /** How the server is reached — a URL endpoint or a stdio launch command. */
  mcpEndpoint?: string;
  /** Stdio launch command, when the server is spawned rather than dialed. */
  mcpCommand?: string;
  /** Coarse grouping, e.g. `market-data`, `execution`, `wallet`. */
  category: string;
  /** Vault scan status. */
  scanStatus: ScanStatus;
  /** Number of Vault findings. 0 for scanned/unscanned; >0 implies flagged. */
  findingsCount: number;
  /** ISO-8601 timestamp of the last scan, or null if never scanned. Data only. */
  lastScannedAt: string | null;
  /** On-chain attestation state — defaults to pending. */
  attestation: Attestation;
  /** Short human note; used to label example entries clearly. */
  note: string;
}

/// Aggregate counts derived from the entry list.
export interface RegistrySummary {
  total: number;
  scanned: number;
  unscanned: number;
  flagged: number;
  /** Entries whose attestation is `attested`. */
  attested: number;
  /** Entries whose attestation is `pending`. */
  pendingAttestation: number;
}

/// The full registry payload served at GET /registry.json.
export interface RegistryPayload {
  entries: RegistryEntry[];
  summary: RegistrySummary;
}

/// A pending attestation — the honest default for every new entry.
export function pendingAttestation(): Attestation {
  return { status: 'pending' };
}
