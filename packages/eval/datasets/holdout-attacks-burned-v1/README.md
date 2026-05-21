RETIRED 2026-05-20. This data was used to motivate contaminated detection work and is no longer valid for measurement. See POSTMORTEM-2026-05-20-contamination.md. Do not read these files during detection-modification sessions.

## What happened

During the detection improvement sprint on 2026-05-20, the eval harness was run repeatedly against this holdout dataset while L1 heuristics and L2 corpus entries were being modified. Missed entries' full text was visible in the eval output, and 57 of 64 new corpus entries explicitly cite a specific holdout entry ID as their motivation ("bl-001 miss class", "ow-014 miss class", etc.). This is holdout contamination: the detector was tuned against the data it was then measured on.

The resulting 90.3% TPR figure is invalid as a generalization measurement. The honest pre-contamination baseline is 45.2% L1+L2 / 99.5% L3-enabled.

## Lock status

LOCKED. Do not open, grep, cat, head, or otherwise read any file in this directory during any session where detection code (layer1-heuristics.ts, injection-patterns.json, layer2-embeddings.ts, pipeline.ts) may be modified.

Exception: one-time use during clean-baseline verification to confirm the revert reproduces 45.2% ±1pp. After that verification, permanently locked.

## Reference

- Contaminated HEAD tagged: archive/contaminated-90pct-2026-05-20
- Clean baseline branch: clean-baseline (from 6c422e8)
- Postmortem: POSTMORTEM-2026-05-20-contamination.md (to be written on Day 3)
