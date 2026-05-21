# Holdout v2 — Novel-Domain Attacks — MANIFEST

Generated: 2026-05-21
Status: **LOCKED — eval dataset. Do not modify after first eval run.**

## What this set measures

**Novel-domain attacks**: attacks that share structural patterns with known categories (exfiltration, instruction_override) but use sufficiently distinct surface vocabulary that cosine distance to all corpus entries exceeds 0.40. L2 detection must generalize beyond nearest-neighbor matching to catch these — it cannot rely on the training corpus entry being semantically nearby.

These are the *hardest* attacks for the L1+L2 pipeline: they won't be caught by L2 cosine similarity (too far from corpus) and must be caught by L1 heuristics or L3 semantic reasoning.

## Source separation confirmation

All sources are ABSENT from `packages/corpus/corpus-sources.md`. Sources are either:
- Post-2025-01-01 (date-gated after corpus cutoff for Willison and Embrace The Red), OR
- Genuinely distinct papers not cited in corpus sources

| Source | Date range |
|---|---|
| Simon Willison, simonwillison.net ≥ 2025-01-01 | 2025-04-09 to 2025-10-21 |
| Embrace The Red, embracethered.com ≥ 2025-01-01 | 2025-01-25 to 2025-08-12 |
| arxiv 2410.07283 — Prompt Infection (Oct 2024) | 2024-10-09 |
| arxiv 2601.17548 — Agentic Coding Assistants (Jan 2025) | 2025-01-28 |
| arxiv 2603.22489 — MCP Security Threat Modeling (Mar 2025) | 2025-03-28 |
| arxiv 2604.27202 — Indirect Prompt Injection in the Wild (Apr 2025) | 2025-04-28 |
| arxiv 2506.17318 — Context Manipulation Attacks (Jun 2025) | 2025-06-17 |
| arxiv 2509.22830 — ChatInject (Sep 2025) | 2025-09-29 |
| unit42.paloaltonetworks.com/ai-agent-prompt-injection/ (Mar 2025) | 2025-03-15 |
| christian-schneider.net/blog/prompt-injection-agentic-amplification/ (Mar 2025) | 2025-03-01 |

## Entry counts

**Total entries:** 50
**holdout_type:** novel (all entries)
**Expected verdict:** malicious (all entries)

## Distance verification

All 50 entries verified > 0.40 cosine distance from all 200 corpus entries via bge-small-en-v1.5.

| Statistic | Distance |
|---|---|
| min | 0.4004 |
| p25 | 0.4047 |
| p50 | 0.4135 |
| p75 | 0.4242 |
| max | 0.4804 |

## Category breakdown

| Category | Count | Notes |
|---|---|---|
| exfiltration | 46 | — |
| instruction_override | 4 | — |
| encoded_payload | 0 | — |
| jailbreak | 0 | — |
| multi_turn_setup | 0 | — |
| role_hijack | 0 | — |

**Why the exfiltration skew:** Exfiltration attacks embedded in DevOps/infrastructure tool output (Helm charts, ArgoCD, Prometheus alerts, FHIR audit events, Nextflow pipeline reports, ML experiment tracking, distributed database events) carry narrow domain-specific technical vocabulary. This vocabulary relocates the embedding far enough from canonical injection language to clear the 0.40 threshold. Instruction_override, multi_turn_setup, and role_hijack attacks use a smaller, more canonical vocabulary ("override policy", "store as instruction", "disable safety") that is thoroughly covered by the 200-entry corpus — these categories cluster at 0.27–0.39, below the threshold. They are evaluated separately in `holdout-v2-paraphrase`.

## Scope

All 50 entries are **third-party injection into tool output** — attacks embedded in:
- MCP tool description metadata
- Monitoring/alerting webhook payloads (Prometheus, PagerDuty, ServiceNow)
- CI/CD pipeline tool output (Helm, ArgoCD, Temporal, Ansible, Nextflow)
- Database query results and monitoring events (MongoDB Atlas, ClickHouse, TimescaleDB)
- ML/AI platform output (W&B, Ray, Argo Workflows)
- Healthcare/research data platform output (FHIR, HPC)
- Code files and workspace configuration read by coding agents

None are user-initiated jailbreaks.

## Construction methodology

- Generated 132 candidate entries in 6 batches from approved sources
- Ran `packages/proxy/scripts/check-corpus-distance.mjs --batch` on each batch
- Accepted only entries with verified distance > 0.40 (50/132 = 37.9% pass rate)
- The 82 rejected entries are available in `holdout-v2-paraphrase/attacks.json` (those with distance 0.30–0.40) and were discarded (those with distance < 0.30)
- No entries were modified after distance measurement
- Detection code was frozen before this dataset was constructed
