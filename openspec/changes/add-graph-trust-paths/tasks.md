## 1. Graph Trust Contract

- [ ] 1.1 Extend `RepoGraph` nodes and edges with schema-v2 trust, origin, source-location, and community fields using backward-compatible serde defaults.
- [ ] 1.2 Classify every native fast/enriched graph edge as extracted or inferred and attach the narrowest available source anchors.
- [ ] 1.3 Add Rust regression tests proving new scans emit schema v2 and schema-v1 snapshots load as legacy without being rewritten.

## 2. Graphify Import Boundary

- [ ] 2.1 Add a size-bounded Tauri command that parses user-selected Graphify `nodes` plus `links`/`edges`, validates endpoints, and returns a transient normalized graph.
- [ ] 2.2 Preserve supported Graphify relation, confidence, source file/location, and community metadata while mapping missing or unknown confidence to ambiguous.
- [ ] 2.3 Add fixture-based tests for current Graphify JSON, loose edge-key JSON, dangling endpoints, malformed JSON, and configured size/node/edge caps.

## 3. Trusted Path Query

- [ ] 3.1 Implement deterministic endpoint ranking with exact ID/path/label precedence and near-equal ambiguity results.
- [ ] 3.2 Implement trust-weighted bounded path search that preserves stored edge direction and returns hop evidence, anchors, trust summary, and bound metadata.
- [ ] 3.3 Add unit tests for extracted-path preference, ambiguous endpoints, reverse-direction display, no-path results, and traversal caps.

## 4. Repo Graph Experience

- [ ] 4.1 Add an explicit local graph import action and non-mutating imported-preview state to the Repo Graph surface.
- [ ] 4.2 Add source/target path controls, endpoint candidate selection, and an accessible hop list with trust badges and source links.
- [ ] 4.3 Add focused frontend tests for import errors, ambiguity handling, path rendering, and preservation of the saved native graph.

## 5. Review Evidence Integration

- [ ] 5.1 Derive a small bounded set of native graph paths from changed files to routes, commands, persistence points, or tests and include them in review context.
- [ ] 5.2 Render the same qualified path summaries in the Review graph panel and reviewer-proof Markdown without creating findings or upgrading evidence status.
- [ ] 5.3 Add regression tests proving uncertain hops are labeled as leads and graph paths cannot independently create verified claims.

## 6. Verification and Documentation

- [ ] 6.1 Run the smallest relevant Rust graph/import/path tests, then desktop unit tests, typecheck, lint, and build.
- [ ] 6.2 Runtime-verify native path tracing and explicit Graphify import in the Tauri app against a local fixture or temp repo.
- [ ] 6.3 Update the archived Review Memory Graph reference URL/status and `PROJECT_STATUS.md` only after the capability is implemented and verified.
