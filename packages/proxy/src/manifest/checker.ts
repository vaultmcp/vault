/// Orchestrates the manifest drift check. Wire `observeInitialize` and `observeToolsList`
/// from the stdio transport; once both are seen, `runCheck` produces a verdict for the operator.

import {
  computeFingerprint,
  diffFingerprints,
  serverKey,
  type InitializeResult,
  type ManifestFingerprint,
  type ToolsListResult,
} from './fingerprint.js';
import { ManifestStore, type StoredManifest } from './store.js';

export type ManifestMode = 'off' | 'on' | 'strict';

export interface ManifestConfig {
  mode: ManifestMode;
  cacheDir?: string;
}

export type ManifestStatus = 'first-seen' | 'unchanged' | 'drift';

export interface ManifestVerdict {
  status: ManifestStatus;
  fingerprint: ManifestFingerprint;
  serverKey: string;
  changes: string[];
}

export class ManifestChecker {
  private readonly cmd: string;
  private readonly args: string[];
  private readonly store: ManifestStore;
  private readonly key: string;
  private initialize: InitializeResult | null = null;
  private toolsList: ToolsListResult | null = null;
  private finalized = false;

  constructor(cmd: string, args: string[], config: ManifestConfig) {
    this.cmd = cmd;
    this.args = args;
    this.store = new ManifestStore(config.cacheDir);
    this.key = serverKey(cmd, args);
  }

  observeInitialize(result: InitializeResult): void {
    if (this.finalized) return;
    this.initialize = result;
  }

  observeToolsList(result: ToolsListResult): void {
    if (this.finalized) return;
    if (this.toolsList) return; // only the first tools/list counts
    this.toolsList = result;
  }

  /// Returns the verdict once we have enough data (a tools/list response), or null if
  /// we're still waiting. Caller should invoke this after every observed response.
  finalizeIfReady(): ManifestVerdict | null {
    if (this.finalized) return null;
    if (!this.toolsList) return null;

    const current = computeFingerprint(this.initialize, this.toolsList);
    const previous = this.store.load(this.key);
    const nowIso = new Date().toISOString();

    let status: ManifestStatus;
    let changes: string[] = [];

    if (!previous) {
      status = 'first-seen';
    } else if (previous.fingerprint.fingerprint === current.fingerprint) {
      status = 'unchanged';
    } else {
      status = 'drift';
      changes = diffFingerprints(previous.fingerprint, current);
    }

    const record: StoredManifest = {
      serverKey: this.key,
      command: this.cmd,
      args: this.args,
      firstSeen: previous?.firstSeen ?? nowIso,
      lastSeen: nowIso,
      fingerprint: current,
    };
    this.store.save(record);

    this.finalized = true;
    return { status, fingerprint: current, serverKey: this.key, changes };
  }
}
