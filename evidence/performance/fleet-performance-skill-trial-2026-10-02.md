# Fleet performance skill trial — 2026-10-02

CodeVetter supplied bounded workload measurements and investigation leads.
This trial does not establish agent productivity or an optimization speedup.

Scope: all 43 active/primary public-audience Fleet catalog projects.
One dedicated agent per project; three child agents at a time. Profiling was
serialized. Existing inspected local workloads only; no product edits, installs,
provider execution, foreground automation, production load, or releases.

Recorded invocations: **101**, all assessed. Every captured receipt
was hash-checked; report/ledger identities matched, with no overlapping diagnosis
intervals. Failed attempts without receipts remain metadata, not canonical proof.

| Project outcome | Count |
| --- | ---: |
| diagnosed | 20 |
| blocked | 13 |
| unsupported | 9 |
| failed | 1 |

## What it contributed

Six raw diagnoses were actionable. One Anime List sort recommendation is
disputed: the benchmark uses limit=12, while the suggested full-sort branch
requires limit<=0. The original receipt is retained; no recommendation was adopted.
The source review is static, from dirty source, without runtime branch coverage.

| Lead | Recorded evidence | Product boundary |
| --- | --- | --- |
| LoopTV | Smart Mix CPU candidate; 8,760-video workload 2.631 ms/op. | Actual ranking implementation; no optimized candidate. |
| Web Playables | Simulation tick CPU candidate; 50,000 ticks 210.042 ms/op. | Actual simulation; truncated profiles and high host load limit confidence. |
| Reddit Insights | Topic aggregation CPU candidate; 20,000 texts 5.743 ms/op. | Actual aggregation; high timing variance limits comparisons. |
| Live | Suggestion-library CPU candidate; 50 existing items 9.489 ms/op. | Current UI consumption was not established. |
| CodeVetter | Parser candidate; 800,000 rows 95.612 ms/op. | Benchmark corpus, not primary Rust/macOS product. |

Eight diagnoses required a better workload because measured tests were startup
dominated. Eight returned no confidence, including prerequisite/capture failures
and insufficient repeatable source evidence. Admission blocks, unsupported stacks,
and unavailable prerequisites stay in the denominator; missing values are not zeros.

Agent-reported positive discovery/admission observations are not independent task
wins. No missed-defect rate, developer time saved, or causal real-user impact was
measured. Keep the performance skill selective while fixing the issues below.

## Overhead and evidence identity

Summed supervised CLI time: **232.009 seconds**.
Context collection: **23.768 seconds**.
These totals exclude agent inspection/reasoning, most orchestration, profiling-lock
waits and model cost. They are not total audit elapsed time or a productivity estimate.
The shared development host had high load; dirty checkouts were disclosed.
Process serialization removes our own profiling overlap only.

Audit ID: `864b85c0-1c2d-47d9-a446-fd8f9e919a48`.
Initial catalog SHA-256: `78c47409fa23684f854f7355a1ba6f7f9ad94748ac56522a10b10565aebc2238`.
Recheck catalog SHA-256: `9bb20b185398dff1555cf1348cdeac6be7fb7c3a9ffbf4c7407586d5fb707db9`.
Catalog bytes changed during the audit; selected IDs and repository paths remained
the same 43. The selection predicate and task IDs were frozen in the local manifest.

Installed CLI SHA-256: `8a95b23b5dcab7b1883fc363266aa3d36840d39760066d740ba79bf7cd848771`.
Recorder SHA-256: `ec9abeb916aeb053439df14fa25d968b247f379e913627339aac4f672d06fc12`.
Actual CLI version 1.15.0; Darwin arm64. Source and workload details remain
per-project; a dirty-count observation does not establish immutable source bytes.

## Project dispositions

| Catalog project | Disposition | Canonical diagnosis |
| --- | --- | --- |
| codevetter | diagnosed | actionable |
| posttrainllm | diagnosed | needs_better_workload |
| live | diagnosed | actionable |
| saas-maker | blocked | No diagnosis |
| gitstat | unsupported | No diagnosis |
| email-manager | diagnosed | no_confidence |
| chatgpt-memory-insights | diagnosed | needs_better_workload |
| high-signal | blocked | No diagnosis |
| on-record | diagnosed | needs_better_workload |
| issue-pages | blocked | No diagnosis |
| research-papers | blocked | No diagnosis |
| significanthobbies | blocked | No diagnosis |
| anime-list | diagnosed | actionable |
| looptv | diagnosed | actionable |
| reader | blocked | No diagnosis |
| swe-interview-prep | diagnosed | needs_better_workload |
| calorie | diagnosed | needs_better_workload |
| setline | unsupported | No diagnosis |
| kith | unsupported | No diagnosis |
| rolepatch | diagnosed | no_confidence |
| karte | diagnosed | needs_better_workload |
| starboard | blocked | No diagnosis |
| ai-game | diagnosed | needs_better_workload |
| app-health | diagnosed | needs_better_workload |
| mashup | unsupported | No diagnosis |
| motion | blocked | no_confidence |
| open-historia | failed | no_confidence |
| web-playables | diagnosed | actionable |
| what-it-takes-to-win | diagnosed | no_confidence |
| sarthakagrawal-personal | blocked | No diagnosis |
| reddit-insights | diagnosed | actionable |
| anchor | unsupported | No diagnosis |
| nomad-data-adventure | diagnosed | no_confidence |
| storagedaddy | unsupported | No diagnosis |
| browserdaddy | unsupported | No diagnosis |
| performancedaddy | unsupported | No diagnosis |
| meme-lab | diagnosed | no_confidence |
| nutrition-formula-engine | diagnosed | no_confidence |
| every-song-is-a-website | blocked | No diagnosis |
| contextdaddy | unsupported | No diagnosis |
| mentionpilot | blocked | No diagnosis |
| daddyrad | blocked | No diagnosis |
| human-v2 | blocked | No diagnosis |

## Next improvements

- Distinguish inert fixture URLs/mocked transports from actual egress while preserving zero-egress enforcement.
- Prioritize real performance targets in capped discovery and classify runner types correctly.
- Ground source-pattern recommendations in the executed branch; qualify transformed source positions.
- Check executable prerequisites early and repair incomplete Vitest normalization/capture.
- Reduce redundant startup and collection using the [testing-speed study](testing-speed-study-2026-10-02.md); require measured savings with unchanged proof.
- Run matched tasks with/without CodeVetter before claiming improved agent outcomes.

[Issue #348](https://github.com/Codevetter/codevetter/issues/348) tracks these follow-ups.
Complete local drill-down: `artifacts/performance-public-2026-10-02/report.md`,
`summary.json`, `manifest.json`, `source-reviews.json`, and each project JSON.
Artifacts are local scratch; original invocations/receipts/assessment revisions
remain in the private CodeVetter application-data ledger. The recorder can list
by project task UUID or inspect one invocation/JSON pointer with hash verification.
See [agent evidence operations](../../docs/development/agent-skills.md).

Qualification: full manifest/report/ledger audit passed; docs validation passed.
No commit, push, deployment, dependency installation or native UI change.
