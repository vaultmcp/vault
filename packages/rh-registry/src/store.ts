/// In-memory registry store, backed by a JSON seed file.
///
/// Pure and testable: no wall-clock reads, no network, no globals. Construct a
/// store from a seed (or from the on-disk seed via `loadStore`) and query it
/// through `list`, `get`, `upsert`, and the derived `summary`.
///
/// The store enforces Vault's honest attestation invariant on every write: a
/// `pending` attestation carries no `easUid`/`chain`, and an entry is normalized
/// so `flagged` implies findings and vice-versa is left to the caller's data.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  RegistryEntry,
  RegistryPayload,
  RegistrySummary,
} from './types.js';
import { pendingAttestation } from './types.js';

/// Absolute path to the on-disk seed file.
export const SEED_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'registry.seed.json',
);

/// Shape of the seed file on disk.
interface SeedFile {
  entries: RegistryEntry[];
}

/// Normalize an entry so it satisfies the attestation invariant.
///
/// A `pending` attestation must never carry a fabricated `easUid` or `chain`.
/// An `attested` entry keeps its supplied reference untouched.
function normalizeEntry(entry: RegistryEntry): RegistryEntry {
  const attestation = entry.attestation ?? pendingAttestation();
  if (attestation.status === 'pending') {
    // Strip any stray easUid/chain that would imply a proof we don't have.
    return { ...entry, attestation: { status: 'pending' } };
  }
  return { ...entry, attestation: { ...attestation } };
}

/// A queryable registry of trading MCP servers.
export class RegistryStore {
  private readonly entries: Map<string, RegistryEntry>;

  constructor(entries: RegistryEntry[] = []) {
    this.entries = new Map();
    for (const e of entries) {
      const n = normalizeEntry(e);
      this.entries.set(n.id, n);
    }
  }

  /// Parse a raw seed payload into a store.
  static fromSeed(seed: SeedFile): RegistryStore {
    return new RegistryStore(seed.entries ?? []);
  }

  /// All entries, in insertion order.
  list(): RegistryEntry[] {
    return [...this.entries.values()];
  }

  /// A single entry by id, or `undefined` if absent.
  get(id: string): RegistryEntry | undefined {
    return this.entries.get(id);
  }

  /// Insert or replace an entry by id. Returns the normalized stored entry.
  upsert(entry: RegistryEntry): RegistryEntry {
    const n = normalizeEntry(entry);
    this.entries.set(n.id, n);
    return n;
  }

  /// Derived counts by scan status and attestation status.
  summary(): RegistrySummary {
    const all = this.list();
    const summary: RegistrySummary = {
      total: all.length,
      scanned: 0,
      unscanned: 0,
      flagged: 0,
      attested: 0,
      pendingAttestation: 0,
    };
    for (const e of all) {
      if (e.scanStatus === 'scanned') summary.scanned += 1;
      else if (e.scanStatus === 'unscanned') summary.unscanned += 1;
      else if (e.scanStatus === 'flagged') summary.flagged += 1;

      if (e.attestation.status === 'attested') summary.attested += 1;
      else summary.pendingAttestation += 1;
    }
    return summary;
  }

  /// The full payload served at GET /registry.json.
  payload(): RegistryPayload {
    return { entries: this.list(), summary: this.summary() };
  }

  /// Serialize back to the seed file shape.
  toSeed(): SeedFile {
    return { entries: this.list() };
  }
}

/// Load a store from a seed file on disk (defaults to the bundled seed).
export function loadStore(seedPath: string = SEED_PATH): RegistryStore {
  const raw = readFileSync(seedPath, 'utf8');
  const seed = JSON.parse(raw) as SeedFile;
  return RegistryStore.fromSeed(seed);
}

/// Persist a store back to a seed file on disk (defaults to the bundled seed).
export function saveStore(store: RegistryStore, seedPath: string = SEED_PATH): void {
  writeFileSync(seedPath, `${JSON.stringify(store.toSeed(), null, 2)}\n`, 'utf8');
}
