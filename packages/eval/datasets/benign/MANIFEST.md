# Benign Corpus Manifest

This directory holds the false-positive (FP) test corpus for Vault's prompt-injection
detector. Every entry here MUST NOT be flagged as malicious by the proxy.

## What counts as "benign" for this test

A piece of content is benign — even if it is structurally similar to an attack — if it
has no operative intent. Concretely, benign content includes:

1. **Routine technical and product content** that has no relationship to LLM safety
   (PostgreSQL docs, MCP server READMEs, npm package docs, code snippets). The detector
   should not be triggered by, e.g., the word "ignore" appearing in a SQL `IGNORE`
   clause or by the phrase "system prompt" appearing in a config doc.

2. **Content that describes or documents attacks without instructing the model to
   perform one.** A paper abstract that uses the phrase "ignore previous instructions"
   to characterise an attack class is benign. An MCP tool README that lists
   `execute_command` as a tool surface is benign. A blog post about jailbreaks is
   benign. The meta–object distinction matters: discussing an attack is not an attack.

3. **Content that "looks like" an attack but lacks an addressee or imperative.** A
   code sample that defines a string variable containing the literal text "ignore all
   prior instructions" — for example as test data — is benign. A Wikipedia page on
   the DAN jailbreak that quotes the original prompt is benign.

Anything that DOES instruct the model to bypass its policy, exfiltrate, change role,
etc., regardless of framing, is NOT benign and belongs in `holdout-attacks/`.

## Files in this directory

| File | Count | What it tests |
|---|---:|---|
| `01-mcp-readmes.json` | 25 | Real / representative READMEs from popular MCP servers. The detector must not flag legitimate tool-server documentation. |
| `02-security-research.json` | 20 | Verbatim abstracts and paraphrased summaries of published prompt-injection / jailbreak research. The meta case: discussing attacks should not register as an attack. |
| `03-tech-docs.json` | 25 | Postgres, Python, AWS, TypeScript, Rust, Go, Node, Docker, Redis, Terraform, Kubernetes, MySQL, GraphQL, MDN docs; representative GitHub issue and PR bodies. |
| `04-prose-news.json` | 20 | Wikipedia articles on non-technical topics, news-report-shaped prose, personal essays, reviews. |
| `05-code-snippets.json` | 20 | Canonical TypeScript, Python, and Go code idioms. |

Total benign entries: **110**.

## Sourcing honesty

The `source` field on every entry follows one of these conventions:

- `verbatim (<source>)` — exact text from a published source, fetched via WebFetch
  and confirmed unaltered. Used for several arXiv abstracts and a handful of MCP
  README excerpts (notably `bn-001`, `bn-002`, `bn-003`, and `sr-001` through
  `sr-007`).
- `paraphrased (<source>)` — close paraphrase of public documentation. Used where
  WebFetch returned an AI-summarised version of the page (which is itself not the
  verbatim source), and for documentation that is easier to render in our format
  by trimming and rewording.
- `authored representative (...)` — original wording shaped to be representative of
  the class. Used where the source could not be fetched cleanly (404, rate limit,
  or the fetched content was too thin) and we wanted to keep the dataset balanced.
  For each such entry the source field names the URL / repo we would have fetched
  so that a future pass can substitute the real text.

We deliberately do not claim verbatim sourcing for content we composed.

## Generation notes

- All entries were authored on 2026-05-19 in a single sitting. WebFetch was used
  where it worked; about half the MCP READMEs returned model-summarised text rather
  than the raw markdown, so those entries are marked `paraphrased` even where the
  original source is public.
- No entry was copy-pasted from `/packages/corpus/injection-patterns.json` or
  `/packages/eval/src/corpus.ts`. We read both files before authoring to keep the
  holdout truly held out.
- Severity is omitted on benign entries; `expected_verdict` is always `"clean"` and
  is the field the harness actually keys on.

## Known issue with the attack corpus

The pre-existing file `holdout-attacks/05-encoded-payloads.json` fails JSON parse
(unterminated string at line 28). It is left untouched on instruction — this overnight
sprint may not modify existing files. The new files `05a-encoded-base64-hex.json`,
`05b-encoded-rot-caesar-url.json`, and `05c-encoded-unicode-zwj.json` cover the same
attack types and are valid JSON. The eval harness should be expected to skip or
report the broken file; that finding belongs in the morning report.
