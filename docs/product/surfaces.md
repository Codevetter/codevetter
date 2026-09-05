---
title: Surfaces and navigation
description: The six native macOS sections and their shared CLI and MCP contracts.
sidebar:
  order: 2
---

# Surfaces and navigation

The native app uses one persistent macOS split-view shell and six sections.
Every page shares the same header, content width, spacing scale, evidence
language, loading/empty/error treatment, and keyboard-sized click targets.

| Section | Native source | Primary result |
|---|---|---|
| Usage | `PremiumUsageView.swift` | Remaining provider allowance first, then bounded historical usage, then Devin's separate indexed history. Unavailable quota or Devin history is labelled unavailable, never zero. |
| Repo Unpack | `PremiumUnpackView.swift` | Repository brief, inventory, graph/history evidence, and exports. |
| Review | `PremiumWorkbench.swift` | Exact change, independent Claude/Codex review, executable evidence, findings, and handoff receipts. |
| Testing | `PremiumTestingView.swift` plus focused testing views | Preview, changed verification, scenarios, differential runs, warm verification, and opt-in PR watchers. |
| Performance | `PremiumPerformanceView.swift` | Exact local workload, baseline/candidate measurements, limits, cleanup, and optimization verdict. |
| Settings | `PremiumSettingsView.swift` | Accounts, agents, MCP, rubrics, memories, usage roots, updater/about, and other configuration. |

The app source lives in
`apps/macos/CodeVetterPackage/Sources/CodeVetterFeature/`. `ContentView.swift`
owns navigation; `PremiumPageHeader.swift` and `EvidenceStyle.swift` own the
shared page grammar.

## Synchronized interfaces

The native UI uses the bundled `codevetter` executable. Humans and agents can
call the same CLI directly, while `codevetter-mcp` publishes bounded read-only
projections. Rust-owned schema versions and semantics are shared across all
three; the SwiftUI client does not reimplement verdicts.

Typical entry point:

```bash
codevetter check --range main...HEAD \
  --task "Describe the expected behavior" \
  --json
```

Supporting commands cover scope resolution, T-Rex testing, performance,
differential verification, scenario compilation, Repo Unpack, usage,
settings, rubrics, memories, MCP readiness, X-Ray export, and isolated fix
attempts. Run `codevetter --help` for the exact current contract.

MCP remains read-only: it can inspect evidence and prepare bounded review
context, but it cannot start a review, execute tests, approve a fix, alter
settings, or publish anything.

## Devin on the Usage desk

Devin is indexed from its own SQLite session history and is never folded into
the ccusage totals, so it renders as its own panel on the page rather than as a
diagnostic. The panel follows the same 1w/30d/90d/all-time window selection as
the ccusage desk.

`DevinUsageSummary.availability(for:)` separates three states the panel must not
conflate: an unreadable history reads `unavailable`, a readable history with no
sessions in the window reads `empty`, and anything else reads as activity. Stale
counters alongside a failed status still read `unavailable`.

## Usage revalidation

Usage keeps itself current while the section is open. `PremiumUsageView`
starts a poll that lives exactly as long as the visible section, so nothing
collects in the background after you navigate away.

| Surface | Cadence | Why |
|---|---|---|
| Local history (`codevetter usage`) | 60s | Offline `ccusage` scan over agent logs. |
| Provider allowance (`codevetter quota`) | 60s | Spawns supervised `claude` and `codex` sessions that can take twenty seconds and reach the provider. The cadence is measured from the end of the previous collection. |

Polling suspends while the app is not frontmost and revalidates immediately on
reactivation, so a backgrounded window never spawns provider sessions the
operator cannot see. A repeat collection whose `source_fingerprint` matches the
accepted report keeps that report rather than re-rendering identical data. The
header Refresh button always forces both reads.

## Interaction policy

- Review findings are leads until executable evidence supports a verdict.
- Watchers are opt-in and app-lifetime bounded; they do not run while the app
  is closed and each execution session requires consent.
- Destructive cleanup, fix execution, and authority changes are explicit,
  separately confirmed operations.
- Missing usage, provider quota, or runtime data remains visibly unavailable.
- Settings is one coherent destination with subsections, not a collection of
  unrelated top-level pages.

The retired React routes and Tauri WebView are historical implementation
details. Do not restore them as parallel product surfaces.
