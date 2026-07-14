# Graphify v8 parity fixture

Pinned source: `Graphify-Labs/graphify` default `v8` branch at commit
`961b78e57a10e9c5bb98421ff3e45b40be73542b` (verified 2026-07-14).

The small Rust workspace and Swift extension cases below mirror the upstream
MIT-licensed fixtures at `tests/fixtures/{crate_a,crate_b,swift_cross_file}`.
They exercise Graphify's cross-package false-positive guard and cross-file
Swift extension extraction without requiring Graphify or Python at runtime.
