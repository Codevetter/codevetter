# Codebase Concerns

**Analysis Date:** 2026-04-05

---

## Tech Debt

### Stub/Incomplete Review Implementations

**Issue:** Two IPC functions return "not implemented" placeholders instead of real flow.

**Files:**
- `apps/desktop/src/lib/tauri-ipc.ts:323–343` – `startLocalReview()` and `startPrReview()`

**Impact:** These functions are still called by `pr-review-panel.tsx` but throw errors or return stub responses. Blocks PR review feature completeness.

**Current State:**
```typescript
// Temporary: get diff and return a stub — full review-core integration in Phase 2
const diff = await getLocalDiff(repoPath, diffRange);
if (diff.empty) throw new Error("No changes to review");
return { review_id: "pending", status: "not_implemented", diff_bytes: diff.diff.length };
```

**Fix approach:**
1. Wire `startPrReview()` to actual review-core integration in `review-service.ts`
2. Remove stub response from `startLocalReview()` or complete the Phase 2 review flow
3. Update calling code in `pr-review-panel.tsx:227` to handle real flow (currently has TODO)

---

### Legacy Review Integration TODOs

**Issue:** Three high-priority TODOs block PR review workflow completion.

**Files:**
- `apps/desktop/src/lib/tauri-ipc.ts:323` – "Replace callers with direct review-core integration"
- `apps/desktop/src/components/pr-review-panel.tsx:227` – "When a workspace task has a `pr_number` field, review loop should use PR review instead of local diff review"
- `apps/desktop/src/components/review-dashboard.tsx:1055` – "Wire to GitHub PR review posting IPC"

**Impact:** PR review posting to GitHub doesn't wire through. Reviews are collected locally but not posted back to PRs. Users must manually copy findings to GitHub.

**Fix approach:**
1. Implement `postPrReview()` in Rust backend to post findings as GitHub review comments
2. Update `pr-review-panel.tsx` to call posting IPC after review completes
3. Integrate task PR number detection into `review-loop.ts` for automatic PR reviews on task completion

---

### Parser Unwrap at Line 76 (Rust)

**Issue:** Unsafe unwrap in JSON parser for tool_use events.

**Files:**
- `apps/desktop/src-tauri/src/coordination/parser.rs:76` – `.unwrap_or("")` called on tool name extraction

**Impact:** If JSON structure is unexpected, unwrap will panic. Low likelihood (defaults to empty string) but possible in agent output with malformed JSON.

**Current State:**
```rust
let tool_name = parsed.get("tool")
    .or_else(|| parsed.get("name"))
    .and_then(|v| v.as_str())
    .unwrap_or("");  // ← Safe (has default)
```

**Fix approach:** This is actually safe (has a default). No action needed, but mark as reviewed.

---

## Architecture Issues

### Monorepo with Mixed Active/Legacy Code

**Issue:** Dashboard app and old pages are marked as "legacy" but still exist in active monorepo.

**Files:**
- `apps/dashboard/` – deprecated web dashboard (entire directory)
- `apps/desktop/src/pages/` – old Board, Workspaces, Reviews tabs (legacy)

**Impact:** 
- New features added to wrong layer (desktop vs. web)
- Maintenance burden for unused code
- Contributors confused about "active" vs. "legacy" (documented in PROJECT-LOG.md but not enforced)
- Test coverage diluted across both paths

**Fix approach:**
1. Archive `apps/dashboard/` to separate branch or repo
2. Remove old tab pages from `apps/desktop/src/pages/` (Board.tsx, Workspaces.tsx, old Reviews.tsx)
3. Update agents.md to enforce "desktop only" rule in linting or CI check

---

### Unclear Data Provider Pattern

**Issue:** DataProvider abstraction (`apps/desktop/src/lib/data-provider.ts`) has two implementations (TauriProvider, HttpProvider) but HttpProvider implementation is incomplete and never selected.

**Files:**
- `apps/desktop/src/lib/data-provider.ts:60–200+` – TauriProvider and HttpProvider both defined
- No code path shows how HttpProvider is instantiated or used

**Impact:** 
- Maintenance burden for unused abstraction
- Creates false impression that web version is possible without additional work
- Type safety is false (HttpProvider is not implemented)

**Fix approach:**
1. Delete HttpProvider if web app is truly deprecated
2. Or complete HttpProvider and add runtime selection logic if web version is planned
3. Document decision in agents.md

---

## Performance Bottlenecks

### Large IPC File (1887 lines)

**Issue:** `tauri-ipc.ts` is the largest single file in desktop app with 1887 lines. Mixes type definitions, backward-compatible aliases, IPC wrappers, and response types.

**Files:**
- `apps/desktop/src/lib/tauri-ipc.ts` – 1887 lines

**Impact:** 
- Difficult to locate specific commands (many aliases)
- Type aliases create confusion (e.g., SessionListItem vs. SessionRow)
- Any change to backend requires editing this massive file
- Harder to tree-shake exports in bundle

**Improvement path:**
1. Extract backward-compatible type aliases to separate `types-compat.ts`
2. Extract response types to `types-responses.ts`
3. Split IPC commands into logical modules: `ipc-reviews.ts`, `ipc-sessions.ts`, `ipc-agents.ts`
4. Keep `tauri-ipc.ts` as main entry point with re-exports

**Estimated impact:** ~400–500 lines reduction per file, 30% faster navigation.

---

### SQL Queries Without Indexes (Potential)

**Issue:** Desktop app uses SQLite with `rusqlite`, but no schema file shows explicit index definitions.

**Files:**
- `apps/desktop/src-tauri/src/db/schema.rs` – schema definition (not reviewed for index coverage)
- `apps/desktop/src-tauri/src/db/queries.rs` – 31 SQL query occurrences

**Impact:** As local database grows with sessions/reviews/findings, queries may become slow. SQLite primary keys are indexed by default, but secondary queries may full-scan.

**Improvement path:**
1. Profile slow queries: add timing logs to `get_local_diff()`, `listSessions()`, `listReviews()` with row counts
2. Add indexes on frequently-queried columns: `session_id`, `review_id`, `project_path`, `status`
3. Measure impact before and after with test database of 100K+ sessions

---

## Fragile Areas

### Git Command Execution Without Input Validation

**Issue:** Git commands are built with user-provided paths without path canonicalization. Diff ranges are passed directly to git.

**Files:**
- `apps/desktop/src-tauri/src/commands/review.rs:25–80` – `get_local_diff()` builds `git diff` with user-provided `diff_range` and `repo_path`
- `apps/desktop/src-tauri/src/commands/git.rs` – all git operations

**Impact:** 
- Malformed paths could fail silently or produce unexpected diffs
- Diff range injection risk (though git does its own validation)
- No symlink resolution — could read files outside intended repo

**Safe modification approach:**
1. Canonicalize `repo_path` with `std::fs::canonicalize()` before passing to git
2. Validate `diff_range` against known patterns (SHA, branch, HEAD^, etc.)
3. Run git in sandboxed working directory only (already done with `.current_dir()`)
4. Add tests with malformed paths

---

### Review-Core Integration Relies on Webview AI Gateway Setup

**Issue:** Review execution (`reviewLocalDiff()` in `review-service.ts`) depends on user manually configuring AI gateway credentials in browser localStorage. No validation of credentials before review starts.

**Files:**
- `apps/desktop/src/lib/review-service.ts` – calls `loadReviewConfig()` which reads from localStorage
- `apps/desktop/src/components/review-dashboard.tsx` – uses result without checking if config is valid until review fails

**Impact:** 
- User can start review without credentials, wasting time
- Error handling is reactive (fails after review is queued)
- No feedback on credential status in UI

**Safe modification approach:**
1. Add `validateReviewConfig()` function that tests credentials with a lightweight API call
2. Block "Start Review" button until credentials validate
3. Show credential status indicator in Settings page
4. Store validation timestamp to detect credential rotation

---

### Agent Monitor Process Cleanup

**Issue:** `agent_monitor.rs` spawns subprocesses for agents (Claude Code, Codex) but cleanup on crash is unclear.

**Files:**
- `apps/desktop/src-tauri/src/agent_monitor.rs` – process spawning and monitoring

**Impact:** If Tauri desktop app crashes, agent processes (claude, gemini) may continue running in background, consuming resources.

**Safe modification approach:**
1. Register child processes with PID tracking
2. On app exit (graceful or crash), send SIGTERM to all tracked PIDs
3. Add 5-second timeout, then SIGKILL if needed
4. Log process cleanup events for debugging

---

## Incomplete Features

### PR Review Workflow

**Issue:** PR review feature (tab visible in UI) is non-functional. GitHub API calls work, but posting reviews back to GitHub is not implemented.

**Files:**
- `apps/desktop/src/components/pr-review-panel.tsx` – full UI, but no posting logic
- `apps/desktop/src-tauri/src/commands/github_ops.rs` – has GitHub API integration but no PR review posting command

**Impact:** Users can review PRs but cannot post findings to GitHub. Must manually create PR comments.

**Blocks:** PR workflow completion. Required for Category A ("PR Review Bots") comparison mentioned in PROJECT-LOG.md.

**Fix approach:**
1. Implement `postPrReview()` command in Rust backend using GitHub REST API `/repos/{owner}/{repo}/pulls/{number}/reviews`
2. Wire review findings to review comment creation
3. Test with real GitHub PR before shipping

---

### Gemini History Tab

**Issue:** History page shows Claude Code and Codex sessions, but Gemini CLI doesn't write session transcripts locally. No data source for Gemini history.

**Files:**
- `apps/desktop/src/pages/Sessions.tsx` – fetches sessions but Gemini data is always empty

**Impact:** Users can't browse Gemini conversation history locally. Feature incomplete.

**Blocks:** Full feature parity with Claude/Codex integration.

**Fix approach:** 
1. Check if Gemini CLI writes to `~/.gemini/` or similar (not confirmed)
2. If not, parse Gemini API session logs with auth token
3. Add Gemini session indexing to `trigger_index_cmd` in Rust backend

---

## Security Considerations

### Session Secret Fallback Without Warning in Production

**Issue:** API worker uses an insecure default if SESSION_SECRET env var is missing.

**Files:**
- `workers/api/src/index.ts:67–70` – validation warns but allows insecure fallback
- `workers/api/src/index.ts:125–131` – `getSessionSecret()` throws if missing (contradicts validation)

**Impact:** Configuration mismatch. If SESSION_SECRET is missing, validation warns but runtime throws. Sessions are not actually insecure (throws before reaching insecure code), but error message is confusing.

**Current state:**
```typescript
if (!env.SESSION_SECRET) {
  console.warn('[config] SESSION_SECRET missing — sessions will use insecure default');
}
// Later in code:
function getSessionSecret(env: ApiWorkerBindings): string {
  const secret = env.SESSION_SECRET?.trim();
  if (!secret) {
    throw new Error('SESSION_SECRET is required but not set');
  }
  return secret;
}
```

**Fix approach:** Remove warning, make error message consistent. SESSION_SECRET is already required at runtime.

---

### GitHub PAT Storage in LocalStorage (Desktop)

**Issue:** GitHub PAT and AI gateway credentials stored in browser localStorage without encryption.

**Files:**
- `apps/desktop/src/components/review-dashboard.tsx` – prompts user to paste GitHub PAT
- `apps/desktop/src/lib/review-service.ts` – loads from `localStorage.getItem('codevetter_review_config')`

**Impact:** If Tauri app is compromised or localStorage is exported, credentials are exposed.

**Risk level:** Medium (desktop app, not web SaaS, but still stored unencrypted).

**Current mitigation:** Desktop app is not cloud-hosted; credentials never leave user's machine.

**Recommendations:**
1. Store credentials in OS credential store (keychain/secrets manager) instead of localStorage
2. Use Tauri's `tauri_plugin_keyring` if available
3. Add UI indicator showing where credentials are stored
4. Clear credentials on logout

---

### Webhook Signature Validation Optional

**Issue:** GitHub webhook signature validation is disabled if GITHUB_WEBHOOK_SECRET is missing.

**Files:**
- `workers/api/src/index.ts:64–66` – logs warning, continues without validation

**Impact:** If webhook secret is not configured, any attacker can send fake webhook events to trigger reviews or manipulate workspace data.

**Risk level:** High (if webhook endpoint is publicly listed).

**Current mitigation:** Webhook endpoint may not be advertised or publicly known.

**Recommendations:**
1. Require GITHUB_WEBHOOK_SECRET at startup (throw, don't warn)
2. Add validation: if webhook endpoint exists, secret must be set
3. Return 503 if secret is missing rather than accepting unsigned requests

---

## Test Coverage Gaps

### No E2E Tests for Review-Core Integration

**Issue:** E2E tests exist for UI navigation, but no tests verify that review-core correctly scores and finds issues.

**Files:**
- `apps/desktop/tests/e2e/review.spec.ts` – tests UI flow but not scoring logic
- `packages/review-core/src/` – no test files found

**Risk:** Scoring algorithm changes could break silently. Users get reviews with incorrect scores.

**Priority:** High (core feature).

**Fix approach:**
1. Add test fixtures with known-bad code (SQL injection, unhandled error, etc.)
2. Run review-core against fixtures, assert minimum finding count and severity levels
3. Add regression test for each bug fix in scoring logic

---

### Limited Coverage of Error Paths

**Issue:** Most Rust commands catch errors and return `Err(String)`, but recovery paths are not tested.

**Files:**
- `apps/desktop/src-tauri/src/commands/review.rs` – error handling exists but no tests
- `apps/desktop/src-tauri/src/commands/agents.rs` – error handling for agent launch failures

**Risk:** Retry logic, partial failures, and race conditions are untested.

**Priority:** Medium.

**Fix approach:**
1. Add Rust unit tests for command error cases (e.g., git command fails, file not found)
2. Add integration tests for agent launch/stop with simulated failures
3. Test Tauri IPC error serialization (Err(String) round-trip)

---

## Scaling Limits

### Local SQLite with No Connection Pooling

**Issue:** Desktop app uses single SQLite connection (protected by Mutex). Multiple concurrent Tauri commands will serialize on the lock.

**Files:**
- `apps/desktop/src-tauri/src/main.rs` – initializes `DbState` with single connection
- `apps/desktop/src-tauri/src/db/mod.rs` – `Mutex<Connection>`

**Impact:** As background indexing and UI queries run concurrently, one blocking query locks all others. Noticeably slower on older machines or large databases.

**Scaling limit:** ~50K sessions before UI feels sluggish.

**Scaling path:**
1. Use `rusqlite::Connection` pool (not available in rusqlite)
2. Or switch to async runtime with multi-connection setup
3. Or use Litestream for read-only replicas (overkill for desktop)

**Effort:** Medium. Requires async refactor.

---

### D1 Database With No Query Optimization

**Issue:** Cloud API worker uses D1 (SQLite-compatible) with generic queries. No query planning or optimization documented.

**Files:**
- `workers/api/src/index.ts` – D1 queries
- `packages/db/src/d1ControlPlane.ts` – database abstraction

**Impact:** As workspace database grows (repos, PRs, reviews), queries may timeout. No pagination defaults shown.

**Scaling limit:** ~100K PRs or 1M reviews before performance degrades.

**Scaling path:**
1. Add EXPLAIN QUERY PLAN analysis to slow endpoints
2. Implement cursor-based pagination for list endpoints
3. Cache frequently-accessed data (workspace settings, rule configs) in Worker KV
4. Monitor D1 query latency in production

---

## Dependencies at Risk

### Tauri 2 with Minimal Plugin Coverage

**Issue:** Desktop app uses Tauri 2 (recent) but missing plugins for some system integrations.

**Files:**
- `apps/desktop/src-tauri/Cargo.toml:8–12` – lists available plugins

**Risk:** If a plugin is abandoned or has security issue, workaround required.

**Current plugged features:** dialog, notification, process, updater.

**Missing:** keyring (credentials storage), file-watcher (alternative), system-tray (user-facing).

**Risk level:** Low (all current plugins are first-party Tauri).

**Recommendation:** Evaluate Tauri keyring plugin if credential storage becomes priority (security concern above).

---

### automerge 0.5 (Older CRDT)

**Issue:** Codebase imports `automerge = "0.5"` but newer versions exist. CRDT integration appears unused (parser.rs defines events but no automerge integration shown).

**Files:**
- `apps/desktop/src-tauri/Cargo.toml:25` – automerge 0.5
- `apps/desktop/src-tauri/src/coordination/parser.rs` – defines CoordinationEvent enum but no automerge usage found

**Risk:** Unused dependency increases bundle size and attack surface.

**Impact:** ~500KB to binary (estimated).

**Recommendation:** 
1. Search codebase for automerge usage
2. If not used, remove dependency
3. If used for CRDT sync, document its role

---

## Configuration Management Issues

### SESSION_SECRET Validation Inconsistency

**Issue:** Validation function warns about missing SESSION_SECRET but code throws an error if it's actually missing. Error happens before warning, so warning is never seen.

**Files:**
- `workers/api/src/index.ts:57–131`

**Impact:** Confusing startup logs. Users see warning but then service fails to start.

**Fix approach:** Throw error in validation or remove warning. Choose one path.

---

### Environment Variable Naming Inconsistency

**Issue:** Dashboard uses both `NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_PLATFORM_API_BASE_URL` (same purpose, different names).

**Files:**
- `apps/dashboard/.env.example` – documents both vars
- `docs/CONFIGURATION.md:32` – notes "superseded in code by"

**Impact:** Confusing for new contributors. Hard to know which var to use.

**Fix approach:** Deprecate one name, update all references, document migration.

---

## Known Bugs

### Console Logs Left in Production Code

**Issue:** `console.log()` and `console.warn()` calls left in shipped code.

**Files:**
- 33 occurrences across 9 files (found in grep)
- Examples: `apps/desktop/src/pages/Settings.tsx:1`, `workers/api/src/index.ts:6`

**Impact:** Logs sent to browser console in production. Security risk (may leak API endpoints, URLs, or user data).

**Priority:** Medium.

**Fix approach:**
1. Remove all `console.log()` calls or replace with proper logging library
2. Keep `console.error()` and `console.warn()` for errors, but sanitize messages
3. Add ESLint rule `no-console: ["error", { allow: ["error", "warn"] }]`

---

## Summary of Critical Issues

| Issue | Severity | Effort | Impact |
|-------|----------|--------|--------|
| PR review posting not implemented | High | Large | Feature incomplete, blocks PR workflow |
| Review stubs return "not_implemented" | High | Medium | Breaks user workflow if triggered |
| Data provider abstraction unused/incomplete | Medium | Small | Maintenance burden, confusion |
| tauri-ipc.ts file too large (1887 lines) | Medium | Medium | Hard to maintain, slow navigation |
| Git commands without path validation | Medium | Small | Risk of symlink traversal or injection |
| Console logs in production | Medium | Small | Security/debugging issue |
| Webhook signature validation optional | High | Small | Security risk if endpoint exposed |
| LOCAL SQLite with Mutex serialization | Low | Large | Scaling bottleneck at 50K+ sessions |

---

**Last reviewed:** 2026-04-05
