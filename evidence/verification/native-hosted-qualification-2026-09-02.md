# Native macOS hosted qualification

Date: 2026-09-02

## Verdict

The native Evidence Workbench passed its first complete isolated GitHub-hosted
qualification at source commit
`824a9e8bb92feea0de834e876eec64217c68c254`. [GitHub Actions run
33609288529](https://github.com/Codevetter/codevetter/actions/runs/33609288529)
completed successfully on the repository's arm64 `xcode-27` runner path.

This qualifies an unsigned preview candidate. It does not authorize or prove a
production release, replacement of the installed Tauri app, or owner visual
acceptance.

## Hosted gates

| Gate | Observed result |
| --- | --- |
| Existing product CI | Linux lint, code health, typecheck, unit and automation tests, CLI/MCP sidecars, CLI artifact, Vite desktop build, MCP safety, T-Rex contracts, and browser tests passed |
| Native behavior | 81 Swift tests passed in 26.294 seconds with zero failures |
| Native build | Debug app and coverage-free Release app built successfully |
| Native interaction | 9 XCUITests passed with zero failures in 113.009 seconds |
| Owner packet | 33 offscreen states rendered and passed manifest/gallery validation |
| Package | arm64 `CodeVetter.app` 1.11.0 (11100), ZIP, DMG, and dSYM produced |
| Package inspection | Deep signature, host identity, version, companions, Hardened Runtime, and execution authority passed |
| Readiness | 7 of 16 checks passed; 9 production gates correctly remained blocked |

The hosted interaction suite opened the actual application and checked primary
workspace navigation, command-menu navigation, compact-window navigation,
appearance changes, all Settings destinations, Review-to-Testing handoff,
repository selection, and toolbar actions. It ran only on the isolated hosted
desktop; no local application was opened or installed.

## Large-receipt performance

The fixed decode gate is 25 ms p95 and the fixed native host-render gate is
150 ms p95. The hosted run retained each full canonical receipt while bounding
initially visible rows.

| Surface | Fixture | Decode p95 | Render p95 |
| --- | --- | ---: | ---: |
| Repo Unpack | 100 snapshots, 700 graph nodes, 1,000 tree rows | 12.490 ms | 96.536 ms |
| Usage | 365 daily periods, 100 sessions | 15.467 ms | 105.896 ms |
| Performance | 100 observed evidence rows | 4.711 ms | 121.065 ms |
| Testing | 100 journeys, 100 changed paths | 0.966 ms | 55.087 ms |
| Runs | 100 runs, 100 selected responses | 4.818 ms | 64.132 ms |

These measurements cover receipt decoding and native host rendering on the
hosted runner. They do not measure current-package launch time, window-server
frame pacing, CLI workload time, energy, long-session behavior, or settled RSS.
The retained matched native/Tauri launch and memory comparison therefore
remains historical evidence for its exact earlier packages.

## Package identity

The qualifier staged the preview identifier
`com.codevetter.desktop.native-preview` with the distinct
`CodeVetterNative` host executable. Hardened Runtime was enabled, App Sandbox
was intentionally disabled, and the ad-hoc preview disabled Library Validation
because its components have no shared Developer ID team.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Native host | 5,686,272 | `68d73fd1fd7aa7b4c00166470189d2fe6ceafed1df92f0550512e9f02a0f6fd4` |
| `codevetter` | 43,871,088 | `70893c0220543aa82eac3f052b4d3f2ab8ac031a444c27f8ee818b9754c8974c` |
| `codevetter-mcp` | 7,524,752 | `527118074c3cc166b7cfd1e0d28b78caea2f1fc87d020e2975ad838eb1e0783a` |
| `ccusage` | 3,196,064 | `f6f24d12f17c282b04056801355bb46632913daaf67eb48eed0366259dbd7f11` |
| ZIP | 17,398,740 | `b1af8f4fd4b073f96d1ae095a18be71ac87ee7c0a956cfbad6c4eaa4536cc2ba` |
| DMG | 20,088,260 | `43d0586a9849cc875a26c2f6d424cfc8eea1726bde82e5545b218a1833f30638` |
| dSYM DWARF | 30,282,948 | `432cb1a7ff151ccd5314320d9c1f6c405b32c8794917b71b01b4db2bda30dba6` |

The package receipt itself has SHA-256
`8921e713b12ed2b863ba02d31f266b0bfcbe6ce1d40db9fd2bfd15de1afd62f0`.
CLI help, MCP bounded usage, ccusage 20.0.20, and the bundled runtime capsule all
returned their expected exit semantics.

## Visual evidence boundary

The hosted packet manifest has SHA-256
`bb7c8bdb2a2a034094f17f8e6adc994f34d20b272300a719b3bd403f6ef5cce5`.
All 33 files match that manifest, and a spot check retained the true-black
canvas, restrained amber actions, dense evidence hierarchy, legible selected
Rubrics state, and bounded large-receipt layouts.

The hosted PNG bytes are not identical to the earlier committed local packet;
the packets were rendered by different macOS/Xcode environments. This receipt
does not promote either environment to a cross-host pixel oracle. Owner visual
acceptance remains pending.

## Remaining release gates

The exact hosted readiness receipt has SHA-256
`f48c719f7d0001568a2728a32345305dfa6dc4d5204b87eebc6f31265a0c090c`
and correctly reports `shipping_ready: false`. Production still requires:

- owner-approved production bundle-identifier transfer;
- one Developer ID team for the host and every companion;
- Library Validation in that production-signed app;
- a real HTTPS Sparkle appcast and EdDSA public key;
- archive-bound notarization, stapling, and Gatekeeper acceptance;
- installed upgrade, relaunch, stable-data continuity, and rollback proof;
- exact-package runtime, workload, energy, and long-session comparison where
  still required; and
- owner visual acceptance and the explicit Tauri retirement decision.

The downloaded artifact occupied 140 MiB of ignored workspace storage. The
post-download read-only check reported 124 GiB free. No file was installed,
launched, signed for production, notarized, published, or deployed.
