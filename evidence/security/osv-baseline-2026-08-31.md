# OSV offline baseline — 2026-08-31

This is a qualified repository-security baseline, not a product verdict and not
an allowlist. It records what OSV-Scanner observed so remediation can be
measured without hiding existing findings.

## Reproduction

- Source revision: `225480e5b6a018014bef1c190ed8ac3914a472e7`
- Scanner: OSV-Scanner `2.5.1`
- Command: `pnpm quality:vulnerabilities`
- Network during scan: disabled
- Warm scan duration: 8.942 seconds
- Machine output: ignored `artifacts/tooling/osv/results.sarif`
- Receipt: ignored `artifacts/tooling/osv/receipt.json`

The command exits `0` when clean, `1` when findings exist, and `2` for an
operational failure. Database refresh is deliberately excluded from the scan.

## Database identity

| Ecosystem | Bytes | SHA-256 |
|---|---:|---|
| crates.io | 3,415,816 | `e276fb0061eefcb63ce5ba63b6888640ccc809dc195a698af7b7dbaaeaa9a02c` |
| Go | 11,481,601 | `49b2410b903ae009b3a89ab9be5245d531d0c176b6809931f2182b5ee6bc1204` |
| npm | 221,667,534 | `d89fbb49609224a0ecdb5cd14d6b874ab105197a5e83543f78450bab406cceb8` |

## Findings

- 35 affected package versions across two lockfiles
- 52 advisory/package matches
- 49 unique primary advisory IDs in OSV JSON
- 48 unique SARIF rules after alias normalization
- SARIF severity by unique rule: 0 critical, 11 high, 18 medium, 2 low,
  17 without a numeric severity
- Root `pnpm-lock.yaml` and the Go module were clean

`docs-site/pnpm-lock.yaml` contains 17 affected package versions and 33
advisory/package matches. They are transitive dependencies of the single direct
docs-site dependency, Blume `1.0.4`. Upgrading Blume is a production/build
dependency change and requires owner approval.

`apps/desktop/src-tauri/Cargo.lock` contains 18 affected package versions and 19
advisory/package matches. Most are unmaintained GTK3 bindings reached through
Tauri's Linux target graph. `event-listener` is reached through the Linux
notification stack. The `unic-*` crates are reached through
`urlpattern -> tauri-utils` and are not classified as Linux-only. These are
reachability notes, not suppressions.

## Gate decision

Do not add a second vulnerability scanner or silently baseline these findings.
First test the Blume update and bounded Cargo lockfile remediation, then repeat
this exact offline scan. CI enforcement should follow remediation so the gate
does not normalize known high-severity results.
