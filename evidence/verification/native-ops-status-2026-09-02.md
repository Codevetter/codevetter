# Native Ops status parity — 2026-09-02

## Verdict

The read-only Ops status slice is transferred. Native Settings and
`codevetter ops` share the Rust-owned `codevetter.ops-status/v1` receipt for
fixed 7, 30, and 90 day windows. It reports only local configuration presence
and bounded aggregate run evidence.

This is not full Ops configuration parity. The receipt never returns
credentials or webhook URLs, writes configuration, refreshes provider billing,
sends a webhook, or grants agent/MCP authority. Those operations remain with
the incumbent owner until a separate secure-native contract is qualified.

## Shared contract

- `billing` contains only Anthropic and OpenAI configured booleans.
- `webhook` contains only a configured boolean and one normalized
  `slack`, `discord`, `generic`, or `unknown` flavor.
- `observability` contains at most eight aggregate task-type rows with
  session counts, success/failure counts, rates, and p50/p95 durations.
- `excluded_sensitive_keys` must be exactly `anthropic_admin_key`,
  `openai_admin_key`, and `notif_webhook_url`.
- An unavailable local database produces false configuration presence and no
  aggregate rows; it cannot manufacture readiness.

## Qualification

- Rust tests inserted sentinel credential and webhook values into an isolated
  SQLite database and proved neither value appeared in serialized output.
- Rust rejects windows outside 7, 30, and 90 days and normalizes undeclared
  webhook flavors to `unknown`.
- An isolated-app-data CLI smoke returned an unavailable-store receipt for a
  fresh directory, exactly the three excluded keys, no aggregate rows, and no
  configured integrations. It did not create or read the operator's database.
- The current `qualification-5r7JG4` package contains that byte-identical
  companion, so the isolated smoke and secret-exclusion proof bind to the same
  executable identity.
- Swift validates schema, requested window, row bounds, non-negative counts,
  0--100 rates, webhook flavor, and the exact sensitive-key exclusion set.
- `pnpm test:native:background` passed 80 Swift package tests with no failures
  or skips in 22.4 seconds; the native Debug app compiled in 2.5 seconds.
- Deterministic 2560x1600 dark and light renders were inspected. Both preserve
  the true-black/warm-light hierarchy, readable aggregates, and explicit
  authority-held-back limitations.

| Render | SHA-256 |
| --- | --- |
| `settings-ops.png` | `309b449bf248c4536c31653a12ce0c38e7be098242d1414982adb0ec450af46c` |
| `settings-ops-light.png` | `cc81a20579d20c6d63d0a5c9e2b5e420f57bd9660591829f0af603e34db110ec` |

No provider process, network listener, webhook, installed application,
foreground automation, release, signing, notarization, or deployment action
was started by this qualification.
