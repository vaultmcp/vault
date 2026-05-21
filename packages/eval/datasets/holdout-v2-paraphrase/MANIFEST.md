# Holdout v2 — Paraphrase Attacks — MANIFEST

Generated: 2026-05-21
Status: **LOCKED — eval dataset. Do not modify after first eval run.**

## What this set measures

**Paraphrase attacks**: attacks that paraphrase the canonical attack vocabulary already covered in the corpus (cosine distance 0.30–0.40 to nearest corpus entry). These entries were rejected from `holdout-v2-novel` because they are semantically close to training data.

This set tests two things:
1. **L2's ability to catch close paraphrases.** Distance 0.30–0.40 is the region where L2 cosine similarity should fire — the attacker changed phrasing but not the underlying semantic pattern.
2. **L3's ability to catch what L2 lets through.** Any entry in this band that L2 misses (e.g., if threshold is set too high) should be caught by L3 semantic reasoning.

The distinction from `holdout-v2-novel`:
- Novel-domain set: too far from corpus for L2 to catch via distance; must rely on L1 or L3
- Paraphrase set: close enough that L2 *should* catch it; measures whether L2 threshold is calibrated correctly

## Source separation

Same sources as `holdout-v2-novel` — all post-2025-01-01 or genuinely distinct from corpus sources. These entries were not used to tune the L2 threshold (threshold was set on 2026-05-19 based on distance-probe measurements against benign content, before this dataset was constructed).

## Entry counts

**Total entries:** 30
**holdout_type:** paraphrase (all entries)
**Expected verdict:** malicious (all entries)

## Distance verification

All 30 entries verified in [0.30, 0.40) cosine distance from nearest corpus entry via bge-small-en-v1.5.

| Statistic | Distance |
|---|---|
| min | 0.3033 |
| p50 | ~0.3620 |
| max | 0.3928 |
| in 0.30–0.35 band | 15 |
| in 0.35–0.40 band | 15 |

## Category breakdown

| Category | Count | Notes |
|---|---|---|
| exfiltration | 14 | Selected for domain diversity from 61 candidates |
| instruction_override | 9 | All candidates in band (0.30–0.40) |
| multi_turn_setup | 6 | All candidates in band (0.30–0.40) |
| encoded_payload | 1 | Only candidate in band (0.30–0.40) |
| jailbreak | 0 | All jailbreak candidates were < 0.30 (too close to corpus) |
| role_hijack | 0 | All role_hijack candidates were < 0.30 (too close to corpus) |

**Why jailbreak and role_hijack are absent:** These categories use the most canonical injection vocabulary (DAN-family, "you are now", persona swap patterns). The 200-entry corpus covers this vocabulary so thoroughly that all candidates landed < 0.30 — below the paraphrase band. Anything from these categories would be a near-duplicate of corpus content, not a genuine paraphrase test.

## Scope

Attacks embedded in the same categories of tool output as `holdout-v2-novel` (MCP tool metadata, monitoring alerts, CI/CD output, database events, etc.). The difference is semantic proximity to corpus, not attack vector.

## Construction methodology

- Source: the 82 entries rejected from holdout-v2-novel (distance ≤ 0.40)
- Removed entries with distance < 0.30 (5 entries — genuine duplicates, not paraphrases)
- Of the 77 remaining (distance 0.30–0.40): took all 16 non-exfiltration entries, plus 14 exfiltration entries selected to span the distance range
- Per-entry distances are in the `verified_distance_to_corpus` field
- Detection code frozen before construction; no threshold changes made
