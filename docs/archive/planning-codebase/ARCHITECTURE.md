# Architecture

**Analysis Date:** 2026-04-05

## Pattern Overview

**Overall:** Multi-layered monorepo with desktop-first focus. Core pattern is **desktop as primary product** (Tauri + React webview) with optional cloud components (Cloudflare Workers) for async processing and web interfaces. Data flows from local files through review engine, results persisted locally or to cloud.

**Key Characteristics:**
- Desktop-first, works offline (no backend required)
- Pure functions in review-core (no I/O side effects)
- Tauri IPC for desktop-webview communication (typed wrapper in `tauri-ipc.ts`)
- Cloudflare Workers for async jobs, GitHub webhooks, multi-workspace coordination
- Shared TypeScript types across all packages (`shared-types`)
- Local SQLite (desktop) or D1/Postgres (cloud) for persistence

## Layers

**Presentation Layer (React):**
- Purpose: UI components and pages, state management, user interactions
- Location: `apps/desktop/src/components/`, `apps/desktop/src/pages/`
- Contains: shadcn/ui wrappers, feature pages (QuickReview, Sessions, Agents, Settings), modals, panels
- Depends on: `tauri-ipc.ts`, `review-service.ts`, hooks
- Used by: Tauri webview entry point (`main.tsx`)

**IPC Bridge Layer (Tauri):**
- Purpose: Type-safe bridge between React webview and Rust backend
- Location: `apps/desktop/src/lib/tauri-ipc.ts`
- Contains: Typed wrappers around `invoke()`, checks for Tauri availability, session/review/file types
- Depends on: `@tauri-apps/api/core`, `@tauri-apps/api/event`
- Used by: All React components, orchestrator, review-service

**Service Layer (TypeScript):**
- Purpose: Business logic, orchestration, state management
- Location: `apps/desktop/src/lib/` (review-service.ts, orchestrator.ts, review-loop.ts, data-provider.ts)
- Contains: Review pipeline, LLM orchestration, review feedback loops, preference persistence
- Depends on: `review-core`, `ai-gateway-client`, `tauri-ipc`, localStorage
- Used by: React components, Tauri commands

**Backend Layer (Rust):**
- Purpose: File I/O, git operations, database access, system integration
- Location: `apps/desktop/src-tauri/src/commands/`
- Contains: File reading/writing, git CLI calls, SQLite queries, Tauri OS integration
- Depends on: `tokio`, `tauri`, `rusqlite`, `git2`
- Used by: IPC bridge (called via `invoke()`)

**Review Engine (Pure Functions):**
- Purpose: Code review logic — scoring, finding parsing, GitHub API calls, semantic analysis
- Location: `packages/review-core/src/`
- Contains: `scoring.ts`, `prompt.ts`, `semantic.ts`, `formatting.ts`, `github.ts`, `language.ts`
- Depends on: `shared-types`, GitHub API (fetch-based)
- Used by: Desktop service layer, Cloudflare Workers

**LLM Client Layer:**
- Purpose: OpenAI-compatible API abstraction
- Location: `packages/ai-gateway-client/src/`
- Contains: Gateway config, stream handling, token counting
- Depends on: `shared-types`
- Used by: Review-service, Workers review handler

**Database Abstraction:**
- Purpose: Unified interface for local (SQLite) and cloud (D1/Postgres) databases
- Location: `packages/db/src/`
- Contains: `controlPlane.ts` (interface), `d1ControlPlane.ts` (D1/Postgres impl), migrations, schema
- Depends on: `shared-types`, `@cloudflare/workers-types`
- Used by: Desktop Tauri commands, Workers API

**Shared Types:**
- Purpose: Contract definitions across all packages
- Location: `packages/shared-types/src/`
- Contains: `review.ts` (ReviewFinding, ReviewRunRecord), `gateway.ts` (LLM configs), `v1.ts` (worker job types)
- Depends on: None (zero-dependency)
- Used by: All other packages

**Cloud API Layer (Workers):**
- Purpose: REST API for auth, workspaces, webhooks; async review/indexing queue
- Location: `workers/api/src/index.ts`, `workers/review/src/index.ts`
- Contains: Hono routes, GitHub App authentication, PR review triggering, queue management
- Depends on: Hono, `shared-types`, `db`, `review-core`, Cloudflare D1
- Used by: GitHub webhooks, web dashboard, desktop for cloud features

## Data Flow

**Desktop Quick Review Flow:**

1. User opens directory, selects branch/PR in QuickReview (`pages/QuickReview.tsx`)
2. React calls Tauri IPC `getLocalDiff()` → Rust reads git diff, returns unified diff
3. React calls review-service `reviewLocalDiff()` → review-core parses diff, builds prompt
4. Review-service calls `ai-gateway-client.review()` → streams to LLM (Claude, GPT-4, etc.)
5. Review-core parses response → extracts findings, computes score
6. React calls `saveReview()` IPC → Rust persists to local SQLite
7. UI renders findings, user can "Fix with AI" → trigger agent via Tauri, or manually edit

**Feedback Loop Flow:**

1. Task in Kanban board moves to "Review" column
2. `review-loop.ts` auto-triggers → calls `reviewLocalDiff()` on task repo
3. If score < 80 → builds fix prompt from findings → calls `launchAgent()` IPC
4. Rust launches CLI agent (claude -p / gemini -p) → agent modifies files
5. On agent completion → review-loop re-runs review
6. Loop repeats up to 3 attempts → on pass or max attempts, moves to "Done"

**Cloud Review Flow (Workers):**

1. GitHub webhook hits `workers/api/` → validates signature, enqueues review job
2. `workers/review/` polls queues for review/indexing jobs
3. For review: fetches PR diff via GitHub API → calls review-core → scores findings
4. Posts review comment to PR via GitHub App
5. Updates control-plane database with results
6. For indexing: fetches repo files → chunks with tree-sitter → stores in semantic index

**State Management:**

- Desktop: localStorage for review configs, Rust SQLite for sessions/reviews
- Cloud: D1 database for workspaces, users, PR history
- Shared: `shared-types` defines all record types (SessionRecord, ReviewRunRecord, etc.)

## Key Abstractions

**ReviewFinding:**
- Purpose: Represents a single code issue found by the review engine
- Examples: `packages/shared-types/src/review.ts`
- Pattern: Plain objects with `severity`, `title`, `summary`, `filePath`, `line`, `suggestion`, `fingerprint`

**ControlPlaneDatabase:**
- Purpose: Unified query interface for local/cloud databases
- Examples: `packages/db/src/controlPlane.ts` (interface), `packages/db/src/d1ControlPlane.ts` (impl)
- Pattern: Abstract base with methods like `upsertSession()`, `getWorkspace()`, `listPullRequests()`

**AIGatewayClient:**
- Purpose: LLM API abstraction (Anthropic, OpenAI, OpenRouter compatible)
- Examples: `packages/ai-gateway-client/src/`
- Pattern: Takes config (baseUrl, apiKey, model) → `review()` method streams completion

**Tauri IPC Commands:**
- Purpose: Type-safe Rust↔JS bridge
- Examples: `apps/desktop/src-tauri/src/commands/` modules (review.rs, files.rs, git.rs, etc.)
- Pattern: Each Rust command returns typed result; JS wrapper in `tauri-ipc.ts` provides `async` functions

**ReviewRunRecord / SessionRecord:**
- Purpose: Persistent data contracts
- Examples: `packages/shared-types/src/review.ts`, `packages/shared-types/src/v1.ts`
- Pattern: Flat JSON objects with ID, timestamps, foreign keys to users/workspaces/repos

## Entry Points

**Desktop Webview:**
- Location: `apps/desktop/src/main.tsx`
- Triggers: Tauri window creation
- Responsibilities: Wraps App in ErrorBoundary, React Router, StrictMode; initializes error handling

**App Component:**
- Location: `apps/desktop/src/App.tsx`
- Triggers: Main entry point (called from main.tsx)
- Responsibilities: Routing (home, sessions, agents, settings, quickreview), onboarding check, command palette, update checker

**QuickReview Page:**
- Location: `apps/desktop/src/pages/QuickReview.tsx`
- Triggers: User clicks "Review" tab or `/review` route
- Responsibilities: Directory picker, branch/PR selection, review triggering, findings display, fix workflow

**Cloudflare Worker Entry (API):**
- Location: `workers/api/src/index.ts`
- Triggers: HTTP requests (Hono router)
- Responsibilities: Auth endpoints, workspace CRUD, webhook signature validation, GitHub OAuth

**Cloudflare Worker Entry (Review):**
- Location: `workers/review/src/index.ts`
- Triggers: Scheduled trigger (polling) or queue events
- Responsibilities: Poll D1 queues for jobs, dispatch to handlers, manage retries

**Rust Command Handlers:**
- Location: `apps/desktop/src-tauri/src/commands/` (review.rs, files.rs, sessions.rs, etc.)
- Triggers: IPC `invoke()` calls from React
- Responsibilities: File I/O, git CLI, database queries, system operations

## Error Handling

**Strategy:** Layered error propagation with fallbacks

**Patterns:**
- Frontend: React ErrorBoundary catches render errors; components show error UI with retry button (main.tsx line 7-39, App.tsx line 69-80)
- IPC: `safeInvoke()` catches Tauri errors, throws `TAURI_NOT_AVAILABLE` for non-Tauri contexts; callers check error type
- Review-core: Throws descriptive errors on parse/score failures; callers catch and surface to UI
- Workers: Retries up to 3x with exponential backoff (workers/review/src/index.ts line 35-40); dead-letter handling for failed jobs
- Tauri: Panic hooks logged; commands return `Result<T, String>` for error propagation

## Cross-Cutting Concerns

**Logging:** 
- Frontend: `console.log/error` (no external logger)
- Rust: `println!` macros (no external logger)
- Workers: `console.log/error` with `[context]` prefixes (e.g., `[worker-review] indexing repository=...`)

**Validation:**
- Review-core: Type guards in prompt.ts (`isReviewResponse()`, `coerceFinding()`)
- IPC types: TypeScript interfaces define contracts (SessionRow, ReviewRunRecord, etc.)
- Database: Schema validation via SQL constraints

**Authentication:**
- Desktop: OAuth via Tauri → GitHub OAuth → session cookie stored in Tauri preferences
- API Worker: Session cookie validation, GitHub App JWT for webhook handling
- Review Worker: GitHub App credentials for API calls

---

*Architecture analysis: 2026-04-05*
