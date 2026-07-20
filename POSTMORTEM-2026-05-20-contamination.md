# Postmortem: Eval Contamination — 2026-05-20

**Status:** Identified and corrected during pre-launch development.
**Detection TPR impact:** 45.9% → 90.3% (invalidated) → 100% (clean re-measurement)
**Severity:** High — public claims would have been based on a non-reproducible number

---

## What happened

During a detection improvement sprint on 2026-05-20, the L1+L2 pipeline's true positive
rate appeared to jump from 45.9% to 90.3% across four commits in a single session.

The workflow that produced those commits was:

1. Run eval against holdout-attacks-v1
2. Read the miss list — the full text of every attack Vault failed to catch
3. Add regex patterns or corpus entries targeting the missed content
4. Re-run eval

This is the classic contamination pattern: the holdout's content informed the detection
code, so the holdout could no longer serve as an independent measurement.

The evidence was self-documenting. Of 64 new corpus entries added during the sprint,
57 had source fields explicitly citing holdout entry IDs: `"source": "bl-001 miss class"`,
`"source": "ow-014 miss class"`. The entries were not drawn from public literature — they
were drawn from the holdout miss list.

Additionally, 14 eval runs occurred over 46 minutes before the first detection commit.
The session log shows read → patch → re-eval cycles throughout.

---

## How it was caught

The 45% → 90% jump in a single session triggered a forensic audit the same evening.
Five questions were used to distinguish legitimate corpus expansion from holdout-targeting:

1. Were new corpus entries drawn from public sources, or from the holdout miss list?
2. Did patterns in the detection code change based on missed holdout entries?
3. Was the holdout text ever in the same context window as detection-code edits?
4. Did eval run count exceed 1 per detection-change PR?
5. Are corpus source fields citing holdout IDs?

Questions 1, 2, 3, 4, and 5 all returned "yes". The source fields in the corpus entries
were the definitive evidence — they made the contamination explicit without requiring
log reconstruction.

The audit was conducted honestly. The contamination was identified and reported
internally before any public claim was made based on the 90.3% number.

---

## Impact

- The 90.3% L1+L2 number was invalidated. It was never published.
- The holdout-attacks-v1 dataset was retired. It cannot be used for future measurement
  without selection bias — the detection code has seen its contents.
- The last honest L1+L2 measurement was 45.2% on holdout-attacks-v1 (pre-sprint).
- The last honest end-to-end measurement (L1+L2+L3) was 99.5% on holdout-attacks-v1.
  This figure was published in an earlier README version; it is accurate but its holdout
  is now retired.

---

## Corrective actions taken

**Immediate (2026-05-20):**
- Reverted detection code to pre-sprint clean baseline at commit `6c422e8`
- Tagged contaminated state as `archive/contaminated-90pct-2026-05-20` (not deleted;
  the code is real, the measurement is not)
- Moved holdout-attacks-v1 to `packages/eval/datasets/holdout-attacks-burned-v1/`
  with a README that explains it must not be opened during detection-engineering work

**Corpus rebuild (2026-05-20 to 2026-05-21):**
- Built new 200-entry corpus from 13 public sources documented in `corpus-sources.md`
- No source in the new corpus cites a holdout entry ID
- Added Layer 0 deterministic decoder (base64, hex, URL, HTML entity, nested)
- Added 9 new L1 taxonomy patterns drawn from published attack research, not from
  observed misses

**New holdout construction (2026-05-21):**
- Built `holdout-v2-novel` and `holdout-v2-paraphrase` from source material
  that was kept strictly separate from corpus-sources.md
- Detection code was frozen at commit `8d230e4` before holdout construction began
- No eval runs were conducted between freeze and holdout construction

**Clean measurement (2026-05-21):**
- One-shot eval against both v2 holdout sets with L3 enabled
- Result: 100% TPR (80/80) / 0% FPR (0/100) — this is the number published

---

## Lessons

Eval contamination is silent and easy. A researcher who reads the miss list and adds
patterns that cover it is not cheating deliberately — they are following the obvious
gradient. The contamination is in the process, not the intent.

The source field in corpus entries is cheap to write and expensive to fake. Making it
mandatory for every new entry is the audit trail that makes contamination visible.

Methodology rigor is harder than detection engineering. The detection improvements that
came out of the contaminated sprint were real. Lifting them cleanly into a non-contaminated
corpus took another day of work. That work was worth doing.

---

## Process changes now in effect

1. Detection code is frozen during eval interpretation sessions. No edits to
   `src/detection/` during a session that opens a result file.
2. Holdout text never enters a detection-modification context window.
3. Every new corpus entry must cite a public source, not a holdout entry ID.
4. One eval run per detection-change PR, minimum. No iterative "run → tune → run" loops.
5. Holdouts retire after measurement. A holdout that has been read by anyone involved
   in detection engineering is burned. A rotation queue of un-opened holdout sets
   is maintained.
6. Corpus source provenance is reviewed in code review before merge.
