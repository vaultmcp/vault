import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    testTimeout: 10000,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
