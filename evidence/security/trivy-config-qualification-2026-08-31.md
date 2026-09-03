# Trivy configuration-scan qualification — 2026-08-31

## Scope

This trial asks whether Trivy's embedded misconfiguration checks add a useful
repository lane without downloading databases or overlapping the offline OSV
scanner. It does not qualify Trivy vulnerability scanning or product bundling.

## Tool and safety flags

- Tool: Trivy 0.74.0
- License: Apache-2.0
- Command lane: `trivy config`
- Explicit controls: `--disable-telemetry`, `--skip-version-check`, and
  `--skip-check-update`

Debug output confirmed that the notification/version request was skipped, no
downloadable checks were loaded, and 563 embedded checks were used. This is
command-level evidence, not packet-capture proof of zero outbound traffic.

## Results

The unbounded repository scan found only a Dockerfile inside
`docs-site/node_modules/yaml-language-server` and reported two findings against
that dependency-owned file. After excluding dependency, build, target, and
artifact directories, Trivy detected one file:

`apps/desktop/tests/fixtures/warm-verification/differential-runtime-qualification-current.json`

It classified that product test fixture as CloudFormation, reported 24 passing
checks and zero failures, and found no first-party Dockerfile, Terraform,
Kubernetes, Helm, Ansible, Azure ARM, or CloudFormation surface to protect.

The SARIF 2.1.0 envelope itself is structurally complete. In JSON debug output,
Trivy also includes repository URL, branch, commit, author, and committer
metadata, which is acceptable for this public-repository trial but must be
considered before any private-code product use.

## Decision

Trialled, not wired. A permanent lane would currently scan dependency-owned
files or misclassify a qualification fixture while protecting no supported
first-party infrastructure configuration. Re-evaluate when the repository adds
a real supported IaC or container surface. Keep all three network-suppression
flags mandatory in any future trial.
