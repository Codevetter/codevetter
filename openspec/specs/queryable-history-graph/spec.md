# Queryable History Graph

## Purpose

Define a local, cited, bounded graph for exploring why files and related concepts exist.

## Requirements

### Requirement: Repo Unpacked persists a bounded local history graph
The system SHALL derive a versioned deterministic graph from local history evidence with nodes for files, commits, decisions, and tests and relationships for touches, explains, verifies, and co-changes. Existing history-brief snapshots MUST remain readable with an empty legacy graph.

#### Scenario: New history brief is built
- **WHEN** Repo Unpacked performs a full local history scan
- **THEN** the persisted brief records changed files for bounded recent commits and emits graph nodes/edges with citations and explicit truncation metadata

#### Scenario: Existing history brief is opened
- **WHEN** a schema-v1 history brief lacks graph and commit-file fields
- **THEN** the system loads it without failure or on-disk rewrite and exposes the graph as empty legacy context

### Requirement: User can query why a file or concept exists
The system SHALL answer bounded file/text queries over the active local history graph using exact ID/path/label precedence followed by deterministic token matching and one-hop relationship expansion.

#### Scenario: Exact file path is queried
- **WHEN** the query matches a graph file path exactly
- **THEN** the response centers that file and returns related commits, decisions, tests, and co-change files with relationship evidence and citations

#### Scenario: Text query has multiple matches
- **WHEN** a text query matches multiple history nodes
- **THEN** the response returns a stable ranked bounded result set with confidence/lead qualification rather than silently treating one weak match as fact

#### Scenario: No bounded match exists
- **WHEN** no node matches the query within configured limits
- **THEN** the system reports no local history match without claiming that no relevant history exists

### Requirement: History graph strengthens Review without becoming ground truth
The system SHALL surface available recurring findings, agent-session notes, commands, and cited history relationships near changed files while labeling commit subjects, conversation, and topology as leads rather than verified intent.

#### Scenario: Changed file has multiple history evidence kinds
- **WHEN** a Review file has decisions, commits, recurring findings, or command/session anchors
- **THEN** the explanation and graph view rank the file using those independent evidence kinds and retain citations to each available source

#### Scenario: Only weak history evidence exists
- **WHEN** an explanation relies only on a commit subject, conversation excerpt, or graph relationship
- **THEN** the UI and proof mark confidence as thin or lead-only and do not create a finding or verified claim from history alone

### Requirement: History queries remain local, safe, and bounded
The system MUST perform graph construction and queries locally, exclude secret-bearing paths, and cap commit/file/node/edge/query expansion for large repositories.

#### Scenario: Repository contains secret-bearing paths
- **WHEN** local history includes an environment, credential, SSH, secret, or production-config path excluded by CodeVetter history policy
- **THEN** the graph omits that path and does not expose its content or citation
