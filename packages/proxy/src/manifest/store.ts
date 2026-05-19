/// On-disk store for manifest fingerprints. One JSON file per server key under the cache dir.
/// Tests inject a temp directory via the `cacheDir` option.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ManifestFingerprint } from './fingerprint.js';

export interface StoredManifest {
  serverKey: string;
  command: string;
  args: string[];
  firstSeen: string;
  lastSeen: string;
  fingerprint: ManifestFingerprint;
}

export function defaultCacheDir(): string {
  const xdg = process.env.XDG_CACHE_HOME;
  const base = xdg && xdg.length > 0 ? xdg : path.join(os.homedir(), '.cache');
  return path.join(base, 'vault', 'manifests');
}

export class ManifestStore {
  private readonly dir: string;

  constructor(cacheDir?: string) {
    this.dir = cacheDir && cacheDir.length > 0 ? cacheDir : defaultCacheDir();
  }

  private pathFor(serverKey: string): string {
    return path.join(this.dir, `${serverKey}.json`);
  }

  load(serverKey: string): StoredManifest | null {
    const file = this.pathFor(serverKey);
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as StoredManifest;
    } catch {
      return null;
    }
  }

  save(record: StoredManifest): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.pathFor(record.serverKey), JSON.stringify(record, null, 2) + '\n');
  }
}
