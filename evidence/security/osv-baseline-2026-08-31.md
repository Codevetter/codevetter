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

## Approved maintenance follow-up

At exact revision `855202998b56c1658b9decda22298a1b63fb5caf`, after updating
Blume 1.0.4 to 1.5.3 and event-listener 5.4.1 to 5.4.2, the same database set
and offline runner completed in 9.745 seconds with 39 result instances and 36
normalized SARIF rules. This is a reduction from 52 advisory/package matches,
not a clean result and not an allowlist.

The independent docs-site production audit still reports 12 high, 7 moderate,
and 1 low advisory. Current Blume transitively retains those build/documentation
paths, and several have no resolution through the current direct version. The
repository-wide root production audit remains clean because the docs site has
its own lockfile; both facts must stay visible until issue #195 completes
reachability and upstream/remediation review.

## Docs-site transitive remediation — 2026-09-02

The docs-site lockfile now overrides thirteen fixable transitive packages to
patched releases while retaining Blume 1.5.3 as the single direct dependency.
The production audit moved from 18 high, 9 moderate, and 1 low advisory to 2
high advisories, with no critical, moderate, or low advisories remaining.

Both residual advisories affect `image-size` 2.0.2 parsers for ICNS, JXL, and
HEIF. Upstream lists no patched release, and those formats are absent from
`docs/` and `docs-site/`. The package is confined to the repository-controlled
static documentation build; it is not shipped in the desktop runtime. This is
reachability containment, not suppression or a clean-audit claim. The
advisories remain visible until Blume's dependency graph provides a patched
version.

Validation after the lockfile update:

- frozen docs-site install completed successfully;
- the Blume/Astro static build produced all 61 pages;
- `node scripts/check-docs.mjs` validated all 86 Markdown files;
- Biome accepted the docs-site package manifest;
- the repository contains no `.icns`, `.jxl`, `.heif`, or `.heic` docs input.

## Complete four-ecosystem rerun — 2026-09-02

The scanner initially emitted seven Rust findings while also reporting that it
could not load the SwiftURL database. The wrapper previously treated every
exit code `1` as a complete findings run. It now detects extraction/database
errors, marks any emitted artifact incomplete, and exits `2`. The separate
refresh workflow now seeds npm, crates.io, Go, and SwiftURL snapshots.

After seeding SwiftURL and pinning `path-to-regexp` 6.1.0 to 6.3.0, an offline
rerun at revision `57c2363444bc9c2bd2adf959399217e2723ca2d6` completed in
11.588 seconds. Its SARIF digest is
`307dcf556d664716a5f712b4701f69f6fe4621fcffc26dc3ea6722354e1c8dfc`.
It contains 20 result instances across 19 unique primary advisory IDs:

- 2 unpatched `image-size` advisories, contained to repository-controlled docs
  build inputs as described above;
- 11 unmaintained GTK3 advisory IDs (12 result instances because `glib` is
  reached twice), absent from the Apple target graph and retained only by the
  Tauri Linux dependency graph;
- 1 unmaintained `proc-macro-error` advisory in the same GTK3 graph; and
- 5 unmaintained `unic-*` advisories reached through
  `urlpattern -> tauri-utils` on the Tauri Apple build/runtime graph.

These residual unmaintained-package notices have no listed fixed version. They
remain visible and do not become an allowlist. The macOS-native application
does not consume the Tauri/GTK/urlpattern graph, but Tauri remains operational
until the separate owner-approved retirement gate; therefore the five
cross-platform `unic-*` notices remain accepted, tracked migration risk rather
than being suppressed.
