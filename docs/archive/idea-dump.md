# Idea Dump

Moved from `reference/saas-ideas/code-reviewer.md` on 2026-04-05.

This note stays here because the idea is no longer a fresh standalone concept. It is effectively part of the `CodeVetter` product direction.

## Core Direction

Will start off a simple code reviewer. The end state should be a software quality workbench for agent-written code:

- code review
- bug finding
- agent-written code verification
- debugging/replay
- synthetic user QA for software quality
- AI step-through debugger
- synthetic user QA tester
- codebase history explainer

The important constraint: do not drift into generic "code intelligence" unless it is attached to a concrete verification loop. CodeVetter does not need to beat Claude/Codex at raw model intelligence. It needs to make agent-written changes trustworthy by combining static review, repo history, agent-session replay, runtime checks, and fix revalidation.

## Gap Map

### 1. Code review

Current:
- Review tab can review a local git diff with CLI agents.
- Findings are persisted, displayed with surrounding code, and can be sent back to an agent for fixes.
- Re-review exists after a fix.

Gaps:
- Review is still mostly one-shot static diff review.
- Standards/rubrics are concatenated into one prompt instead of running as specialist passes.
- Target-repo `AGENTS.md`, repo brief, prior decisions, and blast radius are not yet a single reliable review context package.
- No published catch-rate benchmark proves it catches bugs that normal AI review misses.

Next useful shape:
- Risk-tiered review: quick pass for small diffs, specialist passes for larger/security-sensitive diffs.
- Include target `AGENTS.md`, Repo Unpacked summary, prior-decision snippets, and changed-file blast radius in the prompt.
- Build a small benchmark set of real agent PRs with known bugs.

### 2. Bug finding

Current:
- CodeVetter can surface suspicious code and rank findings.
- Existing UI supports fix selection, diff viewing, and re-review.

Gaps:
- Bug evidence is mostly inferred from code, not reproduced from behavior.
- No automatic test selection, browser task execution, log inspection, or screenshot trace.
- Findings do not yet distinguish "LLM suspicion" from "reproduced failure."

Next useful shape:
- Attach evidence level to each finding: static suspicion, test failure, browser reproduction, log/runtime trace.
- Run the smallest relevant command/check for a touched repo when possible.
- Promote reproduced bugs above style or speculative concerns.

### 3. Agent-written code verification

Current:
- Product positioning is agent-output review.
- History can index Claude/Codex sessions separately from review records.

Gaps:
- A review does not know which agent session produced the diff.
- Prompt/task intent is not attached to the review, so "did it satisfy the request?" is mostly missing.
- Agent behavior patterns are not scored: over-editing, silent scope drift, skipped tests, fake-green summaries, or deleting user work.

Next useful shape:
- Link review runs to the producing agent session when cwd/branch/time overlap.
- Add an "agent verification" section: requested goal, files touched, commands claimed, commands actually observed, unverified claims.
- Flag classic agent failure modes separately from normal code issues.

### 4. Debugging and replay

Current:
- History indexes local Claude/Codex transcripts and supports conversation replay.

Gaps:
- Replay is not connected to changed files, review findings, test output, screenshots, or app state.
- It is conversation replay, not debugging replay.
- Gemini/local browser/tool traces are incomplete or absent.

Next useful shape:
- Build a run timeline: prompt -> tool/command -> file edit -> test/browser result -> review finding -> fix -> re-check.
- Let a user click from a finding back to the agent step that introduced it.
- Preserve enough evidence to explain what happened without rereading the entire transcript.

### 5. Synthetic user QA

Current:
- Not implemented as a product workflow.
- Playwright exists for CodeVetter's own tests, but not as a user-facing QA runner for target apps.

Gaps:
- No way to define a user task like "create item, edit item, delete item" and have CodeVetter exercise it.
- No screenshot/video/trace artifacts attached to findings.
- No route for visual or interaction failures to become review findings.

Next useful shape:
- Add a "QA run" primitive: target URL/app command, user goal, steps attempted, screenshots, console/network errors, pass/fail.
- Start with browser apps because Playwright gives high evidence density.
- Convert failures into review findings tied to files when possible.

### 6. AI step-through debugger

Current:
- Not implemented.

Gaps:
- No execution timeline spanning code changes, agent actions, commands, tests, browser events, and review decisions.
- No ability to step through "why this bug exists" from symptom to commit/file/agent action.

Next useful shape:
- Timeline-first UI for one verification run.
- Each step should have input, action, output, evidence, and linked file/finding.
- The AI explains the next debugging step from the evidence already collected, not from chat alone.

### 7. Codebase history explainer

Current:
- Repo Unpacked creates a cited system brief and agent handoff.
- History explains agent sessions.
- Project log already notes Decision Intelligence / prior-intent review.

Gaps:
- Commit history, ADRs, inline `WHY:` markers, and prior review memory are not automatically attached to changed files.
- Repo Unpacked is a separate brief, not yet part of every review.
- No "why is this code shaped this way?" answer grounded in commits and decisions.

Next useful shape:
- For every touched file, mine recent commits and decision markers.
- Show "prior decisions touching this change" beside the diff.
- Feed this into review so CodeVetter catches intent regressions, not only local bugs.

In future will expand to:
- Code View Generator (something like deepwiki), index and understand incremental changes
- Documentor (document everything) in slack, linear etc. Auto capture knowledge base
- connect with Analytics to answer questions there regarding what could lead to what
- analyse application logs to find bugs, happenings. Also has understanding of new releases.
- have conversation with app owners regaridng new features and their impacts. AI will also ask questions to fill all the gaps it needs to fill
- figure out issues -> commits -> tickets/owners

## Core Components

- code index and understanding - something like cursor/claude-code. How they understand the codebase recuresively. Then I need to do this historically and get meaning out of individual commits.
  - can also do changelogs across releases and discover outputs by devs
- logs understanding - first need to create my own logging system, then how to plug it everywhere. then handle the storage and understanding of events/bugs with those logs
- integration of analytic tools, linear and slack. User should be able to understand what ticket moved the needle. Slack answers are remembered.
- saas tester - maybe the thing to test whether an app is useful (able) or not. And possible merger w sass maker.

## Other Bets

- complexity reduction for builders (dev productivity is still weak)
  - next decade is about: build faster, ship safer, operate cheaper
  - observability that ties costs + latency + errors to a specific change and owner
  - automated remediation for common incidents (not dashboards)
  - tooling that makes correctness easier than "move fast break things"

- coordination compression (orgs waste insane time)
  - most "enterprise software" is status meetings in UI form
  - work graphs: decisions, dependencies, ownership, SLAs
  - async alignment tooling that replaces meetings with durable state
  - systems that make "who is doing what and why" obvious

## Cloudflare AI Code Review — integration notes (2026-05-14)

Source: https://blog.cloudflare.com/ai-code-review — Cloudflare's CI-native review system built on OpenCode.

### What they do
- Multi-agent: up to 7 specialists (security, performance, code-quality, docs, release, compliance, AGENTS.md validator) + a coordinator that dedups findings and makes the approve/reject call.
- Plugin architecture (ReviewPlugin: bootstrap → configure → postConfigure) — VCS and AI provider are pluggable, not hardcoded.
- Model tiers: top (Opus 4.7 / GPT-5.4) for coordinator only; standard (Sonnet 4.6 / GPT-5.3 Codex) for sub-reviewers; lightweight (Kimi K2.5) for text-heavy docs review. Routing through AI Gateway, runtime-overridable via Worker + Workers KV (propagates in ~5s).
- Risk tiers by diff size: Trivial ≤10 lines, Lite ≤100, Full >100. Security-sensitive files always force Full.
- Per-file patches written to a `diff_directory` instead of inlined in every prompt — reduces token duplication across concurrent reviewers.
- Filters lockfiles / minified / generated; explicitly preserves DB migrations.
- Findings: structured XML, severity = critical | warning | suggestion.
- Circuit breaker per model family (3 states), failback chains (Opus 4.7 → 4.6). Only retryable errors trigger fallback; auth/context-overflow don't.
- Timeouts: 5 min/task (10 for code quality), 25 min overall.
- AGENTS.md = per-project review customization.
- Prompt injection defense: strip boundary XML tags (`</mr_body>` etc) from user-controlled content.
- Local path: `/fullreview` OpenCode TUI command runs the same agents on a laptop.

### Scale (their numbers, 30d)
- 131k runs across 48k MRs, median 3m39s, avg $1.19/review, 0.6% break-glass override.
- ~120B tokens, **85.7% cache hit rate** — prompt caching is doing heavy lifting.
- 159k findings (1.2/review). Code quality ≈ 50% of findings; security flags 4% as critical.

### Mapping to CodeVetter today
- Today: single CLI agent (claude or gemini) over whole diff in `apps/desktop/src-tauri/src/commands/review.rs:251-520`. 100KB hard truncation. No lockfile filter. No AGENTS.md ingestion. JSON findings with 8 severity levels in UI (`apps/desktop/src/pages/QuickReview.tsx:54-63`).
- StandardsPacks (`apps/desktop/src/lib/review-service.ts:25-56`) are *already* conceptually specialists (Product Safety, Security Boundary, Agent Handoff) — they just get concatenated into one prompt instead of running as parallel agents.
- Provider config exists (free-ai, anthropic, openai, openrouter) but no routing/fallback layer.

### Suggested adoption order
1. **AGENTS.md ingestion** (smallest, foundational). Read root `AGENTS.md` from the *target* repo before the review prompt is built; append as a review-customization block. ~30 lines in `review.rs` before line 251. CodeVetter's own repo already has one — eat-your-own-dogfood test case.
2. **Multi-agent + risk tiers** (core idea, biggest impact). Convert each StandardsPack into a parallel CLI invocation; add a coordinator pass to dedup + score. Tier off diff line count:
   - Trivial (≤10): single quick pass, no coordinator
   - Lite (≤100): 2 specialists, no coordinator
   - Full (>100): all specialists + coordinator
   - Force Full for diffs touching security-sensitive paths (auth, secrets, migrations, IPC bridge).
3. **Diff filtering + per-file diff dir.** Skip lockfiles/minified/generated; preserve migrations. Write per-file patches to a tmp dir; pass paths to each agent instead of inlining the whole diff into every parallel prompt. Only meaningful once (2) is in.
4. **Prompt cache headers** on Anthropic provider (`cache_control: { type: "ephemeral" }` on shared system prompt + repo context). Easy win after multi-agent — shared prefix across specialists is exactly what caching rewards. Cloudflare's 85% hit rate is the upside ceiling.
5. **Severity collapse.** UI currently handles 8 levels (critical/high/medium/warning/low/suggestion/info/nitpick). Collapse to the article's 3 (critical/warning/suggestion). Cleaner triage, less prompt ambiguity.

### Skip for now (desktop-app reasons)
- Circuit-breaker model fallback — single-user, sequential; one-shot retry is enough.
- Workers KV runtime model routing — overkill without a fleet of reviewers.
- 25-min overall timeout / 5-min per-task — current UX is interactive, user is watching; just keep the existing timeout.

### Tradeoff to flag before implementing
- Multi-agent multiplies per-review API cost (1 call → 3–5 calls). Risk tiers mitigate this for small diffs; prompt caching mitigates the shared context. A Full review on a large diff goes from ~$X to ~3–4×$X. Worth it if finding quality jumps; worth measuring on a few real PRs before defaulting.
- Cloudflare's $1.19/review is at their volume + cache hit rate. CodeVetter starts cold-cache; first reviews will be more expensive per-token until cache warms.

### Open questions
- Do we want the coordinator agent to also *write* the unified fix (the existing "Fix" workflow), or stay pure-review? Article doesn't address fix synthesis.
- Where does `RepoUnpacked` fit? Could feed the coordinator as a system-brief instead of re-deriving repo context per review.
- For the local CLI agent flow (claude/gemini CLIs) vs API providers — parallel CLI spawning works fine but loses prompt caching benefits. Caching only pays off on the API path.
