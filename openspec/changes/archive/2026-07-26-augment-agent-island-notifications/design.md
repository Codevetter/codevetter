## Context

The supervised Swift helper receives bounded Rust snapshots and currently exposes only a boolean `expanded` state. Every expansion follows the same path, so the helper cannot distinguish a deliberate user-opened surface from an event-driven notification. The collapsed pill also reduces every additional session to one count.

Open Island's public implementation separates notification presentation from the full session list, validates a notification against current session state, auto-collapses only informational surfaces, and pauses dismissal during pointer interaction. CodeVetter can adapt those lifecycle decisions without importing Open Island's independent process discovery, hook installation, persistence, or provider authority.

## Goals / Non-Goals

**Goals:**

- Surface newly confirmed attention, failure, and completion while the user is working elsewhere.
- Never activate CodeVetter or steal keyboard focus for automatic presentation.
- Preserve a manually expanded island until the user collapses it.
- Keep actionable attention open until the underlying event changes or resolves.
- Auto-collapse informational presentation after a bounded delay that pauses during pointer interaction.
- Show the state of up to three teammates in the collapsed pill.
- Keep the behavior deterministic and covered by Swift self-tests.

**Non-Goals:**

- Discover or control provider sessions that CodeVetter does not own.
- Read prompts, transcripts, repositories, terminal output, provider settings, or credentials from Swift.
- Add notification sounds, provider integrations, production dependencies, protocol fields, or a protocol version.
- Enable Agent Island by default or claim real-provider qualification.
- Copy Open Island's overlay controller, assets, strings, branding, or independent app architecture wholesale.

## Decisions

### 1. Model presentation ownership explicitly

Replace the boolean expansion source of truth with a presentation state:

- `collapsed`
- `userExpanded`
- `automatic(sessionID, eventID, kind)`

`expanded` remains a derived convenience. Manual toggle always enters or leaves `userExpanded`; snapshots can create or reconcile only `automatic`.

This prevents a lifecycle update from collapsing or replacing a surface the user intentionally opened. A separate transient notification window was considered, but it would duplicate panel placement, action rendering, and accessibility behavior.

### 2. Derive automatic presentation from trusted snapshot transitions

A pure transition function compares the previous and next bounded session lists. It can emit:

- persistent attention for a new confirmed `needsHelp` event;
- informational presentation for a new `failed` or `completed` event;
- no presentation for ordinary working, paused, disconnected, preview, repeated, or legacy-unchanged state.

Event identity, not status text, defines novelty. Attention outranks failure and completion using the existing stable status priority. Swift still cannot perform an action without Rust revalidating the exact event.

### 3. Keep automatic presentation non-activating

The panel may resize and order front for automatic presentation, but it becomes key and selects a keyboard target only for `userExpanded`. This makes the visual notification noticeable without stealing typing focus from the editor or terminal.

### 4. Auto-collapse only informational state

Completion and failure presentation schedules a ten-second collapse. Pointer entry cancels the pending dismissal; pointer exit schedules a fresh bounded delay. Confirmed attention has no timer and remains expanded until the event resolves, is replaced, or the user collapses it.

The model owns this small dismissal scheduler because presentation ownership and snapshot reconciliation already live there. It uses cancellable `DispatchWorkItem` state and performs UI mutations on the main queue.

### 5. Use a compact semantic team rail

The collapsed pill shows the first three sessions in existing priority/recency order as compact role/provider initials with status color. A remaining count is shown only when more than three sessions exist. The rail is decorative visually but contributes a bounded status summary to the collapsed accessibility label.

No prompt, outcome, command, path, model response, or opaque team identifier enters the rail.

### 6. Keep motion structural and reduced-motion safe

The pill-to-expanded transition uses a short ease-out treatment around 180 ms for SwiftUI-owned shape and content changes. Panel geometry still changes immediately through AppKit, avoiding two competing animation systems. Reduce Motion disables the SwiftUI transition.

## Risks / Trade-offs

- **[Automatic presentation could become noisy]** → Trigger only on new event identity; keep ordinary lifecycle updates collapsed; never auto-present preview snapshots.
- **[A notification could steal typing focus]** → Make the panel key only for explicit user expansion.
- **[A timer could collapse content during interaction]** → Cancel on pointer entry and reschedule only after exit; never time out confirmed attention.
- **[Multiple events arrive together]** → Use stable trusted priority and keep the full sorted session list visible when expanded.
- **[Status initials could be ambiguous]** → Pair initials with state color visually and include full role/provider/state text in accessibility.
- **[GPL-derived architecture could blur provenance]** → Adapt the lifecycle pattern in CodeVetter's existing files and document the reference; do not import Open Island source files, assets, or product strings.

## Migration Plan

The Swift state change is internal and protocol-v1 compatible. Existing snapshots decode unchanged. Agent Island remains off by default, and disabling it or reverting the helper files restores the prior manually expanded behavior without affecting running providers.

## Open Questions

None for this bounded pass. A later real-provider qualification can decide whether completion presentation should remain enabled by default when Agent Island itself is promoted.
