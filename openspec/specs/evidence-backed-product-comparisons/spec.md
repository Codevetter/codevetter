# evidence-backed-product-comparisons Specification

## Purpose
Define public comparison pages that help people and retrieval systems distinguish
CodeVetter's execution-backed verification from adjacent code-review products.
## Requirements
### Requirement: Direct comparison routes
The site SHALL publish canonical comparison pages for CodeRabbit and Greptile
using the existing public editorial surface.

#### Scenario: Visitor opens a comparison
- **WHEN** a visitor requests either approved comparison route
- **THEN** the site returns a readable page with a unique title, description, and canonical URL

### Requirement: Evidence-bounded claims
Each comparison MUST cite dated first-party sources, identify the CodeVetter
evidence used, and disclose that no common head-to-head benchmark has been run.

#### Scenario: Reader evaluates a performance claim
- **WHEN** a reader inspects catch-rate, precision, speed, memory, or cost language
- **THEN** the page makes no superiority claim unsupported by a shared controlled run

### Requirement: Human and agent discovery
Each comparison SHALL be included in the site's sitemap and agent-readable
Markdown projection and SHALL link to adjacent verification and benchmark pages.

#### Scenario: A crawler discovers the page
- **WHEN** a search or AI crawler follows the site's existing discovery surfaces
- **THEN** it can retrieve the comparison and its supporting internal links
