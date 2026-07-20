# Vault latency baseline — 2026-07-20

**Commit:** `e1a0663`  ·  **Node:** v24.12.0  ·  **Platform:** darwin/arm64
**Inputs:** 208 (public corpus attacks + 8 benign tool responses), 8 measured passes each.
**Method:** real detection layers timed with `performance.now()` after a discarded warm pass. Reproduce with `cd packages/eval && npx tsx src/latency-bench.ts`.

| layer | p50 | p95 | p99 | samples |
|---|---|---|---|---|
| L1 heuristics | 0.02 ms | 0.03 ms | 0.04 ms | 1664 |
| L2 embeddings | 8.86 ms | 12.33 ms | 15.11 ms | 1664 |
| L3 judge | — | — | — | 0 (not measured) |

L3 not measured this run — requires an LLM key. L3 is a single provider round-trip (Anthropic Haiku 4.5 / OpenAI / Ollama); observed ~1.5–2 s in prior runs, network-bound.

L1 and L2 run on-device with no network call. L2 loads a ~30 MB WASM embedder
(`bge-small-en-v1.5`); the first scan in a process pays a one-time warm-up excluded above.
Every latency figure in the README should trace to this file.
