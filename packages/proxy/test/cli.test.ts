import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROXY_ENTRY = path.resolve(__dirname, '../src/index.ts');

describe('cli', () => {
  it('--help prints usage and exits 0', () => {
    const r = spawnSync(
      process.execPath,
      ['--import', 'tsx', PROXY_ENTRY, '--help'],
      { encoding: 'utf8' },
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Usage:/);
    expect(r.stdout).toMatch(/VAULT_MODE/);
  });

  it('no args prints help and exits non-zero', () => {
    const r = spawnSync(process.execPath, ['--import', 'tsx', PROXY_ENTRY], {
      encoding: 'utf8',
    });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toMatch(/Usage:/);
  });
});
