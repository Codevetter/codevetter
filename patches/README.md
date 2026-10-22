# Dependency security patches

## HTTP cache security patch

Both the landing workspace and the independent docs root pin
`http-cache-semantics` to 4.3.0 and apply the same pnpm patch.

[GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp)
describes request `max-stale` bypassing response safety policy. The newly
published 4.3.0 still reproduces it: a version bump alone is insufficient.
This patch retains upstream parsing and cache policy, adding a guard before
any cached response is returned. It respects `storable()`, response `no-cache`,
shared `proxy-revalidate`, and the existing shared-cookie opt-in in `maxAge()`.
It also prevents stale-while-revalidate from bypassing these restrictions.

`pnpm test:dependency-security` checks the actual landing consumer, including
serialized policies, explicit public/immutable cookies, private-cache controls,
ordinary fresh/expired responses, the max-stale bound and request identity.
After the docs frozen install, run the same test with
`CODEVETTER_CACHE_CONSUMER=docs-site` to check that independent lockfile root.

Retain this patch until an upstream fix passes these tests without it; then
remove the patch registration from both roots and regenerate both locks.
There is no advisory suppression or audit exception.

## Legacy YAML command-line compatibility

The independent docs root overrides `js-yaml@3.15.2>argparse` to 2.0.1,
removing the vulnerable `sprintf-js` dependency. YAML parsing stays on the
same version. Argparse 2 preserves the old CLI aliases but its deprecated
constructor `version` option produces blank output. The js-yaml patch uses
the explicit version action instead, preserving `--version`.

The docs build runs `yaml-compatibility.test.mjs` against the installed
frontmatter parser and CLI before rendering. Retire this patch and override
when Blume no longer depends on js-yaml 3.
