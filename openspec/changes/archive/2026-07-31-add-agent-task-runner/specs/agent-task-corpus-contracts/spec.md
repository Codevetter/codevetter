## MODIFIED Requirements

### Requirement: Corpus documents use closed versioned contracts

The system SHALL define closed versioned contracts for corpus indexes, task
manifests, fixture bundles, acceptance contracts, known-good changes, check
results, qualification receipts, agent adapters, deterministic run plans, and
run receipts. Adapter and receipt readers MUST preserve supported v1 documents
while new runner output uses v2 identities and lifecycle evidence. Every
contract MUST reject unknown fields, missing required fields, invalid enum
values, duplicate identifiers, unsafe placeholders, and values outside
declared bounds.

#### Scenario: A contract document is valid

- **WHEN** a document contains exactly the required and optional fields for its
  declared schema version and every value is within bounds
- **THEN** contract validation accepts it without adding inferred values

#### Scenario: An unknown field appears

- **WHEN** any contract object contains a field not declared by its schema
- **THEN** validation rejects the document and identifies the exact field path
