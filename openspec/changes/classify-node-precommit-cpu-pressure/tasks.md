## 1. Runtime capture

- [x] 1.1 Snapshot request, commitment, and finish process CPU without retaining absolute counters
- [x] 1.2 Mark every overlapping admitted request contaminated and preserve response behavior
- [x] 1.3 Normalize malformed, incomplete, and inconsistent CPU deltas closed

## 2. Projection and diagnosis

- [x] 2.1 Project pre-commit and whole-request CPU duration and ratios outside existing accounting
- [x] 2.2 Add fixed high, low, mixed, and insufficient classifications
- [x] 2.3 Keep findings source-null, low-confidence, edit-ineligible, and explicit about process-wide limits

## 3. Proof and verification

- [x] 3.1 Prove behavior, overlap contamination, classifications, and refusal paths in focused tests
- [x] 3.2 Replay unchanged High Signal and retain the observed pre-commit CPU shape
- [x] 3.3 Add bounded proof documentation and run broad validation
