# Reviewed cleanup counterexample and retained invalidation repair

This is the final scope of [PR #390](https://github.com/Codevetter/codevetter/pull/390),
a successor to frozen #389 at `903dfb6b9f7bf76baa9c66c4750017eea0c619ee`.
**Dirty-input invalidation is repaired. Owned process-tree cancellation is not
qualified and remains open.** The default runner and process-launch/cancellation paths remain those of #389.
The supervisor supplies a verified input-identity context only; no unsafe
process-ownership implementation is proposed for adoption.

## Reproduced review finding

The initial candidate `38f9e70e7ba17b1c1982fa13c65bbabc4eda4803`, tree
`0334f6cb89bb32cb8fada34c34464bdfd9fa12a2`, passed its started-child and unrelated
process controls on the original host and GitHub's reaping host. Those results
are retained in [the initial report](portable-repair-2026-10-14.json), not erased
or generalized. [Independent source review](https://github.com/Codevetter/codevetter/pull/390#discussion_r4267336036)
then identified orphaned zombies on non-reaping container hosts.

A zero-egress C **experiment fixture**, compiled with the already-present system
compiler, establishes Linux `PR_SET_CHILD_SUBREAPER` for only its own descendants.
It runs the exact candidate's Node experiment, defers adoption/reaping until the
experiment ends, counts exited adopted children using `waitid(WNOWAIT)`, then
reaps them with `waitpid`. It never scans or signals unrelated processes. This
models a non-reaping parent during the experiment without leaving its zombies
behind. [Exact probe source](fixtures/348-reaper-probe.c) and
[retained raw result/identities](portable-reaping-boundary-2026-10-14.json) are public.

Result: **three adopted zombies**; the candidate's actual started workload PID
still existed after cancellation, while the unrelated sentinel survived and
terminal `signaled` / `SIGTERM` / null-result metadata remained intact. In this
probe, `workload_running_after_cancel: true` means PID presence; the separately
observed zombies are not executing work. PID presence must not be mislabeled
as successful reaping or as continued CPU execution. A separate namespace
attempt (`unshare --pid --fork --mount-proc /bin/true`) failed with
`unshare: unshare failed: Operation not permitted`; the supported subreaper probe
provided the concrete counterexample without requiring namespace privileges.

Reproduce on a Linux host with its existing C compiler and Node, using a detached
checkout of the exact candidate above:

```sh
cc -Wall -Wextra -Werror evidence/performance/fixtures/348-reaper-probe.c -o /tmp/348-reaper-probe
/tmp/348-reaper-probe node /path/to/candidate/scripts/runtime-failure-capsule/portable-repair-experiment.mjs /path/to/candidate
```

The fixture is not a production dependency or a proposed runtime launcher. Its
three reaped zombies are a negative result, not a passing cleanup qualification.

## Exact remaining architecture requirement

Group signaling alone cannot adopt and reap orphaned grandchildren. Killing a
Node group leader together with descendants removes the process that could
collect its direct children; on a non-reaping PID 1 they persist as zombies.
Node's built-in child API can wait for direct children but exposes neither Linux
subreaper adoption nor general `waitpid` for adopted descendants. Replacing
`close` with `exit`, ignoring zombies, or weakening the liveness assertion would
not repair this ownership contract. Host process-name guesses are not proof of
a reliable reaper. The candidate guard is therefore withdrawn, not gated on a
heuristic about PID 1 or described as a portable success.

A complete next slice needs an OS-owned lifecycle bridge that remains alive
outside the terminated group, adopts descendants on Linux, signals only its
owned topology, waits/reaps to completion, and returns bounded cleanup status
with existing failure/privacy metadata. Parent death, timeout, normal exit,
nested workers, PID reuse and non-reaping-host tests must all qualify it.
Windows needs a distinct Job Object ownership path; macOS needs separately
qualified descendant ownership semantics. Existing Rust core declares `libc`,
so Linux syscall support can reuse that dependency, but there is **no existing
subreaper bridge** in the current runner. Introducing a helper protocol,
executable discovery/build/packaging and fail-closed availability semantics
changes the current directly runnable Node contract. That architecture and
packaging change is outside this bounded source slice and the instruction to
preserve the default runner and avoid production configuration/dependency work.
This is not a provider, credential, private-corpus or native-app-access blocker.

## Completed safe slice

The opaque raw input digest implementation remains, with meaningful stale-edit,
untracked/staged/deleted/mode/symlink/privacy regressions. The intermediate
[invalidation report](portable-invalidation-2026-10-14.json) reruns the same
fixture against the final source and retains the original detached-workload
cancellation failure, including explicit study cleanup and unowned protection.
The [intermediate consumer report](vitest-consumer-invalidation-2026-10-14.json) retains
29 Vitest rows / 12 qualified selections, the 18-test default runner, exact
source/lock/compiler/runtime/assertion identities, all negative controls and all
six passing clean/already-dirty invalidation controls. Reader's published
checkout is unchanged. The candidate's earlier consumer report remains intact.

Source review and CI are reported against the final PR head. No production
merge, release, dependency, provider trial, native app/MCP change, generalized
warm reuse, timing or acceleration claim is made. The original negative reports
and the rejected candidate remain available by exact commit and evidence hash.


## Subsequent input-ownership review correction

Review at `bc92f5d505c8ddd3a39aad31494d82bb67cf421e` found that the directory-wide
untracked-output exemption could hide an imported helper or receipt-shaped
configuration. The [same-fixture before/after report](portable-owned-output-2026-10-14.json)
records both changed values actually executing under stale plans before the
correction; the final source rejects both before execution.

Ordinary plans now exempt **no** files under the runs directory. The supervisor
reserves one run directory exclusively before launching its diagnostic. Only
that run's untracked `receipt.json`, `result.json` and their atomic temporary
files are exempt. All tracked files, other runs and non-output helper/config
files remain bound, including helpers inside the current directory. The
private supervisor-to-diagnostic environment context is checked against a
validated receipt's run ID, parent PID and exact child PID before use. It is
not forwarded into the workload's minimal environment. The opaque digest binds
the context as well as the files, so it is not interchangeable across runs.
There is no CLI flag or receipt-schema change. Process ownership/cancellation
behavior remains unchanged and unqualified.

Regressions exercise the reported helper/config execution bypass, tracked
receipts, current-run non-output inputs, unproved context rejection, live
heartbeat compatibility and non-forwarding of the private context to actual
workloads. [Fresh final consumer evidence](vitest-consumer-owned-output-2026-10-14.json)
retains the same 29 rows / 12 qualified selections and all clean/dirty input
controls. Prior raw reports remain immutable, source-pinned observations.
