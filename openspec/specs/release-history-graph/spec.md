# Release History Graph Specification

## Purpose

Define CodeVetter's local release-oriented temporal graph, exact historical reconstruction, entity lineage, causal evidence, history workbench, Review context, and safe incremental refresh.

## Requirements

### Requirement: Repository history is organized around releases
The system SHALL build a versioned temporal graph whose chronological spine consists of recognized repository releases and an explicit unreleased range, with ordered commit deltas between checkpoints. It MUST assign commits deterministically from local Git ancestry, preserve tag/commit/tree anchors, and report shallow, missing, or ambiguous history instead of inventing releases.

#### Scenario: Tagged repository is indexed
- **WHEN** a repository contains recognized release tags and commits between them
- **THEN** the graph contains ordered release nodes whose commit ranges are reproducible for the same Git state and whose evidence identifies the corresponding tags and commits

#### Scenario: Repository has work after its latest release
- **WHEN** commits exist after the newest recognized release tag
- **THEN** the system places those commits under an explicit unreleased node without describing them as shipped

#### Scenario: Repository has no recognized releases
- **WHEN** no supported release tag can be established from local Git history
- **THEN** the system provides an unreleased history with a coverage gap explaining that release boundaries are unavailable

### Requirement: Change episodes connect intent, implementation, verification, and outcome
The system SHALL represent bounded change episodes that can link releases and commits to affected files or symbols, cited decisions, agent sessions, commands, reviews, findings, fix attempts, tests, QA evidence, and later outcomes. It MUST merge evidence into one episode only when an explicit or source-backed relationship supports the grouping.

#### Scenario: Review workflow has linked evidence
- **WHEN** a review, fix attempt, verification command, and QA run share a persisted review or commit relationship
- **THEN** the system exposes them as one ordered change episode with their original timestamps and source anchors

#### Scenario: Two nearby changes lack a reliable relationship
- **WHEN** changes occur near each other in time or touch similar files but have no explicit linking evidence
- **THEN** the system keeps them as separate episodes and may expose only a qualified inferred relationship

#### Scenario: Historical source has been rotated away
- **WHEN** a persisted record references a transcript or artifact that is no longer available
- **THEN** the episode retains the durable metadata, marks the source unavailable, and does not fabricate its missing content

### Requirement: Historical relationships preserve provenance and uncertainty
The system SHALL attach direction, relationship kind, trust, origin, human-readable evidence, and zero or more source anchors to every graph edge. Explanations MUST distinguish extracted facts, inferred leads, ambiguous matches, legacy evidence, unavailable evidence, and unknown facets.

#### Scenario: Direct Git relationship is recorded
- **WHEN** Git directly establishes that a commit changed a file within a release range
- **THEN** the corresponding relationship is extracted and cites the commit and file evidence

#### Scenario: Intent is inferred from a commit subject
- **WHEN** a commit subject suggests a reason but no decision marker, task, or session goal confirms it
- **THEN** the system labels the reason as inferred and presents the subject as evidence rather than established intent

#### Scenario: Evidence does not cross an external boundary
- **WHEN** local code history shows that an analytics event was emitted but no provider-side ingestion evidence exists
- **THEN** the system reports code-side emission separately from unknown provider ingestion and identifies the missing evidence boundary

### Requirement: Users can query history by release or repository entity
The system SHALL provide deterministic, bounded queries for releases, change episodes, commits, files, paths, and available symbol or event labels. Query results MUST support what, why, when, how, verification, and outcome facets and MUST include evidence, gaps, freshness, trust summary, and pagination or truncation metadata.

#### Scenario: User asks why an event exists
- **WHEN** an event label resolves to a changed callsite and related historical evidence
- **THEN** the result identifies the releases and episodes that introduced or modified it, cites available intent and implementation evidence, and marks unsupported reasons as unknown or inferred

#### Scenario: Entity reference is ambiguous
- **WHEN** a path, symbol, event, or release query has multiple near-equal matches
- **THEN** the system returns bounded candidates and does not silently select one history

#### Scenario: User follows an entity across releases
- **WHEN** a file or resolvable entity has evidence in multiple release ranges
- **THEN** the result returns its ordered evolution with rename or identity uncertainty made explicit

### Requirement: Releases preserve structural graph evolution
The system SHALL build an immutable compatible canonical structural checkpoint for every reachable release and unreleased HEAD plus reproducible commit deltas between checkpoints. Release comparison MUST expose added/removed/changed/evolved symbols and relationships, community movement, hub/bridge changes, and affected paths with structural source, trust, coverage, and engine metadata.

#### Scenario: Two releases have compatible structural snapshots
- **WHEN** consecutive releases have canonical graph evidence from compatible schema/engine contracts
- **THEN** the history graph exposes their deterministic topology delta and links every change to structural source evidence

#### Scenario: Older release cannot be reconstructed
- **WHEN** source history, language support, or index compatibility prevents a reliable structural snapshot
- **THEN** the release checkpoint records the affected topology coverage gap and does not substitute file-count or commit-count changes as symbol-level facts

### Requirement: Users can time-travel repository structure
The system SHALL reconstruct the repository graph and evidence state as of a selected release, commit, or date using the nearest compatible checkpoint plus ordered deltas. Reconstruction MUST NOT check out, mutate, or add files to the selected repository and MUST report the exact resolved revision, coverage, and missing Git objects.

#### Scenario: Reachable history contains merges
- **WHEN** a selected commit is part of a branched or merged Git DAG
- **THEN** reconstruction follows explicit parent-to-child materialization edges and never treats adjacent presentation-order commits as parent/child

#### Scenario: Recent-history window rolls forward
- **WHEN** a bounded recent-commit window drops older commits after a fast-forward
- **THEN** persisted ordering contains no stale or duplicate sequence rows and every retained release checkpoint remains directly discoverable

#### Scenario: User opens a historical commit
- **WHEN** a reachable commit has a compatible checkpoint/delta chain
- **THEN** CodeVetter shows the structural graph and available evidence as of that commit rather than the present-day graph with old commit labels

#### Scenario: Selected date falls between commits
- **WHEN** the user selects a date with no exact commit
- **THEN** the system resolves the latest reachable commit at or before that date and displays the resolution explicitly

### Requirement: Entity lineage survives repository evolution
The system SHALL connect entity versions across releases and commits using qualified identity, Git rename evidence, signature/content similarity, and neighborhood continuity. It MUST represent rename, move, evolution, split, merge, removal, and reintroduction as separate trust-bearing relationships and MUST retain ambiguous candidates.

#### Scenario: Symbol moves and is renamed
- **WHEN** a symbol changes path and name while Git/content/neighborhood evidence supports continuity
- **THEN** the entity history shows the old and new versions with a qualified lineage edge and supporting evidence

#### Scenario: Refactor splits one component
- **WHEN** one historical entity plausibly becomes multiple entities
- **THEN** the system represents candidate `split_into` relationships without collapsing the new entities into one identity

### Requirement: History joins product and runtime evidence through adapters
The system SHALL support versioned evidence adapters for local records and explicitly configured external imports, including release/deploy metadata, PR/issues, analytics/log exports, incidents, tasks, and discussions. Every imported record MUST retain provider/source, scope, observed/effective time, cursor/freshness, entity/release links, and deletion/disable controls; credentials and unrestricted raw payloads MUST NOT be stored in history rows.

#### Scenario: Analytics provider evidence is imported
- **WHEN** the user explicitly imports scoped provider evidence for an event
- **THEN** CodeVetter can distinguish event definition/callsite, local emission, provider ingestion, and dashboard/display evidence as separate cited states

#### Scenario: External adapter is stale or disabled
- **WHEN** an adapter has not refreshed within its declared freshness window or is disabled
- **THEN** historical answers retain existing cited records but label provider-side conclusions stale and stop requesting new data

### Requirement: Users can trace causal change threads
The system SHALL construct bounded cited threads across intent, implementation, verification, release/deploy, runtime outcome, regression, incident, fix, and superseding release. Causal edges MUST require explicit identifiers or source-backed relationships; temporal adjacency alone MUST remain an inferred lead.

#### Scenario: Event is missing after a release
- **WHEN** an event exists in code but imported runtime/provider evidence shows no corresponding observation after a release
- **THEN** the trace identifies the introducing episode, trigger/configuration path, verification evidence, release boundary, missing external observation, and next evidence needed

#### Scenario: Regression is fixed later
- **WHEN** a finding or incident is linked to one release and a verified fix to a later release
- **THEN** the thread connects introduction/detection/fix/verification without claiming causation from timestamps alone

### Requirement: Users can annotate missing or incorrect history
The system SHALL allow local user annotations that add missing intent, link evidence, or confirm/reject proposed entity lineage without modifying Git or original source records. Annotations MUST include author label, timestamp, target IDs, text or decision, and provenance, and MUST remain distinguishable from extracted evidence.

#### Scenario: Commit message lacks intent
- **WHEN** a user supplies the missing reason for a change episode
- **THEN** future answers include it as human-supplied evidence and continue to show that Git did not contain the reason

### Requirement: Repo presents a release timeline with inspectable graph evidence
The system SHALL provide a Repo history workbench with an ordered release spine, time slider, as-of graph, range/topology diff, entity lineage, causal episode trace, search/filters, annotations, facet summaries, and an evidence drawer. The interface MUST remain usable without an AI provider and MUST prioritize chronology and citations over graph decoration.

#### Scenario: User selects a release
- **WHEN** the user opens a release from the history spine
- **THEN** the UI shows its bounded change episodes, affected areas, verification and outcome signals, evidence coverage, and links to cited local sources

#### Scenario: User scrubs through Git history
- **WHEN** the user drags or keyboard-adjusts the history slider across commits or releases
- **THEN** the visible graph morphs through the resolved revisions with stable positions for surviving entities, distinct added/removed/changed relationships, an explicit current revision label, prefetched adjacent states, and no claim that interpolated animation frames are repository revisions

#### Scenario: Large release exceeds display bounds
- **WHEN** a release contains more nodes or edges than the interactive limits
- **THEN** the UI renders a stable bounded subset, reports truncation, and offers narrower filters or pagination

#### Scenario: History is stale
- **WHEN** repository HEAD or release tags differ from the graph metadata
- **THEN** the UI labels the graph stale and offers a refresh without presenting it as current

### Requirement: Review receives compact historical constraints
The system SHALL include a bounded release-history slice for changed files in Review and reviewer-proof export. This context MAY identify prior decisions, releases, failures, fixes, and verification evidence, but MUST NOT independently create a finding, change severity, or upgrade evidence status.

#### Scenario: Changed file has prior release history
- **WHEN** a review touches a file connected to prior change episodes
- **THEN** Review shows the most relevant cited episodes and constraints without obscuring the current diff

#### Scenario: Only inferred history is available
- **WHEN** all relevant historical relationships are inferred, ambiguous, or legacy-derived
- **THEN** Review labels them as leads requiring source verification and does not treat them as verified behavior

### Requirement: History refresh is local, incremental, bounded, and secret-safe
The system SHALL derive Git/structural history locally, persist only bounded redacted details, and refresh transactionally with progress, cancellation, resumable backfill, source coverage, and per-adapter freshness metadata. It MUST NOT make unconfigured network calls, read excluded secret-bearing paths, mutate the target repository, or require a new external runtime for core history.

#### Scenario: Incremental refresh follows new commits
- **WHEN** repository history advances without rewriting previously indexed release ranges
- **THEN** the system reuses valid indexed history and processes only affected commits and linked evidence

#### Scenario: Git history is rewritten
- **WHEN** stored fingerprints no longer match the repository ancestry or release tags
- **THEN** the system invalidates and rebuilds affected derived ranges without altering authoritative source records

#### Scenario: User cancels a large refresh
- **WHEN** the user cancels history construction before completion
- **THEN** the system leaves the last successful graph readable, discards partial transactional output, and reports that freshness was not advanced

#### Scenario: Historical file bounds are reached
- **WHEN** a revision contains more files or bytes than the configured historical extraction bounds
- **THEN** the checkpoint and all derived states preserve an explicit truncation/coverage gap and never report complete coverage

#### Scenario: Initial backfill starts on a long history
- **WHEN** a repository has many years of commits and releases
- **THEN** the system builds current HEAD and release checkpoints first, exposes partial coverage, and resumes commit-level deltas without blocking use of completed history
