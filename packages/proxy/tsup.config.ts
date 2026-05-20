import { copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';

const here = dirname(fileURLToPath(import.meta.url));
const corpusDir = join(here, '..', 'corpus');

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'audit-view': 'src/cli/audit-view.ts',
    check: 'src/cli/check.ts',
    init: 'src/cli/init.ts',
  },
  format: ['esm'],
  target: 'node20',
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
  shims: false,
  dts: false,
  sourcemap: false,
  minify: false,
  noExternal: ['@vaultmcp/corpus'],
  async onSuccess() {
    const { chmodSync } = await import('node:fs');
    // Copy corpus binary data into dist/ so the bundled loadCorpus() can find
    // them via import.meta.url (which resolves to the dist/ dir at runtime).
    for (const f of ['embeddings.bin', 'embeddings-meta.json', 'injection-patterns.json']) {
      copyFileSync(join(corpusDir, f), join(here, 'dist', f));
    }
    // npm requires bin scripts to be executable
    for (const f of ['index.js', 'audit-view.js', 'check.js', 'init.js']) {
      chmodSync(join(here, 'dist', f), 0o755);
    }
    console.log('✓ corpus data copied to dist/ · bin scripts marked executable');
  },
});
