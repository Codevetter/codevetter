# Native runtime gate audit — 2026-09-01

This audit closes the measurement task for the native migration without
claiming that a historical foreground run was repeated after every source
change. The recorded Release runtime qualification remains the authority for
launch, memory, cancellation, crash recovery, progress throughput, and large
receipt rendering. The Rust/Swift bridge was remeasured against the current
working tree because that boundary changed materially.

## Explicit gates

| Gate | Limit | Observed | Result |
| --- | ---: | ---: | --- |
| Responsive Release launch average | 1.0 s | 0.58 s | Pass |
| Settled native Performance-workspace RSS | 204,800 KiB | 117,424 KiB | Pass |
| FFI transfer and decode p95 | 250 us | 170.583 us | Pass |
| Supervised worker round trip p95 | 150,000 us | 80,312.500 us | Pass |
| 1,000 progress events | 2,000 ms | 342.278 ms | Pass |
| Cancellation acknowledgement | 500 ms | 0.326 ms | Pass |
| Fresh worker after crash | 1,000 ms | 3.739 ms | Pass |
| Large receipt render p95 | 150,000 us | 30,561–77,597 us | Pass |

The matched Release comparison also classified startup as parity with the
Tauri application, measured 30.529% lower settled RSS, and measured a 51.486%
smaller qualified bundle at the time of that comparison.

## Current-tree refresh

`pnpm bench:native-bridge` rebuilt the Rust probe, Release worker CLI, and
Release Swift benchmark through the pinned XcodeBuildMCP 2.7.0 workflow. The
40,047-byte fixture retained semantic parity across the in-process and
supervised-worker boundaries. The exact receipt is
`evidence/performance/native-bridge-benchmark.json`.

The benchmark and background native-check runner now use persistent,
gitignored npm caches under `artifacts/native-bridge/` and
`artifacts/native-checks/`. This avoids depending on or repeatedly repopulating
the user's shared `npx` cache while preserving the pinned tool version.

The current background-safe regression evidence is 80 Swift package tests,
1,105 executed Rust tests with 31 intentional ignores, a successful macOS Debug
build, and a successful Release host build. The Swift package lane now
explicitly uses XcodeBuildMCP's
`--parallel false`: AppKit render and supervised-process latency gates measure
one shared Mac, so concurrent test workers were competing for the exact
resources being measured and could manufacture threshold failures. In the
serialized full gate, 1,000 progress events completed in 67.939 ms and the five
large-surface conservative render p95 values range from 30.561 ms to 55.588 ms.
The current 100-row Performance surface was repeated three times and uses its
46.009 ms worst run-level p95 rather than the 41.867 ms median. No
foreground XCUITest or matched-app launch was run during this refresh because
those workflows activate application windows and would interrupt the
operator's desktop.

## Release boundary

All explicit runtime gates have passing evidence. Before an authorized release,
repeat the foreground matched-app launch/RSS comparison against the exact
signed candidate and record the result separately. That refresh is a release
qualification step, not a reason to disturb an active desktop session now.
The comparator now fails closed unless its invocation includes `--foreground`,
matching the native UI-test runner's explicit desktop-control acknowledgement.
