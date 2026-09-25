# Usage refinement — local qualification, 2026-09-15

Tracking: [#290](https://github.com/Codevetter/codevetter/issues/290).
Approved direction: refined A. Owner: “Looks good. Ensure you do not make the UI worse.”
This is bounded Usage side work; no release, installation, commit, or push.

## Visual decision

Preserved the existing application shell, provider cards, branding assets,
typography, true-black/light evidence surfaces, and bronze selections.
History and model mix now share one quiet stacked timeline and ranked breakdown.
Model/Project and Tokens/Cost/Cache reads share the existing window and bucket controls.
No new dependencies. Native Canvas bounds chart work to 180 buckets and five visible
series; Other and Earlier preserve totals, with complete ranked rows available.

Status accents use the existing semantic palette. At 13 percent, Codex is low/red.
Remaining allowance and even-use pace are separate assertions. Stale, saved,
expired, invalid, or unavailable quota is not presented as healthy.

## Evidence

The PNGs in this directory are offscreen NSHostingView fixture renders, not live
account screenshots. “Refreshing” is deliberate: fixture loading guards prevent
the view lifecycle from collecting real provider usage. The synthetic dates,
token counts, projects and costs must not be interpreted as account evidence.

- Whole application: 980×640, 1280×900, 1440×900 points, both appearances.
- Project/cost: 1280×900 points, dark.
- Isolated history component: 390, 768, 1440 points. These do not assert that
  the whole macOS app supports phone-sized windows.
- The 980-point app retains its scrollable history; all controls remain inside
  the card and the primary graph begins in the initial viewport.
- At 390 points, the history breakdown moves below the chart.

Manual native fallback review (Impeccable is not installed):

| Critique dimension | Score / 10 | Evidence |
|---|---:|---|
| Hierarchy | 9 | Allowance remains first; history has one shared control set |
| Continuity | 9 | Existing shell, card materials, fonts and small accents retained |
| Chart clarity | 8 | Neutral series, weekly values, exact tooltips and inspection picker |
| Compact layout | 7 | No overlap; minimum app height requires normal vertical scrolling |

Critique: **33/40**. Manual audit: **17/20** (accounting 4/4, state honesty 4/4,
bounded layout/rendering 4/4, contrast/labels 3/4, interaction qualification 2/4).
No observed P0/P1 defects in these checks. This is a documented manual judgment,
not an Impeccable result or a complete accessibility certification. Secondary
labels retain the platform style; neutral series also have written labels.
No new VoiceOver work was undertaken.

## Verification

- `pnpm test:native:background`: **pass**, 108 Swift tests, all five isolated
  performance gates, native Debug compile; navigator 14 passed / 2 explicit live
  tests skipped. No app launch.
- After final view cleanup, all six focused Usage presentation tests passed again.
- `cargo test --manifest-path crates/codevetter-core/Cargo.toml local_usage --lib`:
  **13 passed**, including optional project reconciliation and atomic overflow rejection.
- `cargo clippy --manifest-path crates/codevetter-core/Cargo.toml --lib -- -D warnings`: pass.
- `node scripts/check-docs.mjs`: pass, 89 Markdown files.
- `git diff --check`: pass.

Usage benchmark: 365 daily periods / 2,500 sessions. Baseline Debug hosted render
p95 24.340 ms; final full-suite Debug p95 32.706 ms; final isolated Release p95
33.362 ms, below the unchanged 50 ms gate. Release projection p95 0.436 ms,
cached projection below the microsecond timer resolution, decode 13.866 ms,
snapshot restore 14.165 ms. This is not end-to-end interaction latency.
Existing hosted-runner variability remains tracked in #288.

## Limits and handoff

Claude project attribution comes from pinned ccusage 20.0.20 daily instances.
Codex and unavailable/inconsistent attribution remain Unattributed. Cost is
reported/estimated USD, not subscription spend. The optional project read has
a five-second bound and cannot invalidate the canonical local ledger.

Foreground clicks, keyboard-to-pixel behavior, and the installed app were not
tested or changed. No current idle-screen authorization was requested or inferred.
Keep issue #290 open for integration/release; the working tree is uncommitted.
