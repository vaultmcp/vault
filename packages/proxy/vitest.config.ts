import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // L2 embedding model load + warmup can take a few seconds on a cold WASM cache,
    // and integration tests spawn child processes that each pay this cost. The 5s
    // vitest default is enough in isolation but flakes under parallel-file load
    // (streaming tests + integration tests both hammer the WASM runtime).
    testTimeout: 20000,
  },
});
