## Why

Work asks the user to choose a provider before it has helped them understand the job, and its conversation sidebar mixes live work with history in a way that weakens confidence. Agent Island then reports sessions without explaining the role each agent is performing. CodeVetter should turn one stated outcome into an understandable, user-confirmed agent team and preserve that role context while the agents run.

## What Changes

- Add a deterministic, local agent-team recommendation to the Work start flow.
- Explain which roles are recommended, why each role is useful, and which provider will run it.
- Let the user include, exclude, or change recommended agents before any process starts.
- Launch the confirmed team as separate owned Work conversations with role-scoped prompts and stable team identity.
- Replace the always-visible conversation sidebar with a calmer, collapsible run navigator organized by attention and recency rather than project nesting.
- Carry bounded role and team labels through the Rust-owned terminal lifecycle into Agent Island.
- Augment the existing native Agent Island with the proven Vibe Island interaction pattern: a glanceable collapsed pill, expanded team/session cards, dominant confirmed attention actions, calm completion, and exact jump-back.
- Keep Agent Island presentation-only: recommendations and launch confirmation remain in Work, and the native helper gains no repository, transcript, credential, or process authority.

## Capabilities

### New Capabilities

- `work-agent-team-recommendation`: Deterministic role recommendations, user confirmation, team launch, and bounded recommendation explanations in Work.

### Modified Capabilities

- `agent-conversation-workspace`: Work changes from a provider-first single launch to an outcome-first, optionally multi-agent confirmed launch and a collapsible status-oriented run navigator.
- `native-agent-island`: Native session summaries include bounded team and role context supplied by the trusted Rust lifecycle.

## Impact

- React Work state, start flow, run navigation, saved workspace shape, and focused E2E/unit coverage.
- Typed Tauri IPC and the Rust agent-terminal registry for optional bounded team metadata.
- Native Agent Island Rust snapshots, Swift protocol/view, and self-tests. Vibe Island is a behavioral reference only: its proprietary implementation/assets are not imported, and GPL alternative source is not copied into this currently unlicensed repository.
- No new production dependency, model call, network service, database migration, provider permission, or deployment behavior.
