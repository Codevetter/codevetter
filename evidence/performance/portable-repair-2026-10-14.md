# Historical rejected cleanup candidate — 14 October 2026

> **Historical / rejected candidate, not current cleanup qualification.** This
> report describes `38f9e70e7ba17b1c1982fa13c65bbabc4eda4803`. Its POSIX guard
> was withdrawn after a reproduced non-reaping-parent failure left three zombies.
> Owned process-tree cancellation remains **open and unqualified**. Read the
> [final reaping boundary and retained input repair](portable-reaping-boundary-2026-10-14.md)
> for current scope, counterexample, and subsequent input-ownership correction.

Historical candidate successor to [PR #389](https://github.com/Codevetter/codevetter/pull/389), frozen at
`903dfb6b9f7bf76baa9c66c4750017eea0c619ee` (tree
`57fba90e2d83c6862fd61babfb5a088fcd49c4f5`), for
[issue #348](https://github.com/Codevetter/codevetter/issues/348).
The [previous study](portable-qualification-2026-10-14.md) and its raw negative
reports remain historical evidence. This was a source correctness repair candidate, not a
runner acceleration or production warm-reuse qualification. Production merge
and release remain held for independent root review.

## Historical same-contract observations

The [repair report](portable-repair-2026-10-14.json) uses the identical synthetic
harness against the frozen prerequisite and candidate `38f9e70`. It
records runtime/binary and implementation hashes. These original-host results
were superseded as cleanup qualification by the three-zombie counterexample;
they do not describe the final PR implementation. Workload code writes its actual PID before cancellation,
ignores TERM, and never makes network calls. An unrelated running sentinel must
survive. No elapsed-time comparison or acceleration claim is made.

| Historical observation on original host | Frozen #389 | Rejected candidate `38f9e70` |
| --- | --- | --- |
| Already-dirty imported source edit invalidates plan | Missed | Rejected |
| Already-dirty tree config edit invalidates plan | Missed | Rejected |
| Already-dirty tree lock edit invalidates plan | Missed | Rejected |
| Real started workload survives supervisor cancellation | Yes; study cleaned it | No on original host; later probe left zombies |
| Unowned sentinel survives | Yes | Yes |
| Terminal state / failure / result | signaled / signaled / null | Same |

Five candidate regressions on the original host additionally exercised untracked bytes, staged edits,
deletions, executable-mode changes, contained and escaping symlinks, TERM
escalation, IPC owner loss, and inherited-group grandchildren after normal
program exit. The started-body and independent liveness checks prevented a
collection-only or exit-zero pass. One initial explicit-disconnect test waited
for `close` and timed out: this hosted Node transport emits `exit` and ends both
streams but omits `close` after explicit IPC disconnect. That candidate test observed
`exit` and independently observed workload PID absence on that host. This
passing host-specific test did not establish reaping on non-reaping hosts;
the guard and its integration were subsequently removed.

## Candidate source identity boundary (subsequently narrowed)

The candidate `execution-identity.mjs` replaced the constant worktree label with an opaque
SHA-256 over raw bytes, paths, executable bits, symlink identity/contained target
bytes and deletion markers. Git-tracked files and nonignored untracked files
are included even when the tree was already dirty. Invalid UTF-8 filenames,
nonregular inputs, escaping symlinks and oversized inventories fail closed.
The existing closed v1 plan schema is preserved; old constant-identity plans
become stale. No source text or inventory paths enter the plan summary.

The inventory is conservative, not an import-graph cache. Bounds are 10,000
files, 4 MiB inventory and 256 MiB contents. Ignored dependencies/generated
outputs are not authenticated. The candidate excluded **all untracked** files under
`.codevetter/performance-runs/` to avoid heartbeat invalidation; tracked files
there remained inputs. That broad exemption was also defective and was later
replaced by verified current-run output ownership, as described in the final
boundary report linked above. Concurrent filesystem writes
are not an atomic snapshot guarantee. This does not qualify mutable dependency
installs, arbitrary ignored configuration, or general warm reuse.

## Withdrawn process ownership design

The removed `owned-process.mjs` introduced a built-in Node POSIX group guard
shared by the runner and supervisor. It owned a new group, with its program
inheriting that group. Only the live guard signaled its own group. A private
parent IPC channel carried launch environment and terminal status; project
children received no control channel. Parent disappearance, TERM/INT escalation
and normal exit were intended to clean up inherited-group descendants while
preserving program exit/signal/spawn-error metadata. **Group signaling did not
ensure adoption and reaping: the reproduced counterexample left three zombies.**

The candidate used no PID scan, persisted-PID cancellation, shell, new dependency
or unrelated-process sweep. Escalation resided in the live group leader; its
environment was minimal and workload instrumentation remained separate. These
design properties did not make cleanup correct. The guard and runner integration
were withdrawn; the final source retains #389 process-launch/cancellation behavior.
No guard overhead comparison or optimization claim was qualified.

The candidate retained direct-child cancellation on Windows and excluded
application-created detached sessions and external SIGKILL of the guard from
its intended group guarantee. Neither POSIX source compatibility nor passing
host-specific Node tests qualified native applications or cross-platform cleanup.
The final boundary report records the remaining OS lifecycle/reaping requirement.

## Historical pinned consumer and verification

The [candidate Reader report](vitest-consumer-repair-2026-10-14.json) reran the existing
frozen public consumer and synthetic controls without editing its checkout.
Its source remains `4c45b25f2c0320d7d25901940973dcb9cbe40dde`; exact lock, tool,
compiler/transform, environment, selection and assertion identities are in the
report. All 29 rows are retained, with 12 qualified selections. All six
clean/already-dirty source/config/lock controls rejected stale plans. The
18-test default runner oracle and failure/selection/reset/cancellation negative
controls are retained. The prior reports are not rewritten.

Historical observations are pinned to candidate
`38f9e70e7ba17b1c1982fa13c65bbabc4eda4803` and the frozen consumer setup in the
previous study. **Do not run the candidate's guard-exercising experiments or
tests directly on a non-reaping host:** they can leave orphaned zombies.
The retained [Linux subreaper counterexample procedure](portable-reaping-boundary-2026-10-14.md#reproduced-review-finding)
documents the exact validated experiment only. Its fixed-delay probe is not a
general cleanup wrapper and does not guarantee reaping if descendants remain
live after its wait. Any rerun of the rejected candidate requires a verified
reaping host; this report authorizes no unwrapped non-reaping-host recipe.
Do not restore the candidate guard into the final branch.

Candidate CI included the synthetic repair tests; consumer replay was not
a live Vitest run. Its portable checks retained the prerequisite's two excluded
Go cases (Go unavailable / portable enforcement unavailable), without relaxing
admission. Source qualification, instrumentation, failure metadata, privacy and
supervisor regressions remain required. The installed CLI is still unavailable;
the testing skill's recorded `blocked/setup_blocked` assessment remains valid.
These historical repository Node test reports establish neither current cleanup
success nor installed-CLI, native-app, production, or agent benefit. No matched
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
