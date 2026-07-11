# shiprank-retirement Specification

## Purpose
TBD - created by archiving change consolidate-taste-into-codevetter. Update Purpose after archive.
## Requirements
### Requirement: Freeze standalone product development
ShipRank SHALL stop accepting standalone product feature work once the consolidation change is approved, except work necessary to preserve, transfer, validate, or safely retire retained capability and data.

#### Scenario: New ShipRank SaaS feature is proposed
- **WHEN** work targets Product Arena, evaluator marketplace, payments, or standalone study management
- **THEN** the work is rejected or redirected unless it is explicitly required for the CodeVetter capability transfer

### Requirement: Preserve durable assets before retirement
The retirement SHALL inventory and preserve useful evaluation algorithms, tests, fixtures, datasets, research notes, and source history before removing ShipRank from the active fleet.

#### Scenario: Retained capability passes in CodeVetter
- **WHEN** the mapped CodeVetter tests and acceptance scenarios pass
- **THEN** the inventory records each ShipRank asset as transferred, archived, or intentionally discarded with a reason

### Requirement: Retired product status
ShipRank SHALL be marked retired in its README and project status, removed from active fleet product inventories, and identified as superseded by CodeVetter's verification capability.

#### Scenario: Fleet inventory is refreshed
- **WHEN** the retirement documentation is complete
- **THEN** fleet tooling no longer treats ShipRank as an independently releasable product and points capability ownership to CodeVetter

### Requirement: Safe external decommissioning
Cloud deployments, D1 data, capture queues, domains, and remote repository settings SHALL remain unchanged until an operator explicitly approves the exact decommission action after data-retention review.

#### Scenario: Local retirement is complete without cloud approval
- **WHEN** source and fleet documentation are retired but no resource-specific approval exists
- **THEN** the product is marked locally retired with external resources listed as pending decommission rather than deleted

### Requirement: Recoverable source history
Retirement MUST preserve a recoverable source-history reference and MUST NOT delete the local or remote repository as part of capability consolidation.

#### Scenario: Future audit needs ShipRank history
- **WHEN** an operator needs to trace the origin of a migrated diagnostic or dataset
- **THEN** the retirement record provides the repository and final active revision needed to recover that history

