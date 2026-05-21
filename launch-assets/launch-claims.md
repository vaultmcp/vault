# Vault for MCP — Launch Claims

## What Vault is

A production prompt-injection firewall that sits in front of MCP servers. Intercepts every tool response, scans through four layers (L0 decoder, L1 heuristics, L2 embedding similarity, L3 LLM judge), blocks malicious content before the agent reads it. Anchors verdicts on Base via EAS attestations, accumulating per-server reputation scores any agent or marketplace can query.

## What we claim

- **100% TPR / 0% FPR** on a public 80-entry holdout of prompt injection attacks (with L3 enabled, Anthropic Haiku 4.5, 2026-05-21 one-shot eval)
- **95% confidence interval on TPR: 95.5% to 100%.** We don't claim higher than 95.5% as a lower bound until we test against larger samples.
- All detection methodology, datasets, and limitations are public in the repository
- **40% FP rate in offline mode** (no API key) on protocol-encoded data — documented as a development-environment limitation, not a production configuration

## What we don't claim

- We don't claim Vault catches attacks Vault hasn't seen analogues of
- We don't claim offline mode is production-ready
- We don't claim Vault prevents user-initiated jailbreaks (out of scope — different threat model: the user is trusted, third-party tool content is not)
- We don't claim Vault is faster or cheaper than alternatives — we claim it's accurate within a measured, defensible methodology

## What we link to

- The eval methodology: `packages/eval/README.md`
- The 80-entry holdout MANIFESTs: `packages/eval/datasets/holdout-v2-novel/MANIFEST.md` and `packages/eval/datasets/holdout-v2-paraphrase/MANIFEST.md`
- The benign-v2 set: `packages/eval/datasets/benign-v2/`
- `packages/LIMITATIONS.md` including §11 (offline mode) and §14 (large-payload scan latency)
- `POSTMORTEM-2026-05-20-contamination.md` — the methodology failure we caught and recovered from before launch
- The Base contract address and a sample attestation URL (to be filled at mainnet deploy)

## Eval integrity note

The 100%/0% result comes from a one-shot eval against holdout sets that were constructed after detection code was frozen at commit `8d230e4`. No tuning occurred between holdout construction and the eval run. The prior 45.9% TPR figure (pre-v2) came from a contaminated holdout where the detection corpus was tuned while holdout entries were visible — that figure has been retired and a postmortem is public in the repository. The 100% figure is clean.
