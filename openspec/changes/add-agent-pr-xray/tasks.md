## 1. X-Ray Contract

- [ ] 1.1 Define the versioned X-Ray payload, outcome vocabulary, evidence locators, omission reasons, and corpus-state metadata
- [ ] 1.2 Add representative payload fixtures for verified, mixed, waived, missing-proof, failed, and private-evidence reviews
- [ ] 1.3 Extend staged-verification persistence only where status, timestamp, provenance, or evidence references are not exportable

## 2. Safe Local Export

- [ ] 2.1 Implement review-to-X-Ray normalization from persisted completed reviews without provider calls
- [ ] 2.2 Implement the typed public-field allowlist and explicit bounded-excerpt approval model
- [ ] 2.3 Implement blocking scanners for secrets, credentials, prompts, local paths, user identifiers, private content, and unsafe HTML
- [ ] 2.4 Implement deterministic JSON, Markdown, and self-contained static HTML renderers from the same payload
- [ ] 2.5 Add Tauri IPC and file-save integration using existing desktop patterns

## 3. Desktop Workflow

- [ ] 3.1 Add export eligibility and missing-requirement messaging to completed Review outcomes
- [ ] 3.2 Add format selection, public-source confirmation, excerpt approval, sanitizer results, and save controls
- [ ] 3.3 Add an in-app preview that uses the static renderer and preserves mixed or missing-proof outcomes

## 4. Verification

- [ ] 4.1 Add golden renderer tests proving parity across JSON, Markdown, and HTML
- [ ] 4.2 Add adversarial sanitizer fixtures covering secrets, absolute paths, prompt leakage, script injection, and unapproved code
- [ ] 4.3 Add staged-outcome tests proving unrun, failed, waived, and private-evidence stages cannot be upgraded or silently omitted
- [ ] 4.4 Add desktop integration coverage for eligible export, blocked export, explicit excerpt approval, and offline HTML readability

## 5. Dogfood Corpus

- [ ] 5.1 Export X-Rays for fleet pull requests and compare every claim with the public diff, review discussion, and CI outcome
- [ ] 5.2 Record dogfood successes, misses, exclusions, and sanitizer failures without using them in catch-rate claims
- [ ] 5.3 Curate 20–30 public cases with independent ground truth and promote only adjudicated cases to benchmark-ground-truth
- [ ] 5.4 Publish reviewed static examples on the selected existing web/benchmark surface with clear corpus state and desktop call to action
- [ ] 5.5 Update `PROJECT_STATUS.md` and product documentation with shipped scope, corpus evidence, safety limits, and hosted-analysis deferral
