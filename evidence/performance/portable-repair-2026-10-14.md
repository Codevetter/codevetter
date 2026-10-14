# Portable invalidation and owned cleanup repair — 14 October 2026

Successor to [PR #389](https://github.com/Codevetter/codevetter/pull/389), frozen at
`903dfb6b9f7bf76baa9c66c4750017eea0c619ee` (tree
`57fba90e2d83c6862fd61babfb5a088fcd49c4f5`), for
[issue #348](https://github.com/Codevetter/codevetter/issues/348).
The [previous study](portable-qualification-2026-10-14.md) and its raw negative
reports remain historical evidence. This is a source correctness repair, not a
runner acceleration or production warm-reuse qualification. Production merge
and release remain held for independent root review.

## Same-contract before and after

The [repair report](portable-repair-2026-10-14.json) uses the identical synthetic
harness against the frozen prerequisite and the successor implementation. It
records runtime/binary and implementation hashes; the published PR identifies
the final commit/tree. Workload code writes its actual PID before cancellation,
ignores TERM, and never makes network calls. An unrelated running sentinel must
survive. No elapsed-time comparison or acceleration claim is made.

| Contract | Frozen #389 | Successor |
| --- | --- | --- |
| Already-dirty imported source edit invalidates plan | Missed | Rejected |
| Already-dirty tree config edit invalidates plan | Missed | Rejected |
| Already-dirty tree lock edit invalidates plan | Missed | Rejected |
| Real started workload survives supervisor cancellation | Yes; study cleaned it | No |
| Unowned sentinel survives | Yes | Yes |
| Terminal state / failure / result | signaled / signaled / null | Same |

Five focused regressions additionally exercise untracked bytes, staged edits,
deletions, executable-mode changes, contained and escaping symlinks, TERM
escalation, IPC owner loss, and inherited-group grandchildren after normal
program exit. The started-body and independent liveness checks prevent a
collection-only or exit-zero pass. One initial explicit-disconnect test waited
for `close` and timed out: this hosted Node transport emits `exit` and ends both
streams but omits `close` after explicit IPC disconnect. The test now observes
`exit` and independently verifies that the workload is gone. Production callers
do not explicitly disconnect; they retain their normal `close` receipt path.

## Source identity boundary

`execution-identity.mjs` replaces the constant worktree label with an opaque
SHA-256 over raw bytes, paths, executable bits, symlink identity/contained target
bytes and deletion markers. Git-tracked files and nonignored untracked files
are included even when the tree was already dirty. Invalid UTF-8 filenames,
nonregular inputs, escaping symlinks and oversized inventories fail closed.
The existing closed v1 plan schema is preserved; old constant-identity plans
become stale. No source text or inventory paths enter the plan summary.

The inventory is conservative, not an import-graph cache. Bounds are 10,000
files, 4 MiB inventory and 256 MiB contents. Ignored dependencies/generated
outputs are not authenticated. Only **untracked** owned supervisor files under
`.codevetter/performance-runs/` are excluded so its heartbeat does not invalidate
its own plan; tracked files there remain inputs. Concurrent filesystem writes
are not an atomic snapshot guarantee. This does not qualify mutable dependency
installs, arbitrary ignored configuration, or general warm reuse.

## Process ownership boundary

`owned-process.mjs` adds a small built-in Node POSIX group guard shared by the
runner and supervisor. The guard owns a new group; its program inherits that
group. Only the live guard signals its own group. A private parent IPC channel
carries launch environment and terminal status; project children receive no
control channel. Parent disappearance cleans up nested runner groups. TERM/INT
are forwarded and bounded escalation kills the owned group; normal program
exit also cleans inherited-group descendants. Program exit/signal/spawn-error
metadata remains distinct from the guard's final cleanup signal.

There is no PID scan, persisted-PID cancellation, shell, new dependency or
unrelated-process sweep. Escalation resides in the still-live group leader,
avoiding delayed signals to a recycled group ID. The guard receives only the
minimal path/home/temp environment; original egress/profile/coverage/flow
instrumentation is applied to the workload, not the guard. The default runner
and independent instrumentation passes remain intact. Resource/timing overhead
of the extra guard has not been calibrated; existing measurements must not be
compared across this boundary as an optimization claim.

Windows retains direct-child cancellation; a Job Object implementation is
needed for equivalent tree ownership and is outside this POSIX slice. Arbitrary
application-created detached sessions and an external SIGKILL of the guard are
outside the group guarantee. This is cleanup for owned runner topology, not a
security sandbox against hostile processes. macOS source compatibility is not
local native/runtime qualification. Linux hosted CI is a separate check.

## Pinned consumer and verification

The [new Reader report](vitest-consumer-repair-2026-10-14.json) reruns the existing
frozen public consumer and synthetic controls without editing its checkout.
Its source remains `4c45b25f2c0320d7d25901940973dcb9cbe40dde`; exact lock, tool,
compiler/transform, environment, selection and assertion identities are in the
report. All 29 rows are retained, with 12 qualified selections. All six
clean/already-dirty source/config/lock controls now reject stale plans. The
18-test default runner oracle and failure/selection/reset/cancellation negative
controls are retained. The prior reports are not rewritten.

Reproduce with the pinned, frozen consumer setup documented in the previous
study, then run:

```sh
node scripts/runtime-failure-capsule/portable-repair-experiment.mjs /path/to/frozen-389
node scripts/runtime-failure-capsule/portable-repair-experiment.mjs
node scripts/runtime-failure-capsule/vitest-consumer-experiment.mjs /path/to/reader-348
CODEVETTER_READER_STUDY_ROOT=/path/to/reader-348 node --test scripts/runtime-failure-capsule/vitest-consumer.test.mjs
node --test scripts/runtime-failure-capsule/portable-repair.test.mjs
```

CI includes the real synthetic repair tests; consumer replay is explicitly not
a live Vitest run. Full portable checks retain the prerequisite's two excluded
Go cases (Go unavailable / portable enforcement unavailable), without relaxing
admission. Source qualification, instrumentation, failure metadata, privacy and
supervisor regressions remain required. The installed CLI is still unavailable;
the testing skill's recorded `blocked/setup_blocked` assessment remains valid.
These native Node reports are not installed-CLI benefit evidence. No matched
agent trials, provider work, native app change or production configuration is
part of this successor.

## Review correction — cleanup candidate withdrawn

The implementation/results above describe candidate
`38f9e70e7ba17b1c1982fa13c65bbabc4eda4803`. A subsequently reproduced non-reaping
parent counterexample left three zombies. The guard and its runner integration
were withdrawn; the input-identity repair remains. Read the
[final scope and exact reaper requirement](portable-reaping-boundary-2026-10-14.md).
The raw candidate reports above remain unchanged historical observations and
must not be read as the final source's cleanup qualification.
