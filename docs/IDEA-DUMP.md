# Idea Dump

Moved from `reference/saas-ideas/code-reviewer.md` on 2026-04-05.

This note stays here because the idea is no longer a fresh standalone concept. It is effectively part of the `CodeVetter` product direction.

## Core Direction

Will start off a simple code reviewer. (have already created repo with initial flow)

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
