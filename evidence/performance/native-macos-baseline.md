# Native macOS performance baseline

Date: 2026-08-31
Target: `CodeVetter` Debug, Apple silicon, macOS
Harness: XcodeBuildMCP 2.7.0 and `XCTApplicationLaunchMetric`

## Responsive first frame

`XCTApplicationLaunchMetric(waitUntilResponsive: true)` measured five launches:

| Sample | Seconds |
| --- | ---: |
| 1 | 0.396736 |
| 2 | 0.390666 |
| 3 | 0.392087 |
| 4 | 0.498724 |
| 5 | 0.434117 |

Average: **0.422 seconds**
Relative standard deviation: **9.787%**

The test passed with Xcode's default 10% relative-deviation tolerance. The
metric waits for the first frame to become responsive; it is not a shell-process
startup approximation.

## Idle footprint

Ten seconds after a dark-appearance launch:

- resident memory: **105,952 KiB**;
- Debug application bundle: **3,056 KiB**.

## Claim boundary

These measurements established the initial Debug baseline. They remain useful
as historical XCTest responsive-frame evidence but do not carry the later
Release comparison claim by themselves.

The historical same-machine Release launch and settled-memory evidence lives in
`evidence/performance/native-tauri-comparison.json`. Five alternating,
surface-confirmed runs classify first-visible-window startup as parity and
measure 117,424 KiB native versus 169,024 KiB Tauri median settled
Performance-workspace process-tree RSS, a 30.5% native reduction. Those runtime
claims remain bound to that receipt's qualified build.

The read-only current-tree package measurement lives in
`evidence/performance/native-current-package-footprint.json`. The exact
`qualification-5r7JG4` native candidate is 62.4% smaller as an app bundle and
92.4% smaller as a host executable than the retained Tauri Release bundle. It
does not refresh launch, RSS, workload, energy, scrolling, or long-session
claims.
