# Public verification content

## ADDED Requirements

### Requirement: Verification education cluster
The public site SHALL expose canonical pages for coding-agent verification, verifying AI-generated code, review versus verification, and verification evidence bundles.

#### Scenario: Reader enters through any guide
- **WHEN** a reader opens any cluster route
- **THEN** the page answers the route's primary question first, exposes honest limitations, and links to adjacent guides, proof, and a product action

### Requirement: Evidence-backed proof hub
The benchmark page SHALL preserve committed benchmark values, outputs, methodology, and limitations while distinguishing published recognition evidence from broader implemented infrastructure and unproven production outcomes.

#### Scenario: Reader interprets the benchmark
- **WHEN** a reader opens `/benchmark`
- **THEN** synthetic scope, precision constraints, missing cost/latency evidence, and reproduction links remain visible

### Requirement: Human and agent parity
Every new canonical page SHALL have a substantive agent-readable Markdown counterpart derived from the same content source.

#### Scenario: Agent requests Markdown
- **WHEN** an agent requests the matching `.md` route
- **THEN** it receives the same core claims, limitations, and related links as the HTML page

### Requirement: Search and accessibility integrity
Every new page SHALL provide canonical metadata, supported structured data, sitemap inclusion, semantic headings, visible focus, responsive reading layout, and links that do not rely on color alone.

#### Scenario: Narrow viewport and keyboard use
- **WHEN** a reader uses the page at 390 pixels or navigates by keyboard
- **THEN** content remains readable without horizontal scrolling and every action has a visible focus state
