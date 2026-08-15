# Qualification

Date: 2026-08-10

## Real local product runs

The closed `plan-flow-campaign` CLI screened seven existing Fleet products with
bounded local samples, one discovered flow per repository, and no product-cloud,
browser, database, or production activity.

| Product | Discovered exact flow | Largest supported cost | Result |
| --- | --- | ---: | --- |
| RolePatch | ATS scoring through 20,000 resume characters | 9.345 ms/op | Actionable; hand off to an optimization campaign |
| Free AI | Model selection across the full 79-model registry | 0.016231 ms/op | Already fast; retain as a guardrail |
| Reddit Insights | Topic summarization across 20,000 texts | 0.386 ms/op | Actionable CPU candidate, but much smaller absolute opportunity |
| Email Manager | Weekly digest across 50,000 local messages | 16.181 ms/op before the next experiment | Repeatable application hotspot; the source experiment reproduced at 7.266 and 7.534 ms/op but is not yet paired-confirmed |
| LoopTV | Smart Mix across 8,760 catalog rows | 4.230 ms/op | Actionable application hotspot |
| Starboard | Project recommendations across 50,000 catalog rows | 48.167 ms/op | Actionable baseline; two subsequent experiments were rejected and reverted |
| Reader | RSS parsing across 200 entries | 8.767 ms/op | Not ranked because independent profiles disagreed on the source candidate |

All runs removed owned profile artifacts. RolePatch repeated
`calculateATSScore` as the application CPU candidate across both profiles.
Free AI exercised the absolute-cost guardrail rather than recommending source
work. Reddit Insights rediscovered the already-optimized single-pass helper and
therefore demonstrates why a later portfolio planner should compare absolute
opportunities across repositories.

## Limitations observed

- These repositories currently expose function-level performance workloads,
  not complete local HTTP request flows, so normalized HTTP/database child-flow
  counts were zero. The planner cannot manufacture representative end-to-end
  workloads safely.
- No project priority manifest was supplied. Frequency and user impact used
  neutral weights and remain explicitly unverified; no production-impact claim
  was made.
- All three repositories were dirty with the current local experiment changes,
  and each result retained that snapshot qualification.
- Qualification candidate output is bounded. RolePatch and Free AI reached the
  configured scan limit, which is preserved as a limitation.
- Ranking is repository-scoped in this version. Comparing RolePatch's 9.345 ms
opportunity with Reddit Insights' 0.386 ms opportunity remains an agent
judgment until a bounded cross-repository planner is earned.
- URL-bearing fixture data initially excluded the safe Starboard and Reader
  workloads. Qualification now requires an actual network-client invocation;
  focused coverage still rejects remote and indirect endpoint calls.
- The Email Manager source experiment preserved focused unit, type, benchmark,
  and golden-fixture correctness. Its apparent reduction is directional until
  the identical workload is captured through the paired promotion lane.
- Email Manager's repository-owned golden-fixture command uses `pnpm dlx`; that
  check fetched three small public npm package artifacts. No paid model,
  production service, or product cloud resource was invoked.

## Outcome

The first slice proves automatic local discovery, safe exclusion, sequential
screening, absolute-cost prioritization, already-fast refusal, and exact
campaign handoff. The next product-learning step is to author one deterministic
loopback request workload in a consumer product and let the same planner capture
its recursive flow evidence.
