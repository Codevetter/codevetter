## ADDED Requirements

### Requirement: Desktop presents the deterministic campaign state

CodeVetter SHALL render the existing campaign manifest, immutable baseline, candidate ledger, one next action, execution bounds, and stop reason in Performance. The desktop MUST NOT edit the campaign ledger, reinterpret prior evidence under new rules, invoke a model, or mutate product source.

#### Scenario: Campaign waits for an agent edit

- **WHEN** the campaign's next action is `propose_candidate`
- **THEN** the UI identifies the exact hypothesis and verification scope needed by an external coding agent without presenting an embedded build mode

#### Scenario: Campaign reaches its stopping rule

- **WHEN** budget, plateau, rejection, or qualified promotion stops the campaign
- **THEN** the UI shows the deterministic stop reason and preserves every attempted candidate outcome

