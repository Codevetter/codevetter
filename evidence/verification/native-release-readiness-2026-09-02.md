# Native macOS release-readiness inspection

Date: 2026-09-02

## Result

The current local native package is **blocked for shipping**. The versioned
[JSON receipt](native-release-readiness-2026-09-02.json) passes 7 of 16 checks
and names nine production-only blockers. This is a read-only preflight, not
release authorization.

The following local boundaries pass:

- the exact inspected application is bound to a successful local package
  qualification receipt;
- deep strict code-signature verification;
- `CodeVetterNative` host identity and matching version/build metadata;
- the exact `ccusage`, `codevetter`, and `codevetter-mcp` companions;
- Hardened Runtime; and
- the required non-sandboxed local execution authority.

The package is not shipping-ready because:

1. it retains the preview bundle identifier;
2. it is ad-hoc rather than Developer ID signed;
3. the host and companions have no one shared Developer ID team;
4. the staged preview disables Library Validation;
5. no production HTTPS Sparkle appcast is configured;
6. no canonical 32-byte base64 Sparkle EdDSA public key is configured;
7. Gatekeeper rejects the staged preview;
8. no accepted, stapled, archive-bound notarization proof was supplied; and
9. no production-identity installed upgrade, relaunch, data-preservation, and
   rollback proof was supplied.

## Reproduction

From the repository root:

```bash
pnpm native:release:inspect -- \
  --app artifacts/native-package/qualification-5r7JG4/CodeVetter.app \
  --qualification artifacts/native-package/qualification-5r7JG4/qualification.json \
  --out evidence/verification/native-release-readiness-2026-09-02.json
pnpm test:native-release
```

The inspector requires a `codevetter.native-package-qualification/v1` receipt
whose application path is the exact app under inspection. A future
notarization proof must use `codevetter.native-notarization-proof/v1`, report
`accepted`, report a stapled ticket, and bind to the SHA-256 of one qualified
archive. A future installed-upgrade proof must use
`codevetter.native-installed-upgrade-proof/v1`; bind the production bundle,
current version/build, and one qualified archive SHA-256; and explicitly pass
upgrade, relaunch, and rollback. Its nested
`codevetter.native-data-continuity/v1` projection must identify the incumbent
`com.codevetter.desktop` Application Support root and `codevetter.db`, then
prove a non-empty stable-record fingerprint is unchanged after native relaunch
and after rollback. The projection contains counts and SHA-256 digests, not
user content.

The repository-owned `pnpm native:data-continuity` probe now produces that
nested projection through three fully quiesced, read-only SQLite identity
captures. Its isolated fixture suite proves that new rows are allowed, missing
incumbent rows fail, empty baselines fail, and receipt output excludes message
and preference values. No production database or installed application was
used while qualifying the probe.

The inspector verifies supplied proof structure and binding; the production
workflow must still establish trustworthy provenance for those proof files. It
does not enumerate signing identities, read credentials, sign, notarize,
install, publish, or alter the installed application.

## Boundary

This receipt advances release engineering without exercising release
authority. Owner visual acceptance, production signing/updater inputs, Apple
notarization, installed migration and rollback evidence, and the Tauri
retirement decision remain open.
