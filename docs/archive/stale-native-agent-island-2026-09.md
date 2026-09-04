---
title: Native Agent Island
description: Ownership, protocol, safety, provider integration, and release boundaries for the macOS agent status surface.
sidebar:
  order: 9
---

# Native Agent Island

Agent Island is an optional macOS status surface for CodeVetter-owned Codex and
Claude sessions. It keeps the existing Rust process/session authority and adds
one supervised Swift helper for native windowing, accessibility, and local
speech.

The feature is off by default. Existing Work conversations and macOS
notifications remain the fallback when it is disabled or unavailable.

## Ownership

```text
Codex / Claude process
        │
        ▼
Rust agent_terminal + provider normalizers
        │
        ├── React Work conversation
        │
        └── bounded JSONL snapshot
                    │
                    ▼
          supervised Swift helper
          ├── AppKit NSPanel
          ├── SwiftUI presentation
          └── local system speech
```

Rust owns:

- provider processes and PTYs;
- session, event, and request identity;
- capability and stale-action validation;
- Claude's session-scoped hook bridge;
- focus routing into Work;
- local preferences and privacy-safe action receipts.

Swift owns only presentation. It does not read the repository, SQLite,
provider settings, transcripts, or credentials. It cannot start or stop an
agent.

## Local protocol

Rust launches the helper as a child and communicates over newline-delimited
JSON on the child's standard streams. Messages are versioned, sequenced, and
limited to 64 KiB. Unknown versions, malformed input, missing identities, and
unsupported actions fail closed.

Snapshots contain only bounded presentation state:

- local session and event identifiers;
- provider and project display name;
- optional Work-owned team identity and role label;
- status and short reason;
- event-specific capabilities;
- voice preferences.

Role labels are capped at 80 characters and team identifiers at 128 characters.
Both are whitespace-normalized and stripped of control characters before they
enter the running-session registry. The 64-session maximum snapshot remains
inside the existing 64 KiB protocol envelope. Legacy sessions omit both fields
and render as ordinary unteamed provider sessions.

The helper returns typed intents such as focus, reply, approve, deny, snooze,
and dismiss. Rust revalidates the current pending event before doing anything.
Actions are single-use and a replaced, resolved, or mismatched event is
rejected.

## Provider truth

The UI renders only capabilities supported by the exact event.

Claude lifecycle and permission state comes from an app-owned hook settings
file created for the launched session. A permission decision is available only
while the matching synchronous hook invocation has a private pending marker.
The response file name is derived from a hash of the provider request ID and
the bridge is removed with the session. Timeout returns no fabricated answer,
leaving Claude's normal prompt available.

Confirmed Claude questions may expose reply. Permission-like terminal text and
other ambiguous attention states remain focus-only.

Codex app-server JSON-RPC normalization understands thread, turn, item, request,
approval, question, MCP elicitation, plan, completion, and error identities.
The current Work runner remains PTY-compatible. Full bidirectional app-server
session ownership is a later rollout gate; PTY sessions do not claim inline
Codex approval parity.

## Presentation and speech

The helper uses public AppKit and SwiftUI APIs. It presents a compact,
non-activating true-black status pill below the display's notch/menu-bar safe
boundary. Expansion uses dense borderless session rows rather than a dashboard
card grid: project and Work role lead each row, bounded provider/status/recency
metadata stays secondary, and the short lifecycle reason never includes prompt
or terminal content.

Work can launch one confirmed implementation agent plus read-only specialists
under a shared team identity. Sessions are grouped first by project and then by
team when multiple teams share one checkout; the helper derives neutral
`Team 1` / `Team 2` labels without exposing opaque identifiers or outcome text.
Confirmed questions and permissions receive the strongest inline treatment and
only their Rust-advertised actions render. Completion remains a calm row with
an exact Open action.

The collapsed pill exposes up to three role/provider markers in trusted
attention/recency order and one bounded overflow count. Marker accessibility
retains the full role or provider, project, and lifecycle state without
exposing prompts, output, commands, paths, model responses, outcome text, or
opaque team identifiers.

New confirmed attention, failure, and completion events can present the
expanded island automatically without activating CodeVetter or moving keyboard
focus. User-owned expansion is separate and cannot be replaced by lifecycle
updates. Confirmed attention remains open until its exact event resolves or the
user collapses it. Informational failure and completion presentation collapses
after ten seconds; pointer entry cancels the pending dismissal and pointer exit
starts a fresh bounded delay.

This hierarchy was informed by the public Vibe Island product and by Open
Island's public GPLv3 notification-surface lifecycle. The behavior is adapted
inside CodeVetter's existing supervised helper rather than importing Open
Island source files, independent discovery/runtime architecture, assets,
branding, or product strings.

Needs-help, failure, completion, working, paused, and disconnected states have a
stable priority order. No animation or timer runs merely to keep the panel
alive.

Speech uses installed system voices. Callouts can be muted or enabled
separately for completion, attention, and failure, with provider-specific
voices, volume, quiet hours, and cooldown. Spoken text is constructed from
provider, project display name, and status only. Prompt text, terminal output,
commands, diffs, paths, model responses, and secrets are never part of a
callout.

Focus shows the existing Tauri window and selects the exact Work conversation.
Focusing history does not resume or start the provider.

## Build and release

The helper target lives in `apps/desktop/native/AgentIsland` and has no
third-party production dependency. Build it with:

```bash
cd apps/desktop
pnpm prepare:agent-island
pnpm test:agent-island
```

`prepare-agent-island.mjs` produces the Tauri sidecar name for the active Rust
target. Release mode builds a universal arm64/x86_64 helper. Tauri's
`beforeBuildCommand` prepares the helper once for normal production builds.
Release preparation ad-hoc signs and verifies the universal helper before
Tauri copies it into the app. Universal builds require full Xcode; Command Line
Tools alone lack the x86_64 Swift compatibility libraries and fail before
packaging.

The release workflow verifies that the nested helper exists, contains both
architectures, and has a valid nested code signature. Publication, installed
updater behavior, and rollback remain release gates rather than unit-test
claims.

The host app still declares macOS 10.15, while the Swift package explicitly
declares macOS 12 because its SwiftUI and accessibility APIs require the newer
deployment target. Older hosts continue without Agent Island and use
Work/notifications. A lower helper target must be proved from the produced
binary and supported APIs before the native feature is enabled by default.

## Validation

The smallest relevant checks are:

```bash
cd apps/desktop
pnpm test:agent-island
pnpm exec tsc --noEmit
pnpm lint

cd src-tauri
cargo test native_agent_island --lib
cargo test agent_stream --lib
cargo test claude_hook --lib
```

Coverage includes protocol bounds (including the maximum team-labelled
snapshot), optional metadata sanitization, legacy omission, PTY and Codex
app-server identity, unsupported/stale/consumed actions, privacy fields,
deterministic team grouping and priority, helper crash/disconnect isolation,
Claude hook identity and response shape, Codex app-server fixtures, Claude
stream/hook fixtures, Swift protocol decoding, role-aware accessibility,
automatic event novelty and resolution, manual presentation ownership, preview
suppression, pointer-safe informational collapse, and team-rail ordering.

The local repeated-use harness takes one untallied macOS `ps` observation after
the render burst before recording idle CPU. This prevents the first sampler
observation from treating the tail of the 120-snapshot render workload as
steady idle usage.

The following remain qualification gates before default enablement:

- repeated real-provider use with zero false actions;
- full Codex app-server response dispatch;
- native keyboard and VoiceOver UI automation;
- measured p95 visual latency, idle CPU, and resident memory;
- installed updater and rollback smoke tests.
