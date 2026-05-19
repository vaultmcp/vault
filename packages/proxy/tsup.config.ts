import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'audit-view': 'src/cli/audit-view.ts',
  },
  format: ['esm'],
  target: 'node20',
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
  shims: false,
  dts: false,
  sourcemap: false,
  minify: false,
});
