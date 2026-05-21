RETIRED 2026-05-20. This data was used to motivate contaminated detection work and is no longer valid for measurement. See POSTMORTEM-2026-05-20-contamination.md. Do not read these files during detection-modification sessions.

## What is in here

Eval result files (eval-YYYY-MM-DD-HHMM.md and .json) from all runs prior to the clean-baseline sprint. This includes:

- eval-2026-05-19-* : overnight sprint P1/P2 baseline runs
- eval-2026-05-20-0946 through eval-2026-05-20-1504: post-L3 audit, scope-tagging runs
- eval-2026-05-20-1824 through eval-2026-05-20-1934: contamination sprint runs (the tuning loop)

The eval-2026-05-20-1824.md file is especially sensitive: it contains the full text (truncated at 120 chars) of every holdout entry that was missed by L1+L2 at the contamination-sprint start. That miss list was in context while corpus entries were being added, constituting the contamination mechanism.

## Lock status

LOCKED. Do not open any file in this directory during any session where detection code may be modified. The miss lists in these files are exactly the kind of information that causes contamination.

## Reference

- Clean baseline branch: clean-baseline (from 6c422e8)
- New eval results from the clean sprint will land in packages/eval/results/ directly (not in this archive)
