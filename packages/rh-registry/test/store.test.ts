import { describe, expect, it } from 'vitest';
import { loadStore, RegistryStore, SEED_PATH } from '../src/store.js';
import type { RegistryEntry } from '../src/types.js';
import { pendingAttestation } from '../src/types.js';

function fixtureEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    id: 'rh-example-new',
    name: 'New Example Server',
    mcpEndpoint: 'https://mcp.example.robinhood-chain.example/new',
    category: 'market-data',
    scanStatus: 'scanned',
    findingsCount: 0,
    lastScannedAt: '2026-07-10T00:00:00.000Z',
    attestation: pendingAttestation(),
    note: 'EXAMPLE ENTRY.',
    ...overrides,
  };
}

describe('registry seed', () => {
  it('loads from the bundled seed with entries', () => {
    const store = loadStore(SEED_PATH);
    expect(store.list().length).toBeGreaterThanOrEqual(4);
  });

  it('every seed entry has a valid attestation and no fabricated easUid on pending', () => {
    const store = loadStore(SEED_PATH);
    for (const e of store.list()) {
      expect(['pending', 'attested']).toContain(e.attestation.status);
      if (e.attestation.status === 'pending') {
        expect(e.attestation.easUid).toBeUndefined();
        expect(e.attestation.chain).toBeUndefined();
      }
    }
  });

  it('every seed entry is clearly labelled as an example', () => {
    const store = loadStore(SEED_PATH);
    for (const e of store.list()) {
      expect(e.name.toUpperCase() + e.note.toUpperCase()).toContain('EXAMPLE');
    }
  });
});

describe('RegistryStore API', () => {
  it('list() returns all entries; get() finds by id and misses cleanly', () => {
    const store = new RegistryStore([fixtureEntry()]);
    expect(store.list()).toHaveLength(1);
    expect(store.get('rh-example-new')?.name).toBe('New Example Server');
    expect(store.get('nope')).toBeUndefined();
  });

  it('upsert() inserts then replaces by id', () => {
    const store = new RegistryStore();
    store.upsert(fixtureEntry());
    expect(store.list()).toHaveLength(1);
    store.upsert(fixtureEntry({ name: 'Renamed' }));
    expect(store.list()).toHaveLength(1);
    expect(store.get('rh-example-new')?.name).toBe('Renamed');
  });

  it('upsert() strips a fabricated easUid off a pending attestation', () => {
    const store = new RegistryStore();
    // Attacker/careless input: pending but carrying a fake proof.
    const dirty = fixtureEntry({
      attestation: { status: 'pending', chain: 'base', easUid: '0xFAKE' },
    });
    const stored = store.upsert(dirty);
    expect(stored.attestation.status).toBe('pending');
    expect(stored.attestation.easUid).toBeUndefined();
    expect(stored.attestation.chain).toBeUndefined();
  });

  it('upsert() preserves a real attested reference', () => {
    const store = new RegistryStore();
    const stored = store.upsert(
      fixtureEntry({ attestation: { status: 'attested', chain: 'base', easUid: '0xREAL' } }),
    );
    expect(stored.attestation).toEqual({ status: 'attested', chain: 'base', easUid: '0xREAL' });
  });
});

describe('summary counts', () => {
  it('counts by scan status and attestation status', () => {
    const store = new RegistryStore([
      fixtureEntry({ id: 'a', scanStatus: 'scanned' }),
      fixtureEntry({ id: 'b', scanStatus: 'flagged', findingsCount: 2 }),
      fixtureEntry({ id: 'c', scanStatus: 'unscanned', lastScannedAt: null }),
      fixtureEntry({
        id: 'd',
        scanStatus: 'scanned',
        attestation: { status: 'attested', chain: 'base', easUid: '0xREAL' },
      }),
    ]);
    const s = store.summary();
    expect(s.total).toBe(4);
    expect(s.scanned).toBe(2);
    expect(s.flagged).toBe(1);
    expect(s.unscanned).toBe(1);
    expect(s.attested).toBe(1);
    expect(s.pendingAttestation).toBe(3);
  });

  it('summary total matches list length for the bundled seed', () => {
    const store = loadStore(SEED_PATH);
    expect(store.summary().total).toBe(store.list().length);
  });
});
