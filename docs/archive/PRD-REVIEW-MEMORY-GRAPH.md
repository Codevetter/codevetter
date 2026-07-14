# PRD: Review Memory Graph

Status: release-qualified locally — schema-v2 trust paths and the original metadata/review graph remain labeled fallbacks; the canonical structural graph, trusted Review/proof context, large-graph workbench, history playback, and Graphify interchange are runtime-verified; signed release publication remains
Owner: unassigned
Last updated: 2026-07-14

## Summary

Review Memory Graph adds a local, queryable project graph to CodeVetter's Review and Repo workflows. The fast legacy metadata map remains available and explicitly labeled, while the canonical graph uses syntax extraction, stable source locations, cross-file resolution, trust, coverage, communities, incremental repair, indexed queries, snapshots, and history playback. It borrows the useful parts of Hunk and Graphify without turning CodeVetter into a generic diff viewer or generic code intelligence product.

The product outcome is simple: when a user reviews an agent-written diff, CodeVetter should show the changed hunks, nearby code relationships, prior decisions, past command/test evidence, and review findings in one evidence-backed loop.

## Why This, Why Now

CodeVetter already has the right wedge: make agent-written code trustworthy by combining static review, repo history, replay, runtime checks, fixes, and revalidation. The remaining gap is context quality. The reviewer sees a diff and some history signals, but not a durable local model of how changed files connect to callers, routes, Tauri commands, database tables, prior decisions, tests, and past failures.

Hunk is useful because it makes review flow hunk-first: sidebar, file stream, hunk navigation, inline notes, and watch-mode refresh.

Graphify is useful because it makes a repo queryable: code, docs, schemas, infrastructure, and "why" comments become a local graph with report and JSON artifacts.

CodeVetter should take those product patterns and attach them to the verification loop.

## Target User

Developers who ship mostly agent-written code and need a local-first quality gate before merging or deploying.

They are not asking for a second IDE. They need to answer:

- What changed?
- What code or behavior is nearby?
- Why was this code shaped this way?
- What did the agent claim it tested?
- What evidence do we actually have?
- Did the fix resolve the original finding?

## Goals

- Add a local project graph artifact that Repo Unpacked and Review can reuse.
- Show changed-file neighborhoods in Review: callers, routes, commands, schemas, docs, prior decisions, past failures.
- Anchor CodeVetter findings and evidence to files/hunks.
- Feed graph neighborhoods into the review prompt for changed files.
- Keep all artifacts local and safe to commit only when the user opts in.
- Make the first slice useful even without a new production dependency.

## Non-Goals

- Do not replace CodeVetter's desktop Review UI with Hunk.
- Do not install Graphify or Hunk as mandatory production dependencies in the first slice.
- Do not add always-on assistant hooks to this repo or target repos by default.
- Do not build a broad IDE/code-search replacement.
- Do not send code to external graph/LLM providers without an explicit backend choice and user-visible disclosure.
- Do not mutate target repos unless the user explicitly asks to write graph artifacts there.

## Product Shape

### Review Tab

When a repo and diff range are selected, Review shows:

- File/hunk navigation for changed files.
- CodeVetter findings anchored to file path and line/hunk when available.
- Related graph context for the active file/hunk:
  - direct imports/calls/exports
  - route or command entrypoints
  - Tauri IPC command boundaries
  - database schema/table references
  - docs/ADR/decision links
  - prior command/test evidence touching the same files
  - recurring prior findings touching the same files
- Evidence status per finding: not checked, reproduced, fixed, not reproduced.
- A re-review path that includes changed-file graph neighborhoods in the prompt.

### Repo Unpacked

Repo Unpacked should become the user-facing place to build, inspect, and refresh the graph:

- "Scan only" continues to produce deterministic inventory.
- "Generate brief" keeps producing an evidence-backed system brief.
- "Build memory graph" creates or updates a local graph artifact.
- "Query graph" asks scoped architecture/change-impact questions without rereading the whole repo.

### Artifacts

CodeVetter-owned artifacts should live outside target repo source by default, likely under CodeVetter app data keyed by repo path/hash. Optional export can write to a target repo path later.

Candidate artifact names:

- `codevetter-graph.json`
- `codevetter-graph-report.md`
- `codevetter-graph.html`

Canonical artifacts remain in CodeVetter's local SQLite/app-data boundary. Versioned
JSON and Markdown exports are explicit user actions; target repositories are never
mutated by graph build or refresh.

## Implementation Plan

### Phase 0: Pinned Parity Spike

Graphify's `v8` branch is pinned to commit
`961b78e57a10e9c5bb98421ff3e45b40be73542b`; its fixture and capability matrix
are kept in-repo for repeatable comparison.

Acceptance:

- Document where Graphify is stronger and where CodeVetter meets the functional
  floor. Implemented in `docs/GRAPHIFY-PARITY.md`.
- Keep Graphify optional and offline-safe. Implemented through explicit node-link
  import and adapter boundaries; no Graphify runtime dependency was added.
- Preserve an honest gap: CodeVetter currently supports 15 documented language
  variants while Graphify exposes a broader grammar family set.

### Phase 1: CodeVetter-Owned Minimal Graph

Implement a small graph builder in the Tauri backend using existing repo scan paths before adding a new dependency.

Suggested node types:

- file
- package
- route
- tauri_command
- db_table
- script
- decision
- test

Suggested edge types:

- imports
- calls_or_references
- defines
- routes_to
- persists_to
- tests
- decided_by
- changed_with

Acceptance:

- Repo Unpacked can build and persist a graph for a selected repo. Implemented as the `repo_graph` field inside the saved Repo Unpacked inventory JSON.
- Graph contains at least files, package scripts, Tauri commands, route files, tables, and decision markers where present. Implemented for package/script nodes, route nodes, Tauri command nodes, DB table nodes, test nodes, and `WHY:` / `DECISION:` / `TRADEOFF:` decision nodes.
- Graph rebuild is deterministic for the same repo state. Covered by backend unit test.
- No target repo files are modified. Implemented; graph artifacts are stored in CodeVetter's local report inventory, not written into the target repo.
- No external network calls are required. Implemented; first slice is pure local scanning and source marker parsing.

### Phase 1.5: Review-Scoped Memory Graph

Build a bounded graph for the current review from already-computed local signals while the persisted repo graph is still pending.

Acceptance:

- Changed files, evidence candidates, procedure gates, blast radius, and history context are represented as graph nodes and edges. Implemented for `review_memory_graph` in CLI review results.
- Review prompt includes a compact "Changed-file graph neighborhood" section. Implemented with explicit warning that graph edges are navigation leads, not ground truth.
- Review UI shows a compact graph context panel in the result sidebar. Implemented.
- Reviewer proof export includes the graph neighborhood. Implemented in `buildReviewerProofMarkdown`.
- No target repo files are modified and no new dependency is required. Implemented.

### Phase 2: Review Context Integration

Use the graph to enrich a review run.

Acceptance:

- For a selected diff, CodeVetter resolves changed files to graph nodes. Implemented for review-scoped graph nodes.
- Review prompt includes a compact "Changed-file graph neighborhood" section. Implemented.
- Review UI shows a graph context panel for the selected finding or changed file. Implemented for review-level graph context plus a selected-finding focused subgraph in the Review sidebar and copied reviewer proof.
- Context is bounded so large repos do not flood the prompt.
- Existing `npm run test:review-proof` and the smallest relevant backend test pass.

### Phase 3: Hunk-Like Review Navigation

Improve the desktop diff/review flow without embedding Hunk directly.

Acceptance:

- Review/fix diff has stable file sidebar navigation.
- User can jump between files and hunks from keyboard or click targets.
- Findings can focus the relevant file/hunk when line/path data is available.
- Hunk-level revert still works.

### Phase 4: Optional Interop

Add optional export/open paths for users who already use Hunk or Graphify.

Acceptance:

- CodeVetter can export findings as Hunk-style agent-context notes or another documented sidecar format. Implemented through Repo Unpacked `agent_context_markdown` sidecar export with repo graph and history context plus Review's selected-finding "Copy note" action, which includes file/line, evidence status, local history context, focused graph nodes/edges, and next verification actions.
- CodeVetter can export its local graph as JSON for Graphify comparison. Implemented through Repo Unpacked `repo_graph_json` export.
- CodeVetter can import a graph JSON/report only through an explicit user action. Implemented in Repo Unpacked through an explicit Graphify JSON file action that accepts bounded `nodes` plus `links`/`edges`, validates endpoints, preserves supported confidence/source/community metadata, and renders a transient preview without mutating the saved report or target repo.
- CodeVetter can trace a bounded path between decisive native or imported endpoints. Implemented with exact ID/path/label precedence, explicit ambiguity candidates, trust-weighted traversal, stored-direction hop display, source anchors, and traversal-bound reporting. Native schema-v2 paths from changed files to routes, commands, tables, scripts, or tests are capped and included in Review/proof as qualified context; uncertain/imported/legacy hops remain navigation leads and cannot independently create findings or verified claims.
- Missing optional CLIs produce clear non-fatal UI errors.
- No production dependency is added unless a prior spike proves the value and tradeoff. Implemented for the export slice; no Graphify/Hunk runtime dependency was added.

### Phase 5: Canonical Structural Graph

Replace metadata-map claims with a persistent structural graph while retaining the
legacy map as an explicitly labeled fallback.

Acceptance:

- Supported languages extract named symbols and source ranges with exact coverage,
  skipped-file, unsupported-language, and diagnostic reporting.
- Cross-file imports, calls, inheritance, tests, routes, commands, persistence,
  docs/config, and analytics relationships carry exact/inferred/ambiguous trust and
  source provenance.
- Full and incremental builds repair changed, deleted, renamed, and reverted files
  transactionally without stale nodes or worktree mutation.
- Indexed search, explain, neighbors, impact, trust-weighted path, community,
  hub/bridge, projection, pagination, and snapshot-diff operations stay bounded.
- The Repo workbench supports large graphs, accessible node/list navigation,
  visible-versus-total counts, filters, source inspection, path highlighting,
  community focus, stale refresh, comparison, and history playback.
- Review and proof receive compact trusted context, but graph topology cannot create
  findings, severity, or verified-runtime evidence.
- The current 445-file CodeVetter corpus builds 35,775 nodes / 58,344 edges in
  369.54 ms release mode; one-file refresh is 235.79 ms, delete/rename repair is
  0.02/0.05 ms, warm status/no-op is 1.5589 ms, and search is
  0.1338/0.1481 ms p50/p95.

## UX Requirements

- Do not make users read a graph before reviewing. The graph should answer "what matters for this diff?"
- Keep the primary Review screen focused on findings, evidence, and revalidation.
- Use graph context as a side panel or expandable section, not a separate maze.
- Prefer file/hunk anchors over abstract node visualizations.
- Show source paths for every graph-derived claim.
- Mark uncertain relationships as inferred, not evidence.

## Technical Notes

- CodeVetter already has repo scanning in `apps/desktop/src-tauri/src/commands/unpack.rs`.
- Review already computes changed files and review context in `apps/desktop/src-tauri/src/commands/review.rs`.
- Review UI already parses fix diffs into files/hunks in `apps/desktop/src/pages/QuickReview.tsx`.
- Keep the first graph model serializable JSON with explicit schema versioning.
- Use bounded neighborhoods: e.g. changed file -> direct neighbors -> top N decision/test/history nodes.
- Cache by repo path plus Git HEAD or working tree fingerprint where possible.
- Treat generated graph context as review input, not ground truth.

## Privacy And Safety

- Default to local-only graph building.
- Do not install Graphify always-on hooks as part of CodeVetter.
- If optional Graphify integration is explored, prefer `uvx graphifyy` or user-installed CLI detection over vendoring it.
- If an LLM-backed graph extraction mode exists later, require explicit provider/backend choice and show whether code leaves the machine.
- Do not include secrets, env files, SSH keys, cloud credentials, kube configs, or production configs in graph artifacts.

## Open Questions

- Which additional language grammars earn their ongoing binary/test cost after the
  supported 15-language matrix?
- Should evidence graph nodes include raw transcript excerpts, or only source/event anchors?
- Should an optional committed sidecar ever be added, or should app-data plus
  explicit export remain the only persistence boundary?
- Which profile would justify a Go dashboard/API layer after Rust IPC, packaging,
  and duplicated-semantics costs are included?

## Pickup Checklist

- Read `README.md`, `PROJECT_STATUS.md`, `docs/IDEA-DUMP.md`, and this PRD.
- Inspect `apps/desktop/src-tauri/src/commands/unpack.rs`, `apps/desktop/src-tauri/src/commands/review.rs`, and `apps/desktop/src/pages/QuickReview.tsx`.
- Read `docs/GRAPHIFY-PARITY.md`, `docs/PERFORMANCE.md`, and the active structural
  graph OpenSpec before changing engine or schema behavior.
- Preserve the canonical-versus-legacy distinction and the graph-trust boundary.
- Run the smallest relevant check before handoff.

## References

- Hunk: https://github.com/modem-dev/hunk
- Graphify: https://github.com/Graphify-Labs/graphify — pinned parity baseline `v8` commit `961b78e57a10e9c5bb98421ff3e45b40be73542b`; CodeVetter imports local node-link JSON only through explicit action and never installs or invokes Graphify implicitly.
