## REMOVED Requirements

### Requirement: Board projects the product workflow

**Reason**: CodeVetter will not compete with dedicated task-management products by retaining a primary planning board.

**Migration**: Existing `/board` links redirect to Usage. Historical local work-item records remain untouched during the compatibility period.

### Requirement: Work cards expose concise evidence and next action

**Reason**: Task-card orchestration is no longer a primary CodeVetter product responsibility.

**Migration**: Review, Testing, Repo Unpack, and Performance expose their own authoritative evidence directly.

### Requirement: Work detail connects existing specialist surfaces

**Reason**: Specialist evidence surfaces no longer depend on a generic task-detail hub.

**Migration**: Deep links and repository context continue through each retained surface's existing entry contract.

### Requirement: Board remains local, fast, and visually complete

**Reason**: The Board UI is discontinued rather than maintained as a hidden alternate mode.

**Migration**: Local records remain preserved without an active Board route; a later cleanup may offer explicit export or deletion separately.

### Requirement: Board exposes managed-run lifecycle and checkpoints

**Reason**: Coding-agent lifecycle belongs in official agent clients and external automation hosts.

**Migration**: CodeVetter consumes resulting changes and evidence through Review, Testing, and Performance instead of managing the build lifecycle.

### Requirement: Board coordinates explicit diff, check, PR, and archive handoffs

**Reason**: GitHub and agent clients remain authoritative for PR and worktree lifecycle operations.

**Migration**: CodeVetter retains change review and executable verification without presenting task/archive orchestration.

