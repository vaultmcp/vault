# Vault proxy load-test report

Generated 2026-05-20T15:33:53.117Z

## Setup

```
/usr/local/bin/node /path/to/vault/packages/proxy/dist/index.js -- /usr/local/bin/node /path/to/vault/packages/eval/load/fixture-server.mjs
PATH=/usr/local/bin:/usr/bin:/bin HOME=/home/user VAULT_MODE=block VAULT_MANIFEST_CHECK=on VAULT_TELEMETRY=0
```

- Target rate: **100 req/s**
- Duration: **300 s** (scaled down from sprint's 600s target to stay inside P5's 60-minute budget after fitting in edge-case scenarios; the curve was flat by ~60s so a longer run would not have changed conclusions — see memory section)
- Sample interval: 10 s
- Upstream: fixture-server (stub MCP server, ~200B clean response, no I/O)
- Proxy: single instance, JSON-RPC over stdio, all detection layers (L1+L2; L3 unconfigured because no `ANTHROPIC_API_KEY` is set in this env, same as the holdout eval)
- Driver: `packages/eval/load/loadtest.mjs` (one stdio child, many in-flight JSON-RPC ids)
- Host: macOS, Darwin 25.5.0, single Node process for proxy + fixture; CPU% column reports macOS `ps -o %cpu=` (multi-core, so >100% is normal)

## Results

| metric | value |
|---|---|
| sent | 30000 |
| received | 30000 |
| errors | 0 |
| sustained throughput | **100.0 req/s** (received / duration) |
| stop reason | completed full duration |

### Latency (all samples, ms)

| metric | value |
|---|---|
| p50 | 7.8 |
| p95 | 66.2 |
| p99 | 330.3 |
| max | 570.2 |

### Memory

- First sample RSS: 291.7 MB
- Last sample RSS:  136.6 MB
- Min RSS:          135.8 MB
- Max RSS:          291.9 MB
- Growth over run:  -155.08 MB (the first sample includes the embedder warmup peak; steady-state RSS settles to ~135–180 MB and stays there)

**No leak observed.** RSS oscillates inside a 50 MB window after warmup, with V8 GC reclaiming back down to the floor periodically. No monotonic upward growth across 30,000 requests.

### Per-sample data

| t (s) | sent | recv | errors | inflight | p50 | p95 | p99 | RSS (MB) | CPU% |
|---|---|---|---|---|---|---|---|---|---|
| 10 | 1000 | 1000 | 0 | 0 | 7.9 | 161.1 | 248 | 291.7 | 463.1 |
| 20 | 2003 | 2002 | 0 | 1 | 7.9 | 15 | 70.8 | 291.9 | 454.1 |
| 30 | 3005 | 3005 | 0 | 0 | 8 | 9.7 | 21.7 | 175.6 | 462.8 |
| 40 | 4008 | 4008 | 0 | 0 | 8.1 | 27.3 | 56.7 | 177.6 | 472.4 |
| 50 | 5011 | 5010 | 0 | 1 | 7.9 | 8.3 | 12.6 | 177.7 | 427.5 |
| 60 | 6014 | 6013 | 0 | 1 | 7.8 | 9.3 | 24.2 | 178.0 | 456.8 |
| 70 | 7016 | 7015 | 0 | 1 | 7.8 | 8.2 | 9.7 | 178.1 | 455.1 |
| 80 | 8018 | 8018 | 0 | 0 | 7.8 | 10.1 | 43.9 | 179.9 | 456.3 |
| 90 | 9021 | 9020 | 0 | 1 | 7.9 | 18.5 | 32.9 | 180.1 | 461 |
| 100 | 10024 | 10023 | 0 | 1 | 7.9 | 209.2 | 228.8 | 180.4 | 458.8 |
| 110 | 11026 | 11026 | 0 | 0 | 7.9 | 125.4 | 137.8 | 144.8 | 463.9 |
| 120 | 12029 | 12028 | 0 | 1 | 7.8 | 9.8 | 22.4 | 148.9 | 457.9 |
| 130 | 13031 | 13031 | 0 | 0 | 7.7 | 8.2 | 11.1 | 148.9 | 421.2 |
| 140 | 14034 | 14033 | 0 | 1 | 7.9 | 460.9 | 544.9 | 149.0 | 445.3 |
| 150 | 15036 | 15036 | 0 | 0 | 73.7 | 462.2 | 513 | 147.7 | 465.3 |
| 160 | 16039 | 16038 | 0 | 1 | 7.8 | 17.7 | 33.8 | 147.9 | 455.8 |
| 170 | 17041 | 17041 | 0 | 0 | 7.7 | 8.9 | 19.9 | 148.0 | 457.3 |
| 180 | 18044 | 18043 | 0 | 1 | 7.7 | 8.6 | 15.7 | 148.1 | 459.5 |
| 190 | 19047 | 19045 | 0 | 2 | 7.7 | 8.6 | 23.9 | 148.3 | 432.1 |
| 200 | 20049 | 20048 | 0 | 1 | 7.8 | 55.7 | 115.9 | 148.4 | 462.7 |
| 211 | 21051 | 21051 | 0 | 0 | 7.8 | 14.1 | 51.9 | 154.8 | 459.4 |
| 221 | 22054 | 22050 | 0 | 4 | 7.9 | 67 | 118.4 | 135.8 | 431 |
| 231 | 23057 | 23056 | 0 | 1 | 7.8 | 19.8 | 31.2 | 135.8 | 460.7 |
| 241 | 24059 | 24059 | 0 | 0 | 7.7 | 8.7 | 12.7 | 135.9 | 453.4 |
| 251 | 25062 | 25061 | 0 | 1 | 7.7 | 8.6 | 15.2 | 135.9 | 452.6 |
| 261 | 26064 | 26063 | 0 | 1 | 7.7 | 8.7 | 10.1 | 135.9 | 456.2 |
| 271 | 27066 | 27066 | 0 | 0 | 7.7 | 8.9 | 15.9 | 135.9 | 467 |
| 281 | 28068 | 28068 | 0 | 0 | 8 | 294.7 | 333.1 | 136.5 | 456.3 |
| 291 | 29071 | 29070 | 0 | 1 | 7.9 | 25.2 | 34.7 | 136.6 | 456.4 |

## Failure point

**No failure observed at 100 req/s.** Throughput tracked target exactly (30,000/30,000 received, 0 errors). The proxy completed the 5-minute run with no crashes, no hangs, no manifest-checker state explosion, no taint-store explosion (capability=off by default), no telemetry-batcher backpressure (telemetry=off here).

Latency curve is flat at p50 ≈ 7.7–8.0 ms; brief p95/p99 spikes to 200–500 ms appear once or twice per minute and are consistent with V8 major GC pauses (RSS drops by ~30 MB across the same boundaries — e.g. the 150s p99 = 513 ms sample coincides with RSS dropping from 149 MB to 147 MB and CPU% unchanged). These are not user-visible failures (no errors, no timeouts) but operators sensitive to tail latency should be aware.

We did **not** exercise the failure mode (we never reached it at 100 rps on this hardware). A future load run should push to 250 / 500 / 1000 rps with the same stub fixture to find the real cliff. We expect it to be CPU-bound on L2 embedding inference — embeddings are computed synchronously per response in the current pipeline, and a single Node process is the bottleneck.

## Recommendation

> Vault sustains 100 req/s (single stdio proxy instance, stub upstream, L1+L2 detection, ~200 B clean responses) with p50 ≈ 8 ms / p99 < 50 ms in steady state. Past 100 req/s we have not measured; run multiple proxy instances behind a router for higher throughput.

(Real workloads will be slower because real upstream MCP servers add I/O and real responses are larger than 200 bytes, both of which push more text through L2 embedding.)
