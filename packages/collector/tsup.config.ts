import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
  shims: false,
  dts: false,
  sourcemap: false,
  minify: false,
  external: ['node:sqlite'],
});
