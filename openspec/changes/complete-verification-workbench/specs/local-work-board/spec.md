## ADDED Requirements

### Requirement: Board exposes managed-run lifecycle and checkpoints
Board cards SHALL show managed-run isolation state, provider/profile, current
checkpoint, exact change identity, and the most relevant explicit next action
without treating lifecycle progress as review or verification proof.

#### Scenario: Managed run reaches a check checkpoint
- **WHEN** a run records current check results for its isolated change identity
- **THEN** the card shows the check outcome and available Review or Verify action
- **AND** does not display a verified completion badge without qualifying evidence

### Requirement: Board coordinates explicit diff, check, PR, and archive handoffs
Board SHALL link to authoritative diff, Review, Testing, PR preparation, and
archive actions using the managed run identity. Commit, push, PR creation, and
worktree removal MUST remain separately confirmed.

#### Scenario: User archives completed managed work
- **WHEN** the work has a recorded completion disposition and no owned process remains
- **THEN** Board shows the current worktree/diff disposition before cleanup
- **AND** removes the worktree only after explicit confirmation and current identity validation
