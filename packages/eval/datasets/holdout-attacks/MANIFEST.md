# Holdout Attack Set — Provenance + Methodology

**Purpose.** A set of prompt-injection attacks that Vault has *not* been trained or tuned against. Used to estimate the true true-positive rate (TPR) of the Vault pipeline on novel inputs.

## Non-overlap guarantee

This set is **disjoint** from both:

1. `packages/corpus/injection-patterns.json` — the 60 paraphrased entries that train Layer 2's embedding nearest-neighbor classifier
2. `packages/eval/src/corpus.ts` — the 63 entries in the existing in-repo eval (used to vibe-check during dev)

The non-overlap was enforced by:

- **Manual review.** Each holdout entry was authored or curated knowing the contents of both sets. Entries that looked too close (Levenshtein-similar wording, near-identical phrasing) to a corpus entry were excluded.
- **Programmatic check.** `pnpm --filter @vaultmcp/eval run -- --check-overlap` (in the harness as a separate verb, not the default run) compares every holdout entry against every corpus entry and flags any with normalized edit distance below 0.35. Output goes to `overlap-report.txt`. Pre-launch this check is run and any flagged entries are either rewritten or removed.

## Sources

Each batch is in its own JSON file with `source` fields citing the upstream:

| File | Source | Type | Count |
|---|---|---|---|
| `01-published-papers.json` | Greshake et al. 2023 ("Not what you've signed up for"); Liu et al. 2023 ("Prompt Injection attacks against LLM-integrated Applications"); Perez & Ribeiro 2022 ("Ignore Previous Prompt: Attack Techniques For Language Models") | Verbatim & authored-from-pattern | ~35 |
| `02-garak-probes.json` | NVIDIA garak — github.com/NVIDIA/garak — `garak/probes/` directory patterns (Apache-2.0) | Authored-from-pattern with attribution to specific probe class | ~30 |
| `03-blog-pocs.json` | Simon Willison (simonwillison.net/.../prompt-injection*); Johann Rehberger (embracethered.com); Riley Goodside (Twitter @goodside published examples) | Verbatim or close-paraphrase of published PoCs | ~30 |
| `04-owasp-llm.json` | OWASP LLM Top 10 v1.1 (genai.owasp.org) — LLM01 Prompt Injection examples | Authored-from-pattern matching OWASP categorization | ~20 |
| `05-encoded-payloads.json` | Original synthesis using established encoding techniques (base64, hex, ROT13, homoglyph, zero-width, RTL override) — each instance encodes a known attack and asks the agent to decode-and-act | Synthetic but technique-real | ~30 |
| `06-multi-turn.json` | Composed multi-turn setup patterns from Greshake (indirect channel poisoning), Lakera Gandalf publicly-disclosed solutions, HackAPrompt 2023 winning submissions where the prompts are publicly available | Authored matching published patterns | ~25 |
| `07-roleplay-jailbreak.json` | "DAN" family, "Developer Mode" prompts, "STAN", "AIM" — all well-documented in public r/ChatGPT discussions and security research papers (Shen et al. 2023 "Do Anything Now") | Authored variants — exact verbatim DAN prompts are 1000+ chars; we use shorter representative slices that preserve the attack semantics | ~30 |

Total target: **200+ entries**.

## Categorization

Each entry has one of six categories matching the corpus taxonomy:

- `instruction_override` — tells the model to discard prior instructions
- `role_hijack` — recasts the model as a different persona without safety
- `exfiltration` — asks the model to leak data via available channels
- `jailbreak` — reframes context to "permit" otherwise-refused outputs
- `encoded_payload` — instruction is encoded; model is asked to decode-and-act
- `multi_turn_setup` — establishes a trigger or sleeper directive for later turns

## Severity

- `critical` — directly leaks credentials, exfiltrates user data, or executes destructive ops
- `high` — overrides safety constraints, leaks system prompt, performs unauthorized writes
- `medium` — biases outputs, suppresses refusals, plants sleeper instructions
- `low` — annoying but not actionable (e.g., persona change with no further capability)

## Judgment calls

- **Length vs. realism.** Some published PoCs (e.g., the original DAN prompt) are 1000+ characters. For the holdout we keep entries to representative slices — usually 50–500 characters — that preserve the *attack semantics* without copy-pasting the entire historical artifact. This means our TPR on holdout is being measured against the *technique class*, not the literal artifact. We note this as a methodology limitation.

- **Suspicious vs. malicious.** Most entries are marked `malicious` in `expected_verdict`. A small number of ambiguous cases (e.g., a paragraph that *discusses* an injection without instructing the model to act on it) are marked `suspicious` — these test the L2/L3 distinction between "discuss" and "do".

- **Provenance honesty.** Where I authored an entry from a published *pattern* without copying verbatim, the `source` field reads `"authored-from-pattern (<source>)"`. Where the entry is verbatim from a published source, it reads `"verbatim (<source>)"`. Where it is a close paraphrase, `"paraphrased (<source>)"`. No source field is left vague.

## What this set is NOT

- It is **not** exhaustive. Prompt injection is an open research area; this set captures the well-published 2022-2024 attack literature plus a few open-source PoCs. New attacks discovered after these citations are not represented.
- It is **not** adversarially adaptive. Every entry was authored *without knowledge* of how Vault would respond. Subsequent iterations of Vault should be measured against a *new* holdout set, not this one — otherwise the holdout has effectively become training data.
- It is **not** a substitute for live testing. A high TPR here does not guarantee good behavior against creative adversaries in production. See `packages/eval/red-team/` for our internal adversarial testing.
