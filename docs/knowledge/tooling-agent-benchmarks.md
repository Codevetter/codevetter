---
title: Agent benchmark corpora
description: Evaluation of public agent/web benchmarks for licensing, deterministic grading, and offline reproducibility.
sidebar:
  order: 13
---

# Agent benchmark corpora

Verified **2026-08-30**. See [tooling-decisions.md](./tooling-decisions.md) for
the cross-category summary.

CodeVetter grades with **executable evidence, not LLM opinion**. That filter
eliminates most of this field immediately: a benchmark whose scorer is a GPT
judge cannot supply ground truth for a product built on determinism. The second
filter is offline reproducibility — benchmarks driving live third-party websites
decay silently as those sites change.

## Adopt

### τ³-bench (tau2-bench) — best licensing and determinism profile

**MIT** for code and data, data shipped in-repo under `data/tau2/domains/`.
1,909★, pushed 2026-08-27, very active.

Grading is **deterministic by default**. `reward_basis` defaults to
`["DB", "COMMUNICATE"]`: the DB evaluator replays the gold actions on a *fresh*
environment to derive a target end state, then compares **by hash** — so any
trajectory producing an equivalent end state passes. `COMMUNICATE` is substring
match. The only LLM-judged evaluator, `NL_ASSERTION`, is marked experimental and
is **off by default**.

- **No websites, no Docker.** Everything is simulated local tool APIs.
- Caveat: the **user simulator is an LLM** via LiteLLM. LiteLLM can point at a
  local model, so this stays compatible with an offline deployment.
- Task counts: airline 50, retail 114, telecom 114 base (2,285 full),
  banking_knowledge 97. Use the `base` split.
- Versioned grading discipline worth imitating: v1.0.1 (July 2026) fixed
  `banking_knowledge` grading, and results below 1.0.1 are **not comparable**
  with those at or above it. A `pre-v1.0.1` tag reproduces old behaviour.

**τ-bench v1 is deprecated by its own authors** — its README directs users to
τ³-bench. Do not adopt v1.

### Terminal-Bench 4.0 (via Harbor) — cleanest deterministic grader

**Apache-2.0** for the harness and all task sets. This is the strongest
execution-backed grader in the survey: each task has `tests/test.sh` +
`tests/test_outputs.py`; `test.sh` runs pytest and writes `1` or `0` to
`/logs/verifier/reward.txt`. Verifiers run in their own container
(`environment_mode = "separate"`). **No LLM judge anywhere.**

The topology changed substantially, and stale knowledge here is likely:

- The repo **moved orgs** — `laude-institute/terminal-bench` now redirects to
  `harbor-framework/terminal-bench-1` (legacy v1).
- **The harness is now Harbor** (`harbor-framework/harbor`, Apache-2.0,
  4,767★, v0.22.0 on 2026-08-22).
- Task sets are **separate Apache-2.0 dataset repos**: terminal-bench-2 (89
  tasks), terminal-bench-2-1 (91), and the continuous `terminal-bench` (68 live
  + 90 archived, v4.0.0 on 2026-08-26). tbench.ai shows **4.0** as the active
  leaderboard.
- `terminal-bench-core` naming is legacy v1. The modern registry is the Harbor
  Hub, addressed as `terminal-bench/terminal-bench@latest`.

**The one real cost: it is not offline as shipped.** The task template sets
`network_mode = "public"`, all 89 TB-2.0 tasks set `allow_internet = true`, and
the verifier itself runs `apt-get update` and curls `astral.sh`. These are
*package-registry* dependencies rather than live websites — far more tractable
than the rejected benchmarks below, but pre-baking images and mirroring
apt/PyPI is real work.

Worth copying: oracle solutions ship with every task, and maintainers recommend
`--agent oracle -k 5` to validate a sandbox before trusting any result.

## Viable with work

- **TheAgentCompany** (MIT, 175 tasks) has the **strongest offline environment**
  of any multi-app benchmark — a whole simulated company running locally
  (GitLab, Plane, ownCloud, RocketChat) with pre-baked data and no third-party
  sites. But its grader is **hybrid**: deterministic checkpoints *plus* LLM
  evaluators, and evaluation requires LiteLLM credentials. Usable only if the
  deterministic checkpoints are isolated. Needs 30+ GB disk.
- **Mind2Web (text)** — code MIT, dataset **CC-BY-4.0**, fully static cached
  HTML traces, deterministic metrics. Genuinely offline. But it grades *action
  prediction on frozen traces*, which is a different kind of evidence than
  runtime behaviour. **Avoid `Multimodal-Mind2Web` — it is OpenRAIL**, a
  use-restricted license, not CC-BY.
- **WebArena-Verified + BrowserGym/MiniWoB** — Apache-2.0, self-hosted Docker
  sites. A deterministic subset exists if `fuzzy_match`/`ua_match` tasks are
  dropped (those call an LLM) and the map site is excluded (it needs a tile and
  routing backend). MiniWoB is the only trivially-offline env in BrowserGym.
  Prefer ServiceNow's cleaned `webarena-verified` over vanilla WebArena.
- **OSWorld** — Apache-2.0 for code *and* data, active, 369 tasks, execution-
  based metrics. Heavy: needs a VM. Use `test_nogdrive.json` (361 tasks) to
  drop the Google-account dependency.

## Reject

| Benchmark | Reason |
|---|---|
| **WebVoyager** | GPT-4V judge; drives real Amazon/Booking/Google Flights. Last commit 2024-03-04. README admits time-sensitive tasks need manual date edits — not reproducible |
| **Mind2Web 2** | Agent-as-a-Judge, requires `OPENAI_API_KEY`, live agentic search |
| **WebCanvas / Mind2Web-Live** | Live web by design; dormant since 2025-02-06, so task validity has almost certainly decayed |
| **WorkArena** | Requires a **live cloud ServiceNow instance**; instance dataset is `gated: manual` with **no license field** on the HF card |
| **VisualWebArena** | MIT and usable, but no push since 2024-11-09 |
| **WindowsAgentArena** | Requires each user to fetch their own Windows 11 Eval ISO (90-day expiry) — cannot be redistributed |

## Licensing landmines

These are the items where a reasonable assumption is wrong:

- 🚨 **Meta OpenApps — CC-BY-NC-4.0.** Commercial use prohibited. Painful,
  because it is exactly the self-hosted offline app suite this product wants.
- 🚨 **TimeWarp — no LICENSE file at all.** All rights reserved by default.
- ⚠️ **Multimodal-Mind2Web is OpenRAIL**, while the text Mind2Web is CC-BY-4.0.
  It does not inherit the permissive terms.
- ⚠️ **WorkArena-Instances** — HF card carries **no license field**.
- ⚠️ **AgentBench** — the repo is Apache-2.0, but three environments recompile
  third-party datasets (WebShop, Mind2Web, ALFWorld) **without restating their
  upstream licenses**. Repo-level Apache-2.0 does not cover the bundled `data/`.
- ℹ️ **BrowserGym and WorkArena report `NOASSERTION` via the GitHub API** —
  this is a false negative caused by the Apache short-form header. Both LICENSE
  files are Apache-2.0. Do not propagate the API's reading.
