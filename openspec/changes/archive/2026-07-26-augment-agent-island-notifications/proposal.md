## Why

Agent Island now exposes safe team identity and actions, but it still behaves like a manually opened status list. Confirmed attention and completion can arrive while the user is focused elsewhere, and the collapsed pill does not show enough team state to inspire confidence without opening it.

## What Changes

- Add event-driven presentation for new confirmed attention, failure, and completion states without overriding a surface the user opened manually.
- Keep confirmed attention visible until its event resolves or the user explicitly collapses it.
- Auto-collapse informational completion and failure presentation after a bounded delay, pausing while the pointer is inside the island.
- Add a compact team-status rail for up to three visible sessions in the collapsed pill, with a bounded overflow count.
- Preserve Rust-owned event identity, action capability validation, privacy limits, off-by-default rollout, and exact Work focus routing.
- Adapt the public Open Island notification-surface lifecycle as a product reference while retaining CodeVetter's smaller supervised-helper architecture and existing visual language.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `native-agent-island`: Add event-driven notification presentation, user-owned versus automatic expansion, pointer-safe auto-collapse, and a collapsed team-status summary.

## Impact

- Swift helper state, view, panel sizing, and self-tests under `apps/desktop/native/AgentIsland`.
- Native Agent Island architecture documentation and local qualification coverage.
- No provider, repository, transcript, credential, Rust action, or process-launch authority moves into Swift.
- No new production dependency, protocol version, provider integration, deployment, or default-enable change.
