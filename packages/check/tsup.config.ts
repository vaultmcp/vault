import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  target: 'node20',
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
  shims: false,
  dts: false,
  sourcemap: false,
  minify: false,
  // viem stays external — npm will pull it as a normal dep. Inlining it bloats the
  // dist to ~1.7MB because viem ships chain metadata for hundreds of networks. The
  // single-binary build path (pkg) handles inlining at build time, not at publish.
});
