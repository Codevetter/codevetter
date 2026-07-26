## Context

Work currently launches one user-selected Codex or Claude process from an outcome prompt. Its left sidebar combines live terminals and indexed history under project groups, while Agent Island receives provider, project, status, and capability data from the Rust terminal registry. The native helper is intentionally presentation-only.

The requested experience is one coherent system: Work should explain which agents a task needs, the user should confirm that plan, and both Work and Agent Island should preserve each launched agent's purpose while the team runs.

## Goals / Non-Goals

**Goals:**

- Recommend a small, understandable team from the task text without latency, cost, or privacy expansion.
- Keep the human in control of provider choice and every launched process.
- Make live attention easier to scan than project-grouped conversation history.
- Preserve role and team identity through React, Tauri IPC, Rust lifecycle snapshots, and Agent Island.
- Remain backward-compatible with saved Work state and protocol messages that lack team metadata.

**Non-Goals:**

- Autonomous task decomposition, inter-agent messaging, shared hidden context, or automatic approval.
- A general multi-agent graph/cockpit or revival of the retired orchestration trace.
- Model-generated recommendations, repository-wide analysis, new provider integrations, or default Agent Island enablement.
- Database persistence or migration for recommendations and team metadata.

## Decisions

### Use a deterministic local recommendation engine

A pure TypeScript module will map bounded task text to a maximum of three role recommendations. One implementation role is always required; review, verification, investigation, or UI roles are added only when explicit task signals justify them. Each recommendation carries a plain-language reason and a role-scoped prompt.

This is preferred over an LLM planner because the start flow must be immediate, reproducible, private, testable, and available before a provider process exists. It is preferred over repository scanning because the prompt and selected repository are enough for a first honest recommendation and scanning would imply evidence the engine does not have.

### Confirm a team before launching separate owned sessions

The start canvas will show the recommendation after the user provides an outcome. The user can include or exclude optional roles and change each provider. Recommendations distinguish roles that are useful now from review or verification roles that require a completed change. Initial confirmation launches only included current-phase roles, with a shared bounded team identifier and distinct role-scoped prompts. Later-phase roles remain visibly queued until the user explicitly starts them; queued roles are never represented as live sessions or sent to Agent Island. The primary role becomes selected; the others remain visible and independently stoppable.

The implementation role is the only workspace-write session in a recommended team. Investigation, product-UX, review, and verification roles launch read-only, and Work shows that permission boundary before confirmation. Existing single-conversation behavior remains the one-agent case. There is no shared write coordination, merge automation, or claim that concurrent agents cannot conflict.

Board's current work-item contract owns one terminal/session attachment. When a team starts from a work item, only the primary implementation session carries that work-item identity; specialist sessions remain associated through local team identity so they cannot race a last-write-wins Board attachment.

Multi-agent launch requires one explicit concrete repository already present in Work's verified project list. The confirmation action is guarded while launch is in flight so repeated Enter/click events cannot create a duplicate team. Existing one-agent launch recovery remains available for manually entered paths.

### Replace project nesting with a collapsible run navigator

The always-visible project-grouped sidebar will become a drawer-like run navigator that can be collapsed. It will organize entries into Needs attention, Active, and Recent. Rows will state role, provider, operational state, and repository. Indexed history remains accessible under Recent and never launches on selection.

This preserves navigation while reducing the visual and conceptual weight of a permanent sidebar. Project paths remain searchable metadata rather than the primary hierarchy.

### Extend the existing lifecycle with optional bounded metadata

`teamId` and `roleLabel` will be optional fields on the Work seed, saved terminal, Tauri start input, Rust running-session registry, snapshots, native session payload, and Swift protocol model. A backward-compatible optional local team-plan shape preserves queued roles, repository, provider, instructions, and team identity across Work remounts or app restarts without a database migration. Rust bounds and sanitizes terminal metadata before storing it. Old saved state and old/additive messages deserialize with no role or team.

Agent Island will display a role when present and use it in accessibility labels, but recommendations and launch decisions never enter the Swift helper. The helper still cannot read repositories, transcripts, settings, or credentials and cannot start or stop agents.

### Use Vibe Island as a behavioral reference, not a code dependency

The native presentation will follow the useful interaction hierarchy demonstrated by Vibe Island: a minimal collapsed status pill, an expanded list of understandable session cards, confirmed questions/permissions promoted above ordinary progress, calm completed states, and one exact jump-back action. CodeVetter will express that hierarchy using its existing native palette, trusted lifecycle model, and accessibility contracts.

Vibe Island itself is proprietary, while the available Open Island alternative is GPLv3 and CodeVetter currently has no repository license. No source, assets, strings, sounds, or trademarks will be copied. The implementation remains a clean-room augmentation of CodeVetter's existing Swift helper.

### Treat status as evidence, not recommendation confidence

Recommendation reasons describe heuristic task signals only. Runtime labels continue to come from provider lifecycle evidence. The UI will not label a recommended role as active until its provider process has actually started, and a team launch may partially fail without upgrading failed sessions to success.

## Risks / Trade-offs

- **Keyword rules can over- or under-recommend roles** → keep the set small, explain every rule-derived recommendation, use explicit risk/verification precedence when signals exceed the cap, and let the user edit the team before launch.
- **Post-change agents can inspect the wrong tree when started too early** → keep review and verification queued until a separate explicit later launch.
- **Parallel writers can conflict in one checkout** → allow exactly one recommended workspace-write implementation role and force every specialist role to read-only.
- **A broad or duplicate launch can create unintended processes** → require a verified repository for teams and disable confirmation atomically while the batch is starting.
- **Batch launch can partially succeed** → keep each session independently visible with provider-specific failure and recovery rather than rolling back healthy sessions.
- **Additional native protocol fields can drift** → make fields optional, add Rust and Swift decoding tests, and retain the same fail-closed capability validation.
- **Queued roles can disappear across restart** → persist the bounded local team plan alongside saved terminals and restore it without starting a provider.
- **Added native fields can exceed the 64 KiB envelope at maximum session count** → bound metadata and qualify a maximum-size snapshot.
- **Recent history may become less discoverable** → preserve search and a clearly labelled Recent group inside the run navigator.
- **A redesign can accidentally revive a cockpit** → keep one focused conversation as the main canvas and cap the visible team recommendation at three roles.
