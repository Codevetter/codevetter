# HTTP cache security patch

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
