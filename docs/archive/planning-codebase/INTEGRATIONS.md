# External Integrations

**Analysis Date:** 2026-04-05

## APIs & External Services

**GitHub API:**
- Primary service for code review integrations
  - OAuth: GitHub OAuth for user authentication and workspace management
  - App: GitHub App for webhook-driven review triggering and PR commenting
  - Integration: Fetches repository metadata, file trees, PR diffs, and posts reviews as PR comments
  - SDK/Client: Native `fetch` calls to `https://api.github.com` (or custom GHE via `GITHUB_API_BASE_URL`)
  - Auth vars: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`
  - Files: `workers/api/src/index.ts`, `workers/review/src/github.ts`, `apps/dashboard/app/onboarding/page.tsx`

**AI Gateway (OpenAI-Compatible):**
- External LLM service for AI-powered code review analysis
  - Purpose: Analyzes code diffs and generates review findings (security, performance, style issues)
  - SDK/Client: `@code-reviewer/ai-gateway-client` (custom OpenAI-compatible wrapper)
  - Auth: `AI_GATEWAY_BASE_URL`, `AI_GATEWAY_API_KEY`
  - Model: `AI_GATEWAY_MODEL` (default: `llama-3.3-70b-versatile`)
  - Files: `packages/ai-gateway-client/src/index.ts`, `workers/review/src/handlers.ts`

**Linear (Optional Desktop Integration):**
- Issue tracking integration for desktop application
  - OAuth: Linear OAuth for user authentication
  - Purpose: Issue browsing and linking from desktop app
  - Files: `apps/desktop/src/lib/tauri-ipc.ts` (Linear IPC methods: `start_linear_oauth`, `disconnect_linear`, `check_linear_connection`)
  - Auth var: `CODEVETTER_LINEAR_CLIENT_ID`
  - Note: Optional — desktop app checks connection status; fails gracefully if not configured

## Data Storage

**Databases:**
- **Cloudflare D1** (SQLite)
  - Database: `codevetter` (id: `79f405dc-aefe-495b-883c-1f7623f0f0bf`)
  - Connection: Cloudflare Workers binding `DB` in both `workers/api` and `workers/review`
  - Purpose: Control plane (users, workspaces, members, repos, rules, PR tracking), job queue (indexing and review jobs), and findings storage
  - Client: Custom SQL abstractions in `@code-reviewer/db` package
  - Files: `packages/db/src/controlPlane.ts`, `packages/db/src/d1ControlPlane.ts`

**File Storage:**
- Local filesystem only — no cloud storage integration
- Desktop app: Uses Tauri filesystem plugin for local file access

**Caching:**
- In-memory caching in API worker (`rateLimiterState` map)
- No external cache service (Redis, Memcached)

## Authentication & Identity

**Auth Provider:**
- Primary: GitHub OAuth (user authentication for dashboard)
  - Flow: OAuth redirect to GitHub → callback sets session cookie
  - Implementation: Custom session management with `SESSION_SECRET` signing
  - Files: `workers/api/src/index.ts` (auth endpoints)

**Session Management:**
- Custom: HMAC-signed session tokens stored in cookies
  - Cookie name: `cr_session` (configurable via `SESSION_COOKIE_NAME`)
  - Domain: `.codevetter.com` (configurable via `SESSION_COOKIE_DOMAIN`)
  - TTL: 168 hours (7 days, configurable via `SESSION_TTL_HOURS`)

**Desktop Auth:**
- Linear OAuth (optional)
  - Client ID: `CODEVETTER_LINEAR_CLIENT_ID`
  - Implementation: Tauri IPC bridge to native OAuth handler

## Monitoring & Observability

**Error Tracking:**
- None detected — no Sentry, Rollbar, or similar

**Logs:**
- Cloudflare Workers observability enabled in both workers (`[observability] enabled = true` in `wrangler.toml`)
- Console logging for debugging (no structured logging framework detected)
- Files: Throughout `workers/api/src/index.ts` and `workers/review/src/handlers.ts`

**Metrics:**
- Implicit via Cloudflare Workers observability (request counts, latency, errors)
- SaaS Maker analytics for dashboard (via `@saas-maker/analytics-sdk`)

## CI/CD & Deployment

**Hosting:**
- **API Worker:** Cloudflare Workers (custom domain `api.codevetter.com`)
- **Review Worker:** Cloudflare Workers (cron trigger every minute)
- **Dashboard:** Next.js (deployable to Vercel or Node.js hosting)
- **Landing Page:** Next.js (deployable to Vercel or Node.js hosting)
- **Desktop App:** Tauri binary (cross-platform: macOS, Windows, Linux)

**CI Pipeline:**
- Git hooks via Husky (`prepare` script in root `package.json`)
- Pre-commit linting via lint-staged (TypeScript/TSX files in apps, packages, workers)

**Deployment:**
- Cloudflare Workers: Manual via `wrangler deploy` (no automatic CI detected)
- Next.js apps: Compatible with Vercel auto-deployment
- Desktop: Manual Tauri build + GitHub Releases

## Environment Configuration

**Required env vars:**

**Critical for API Worker:**
- `GITHUB_CLIENT_ID` - GitHub OAuth app ID
- `GITHUB_CLIENT_SECRET` - GitHub OAuth app secret
- `GITHUB_APP_ID` - GitHub App ID (for PR comments)
- `GITHUB_APP_PRIVATE_KEY` - GitHub App private key (PEM format, `\n` escaped)
- `SESSION_SECRET` - HMAC secret for session signing
- `WORKSPACE_SECRET_ENCRYPTION_KEY` - Key for encrypting workspace-level AI gateway secrets

**Critical for Review Worker:**
- `GITHUB_APP_ID` - GitHub App ID (for installation token generation)
- `GITHUB_APP_PRIVATE_KEY` - GitHub App private key
- `AI_GATEWAY_BASE_URL` - AI gateway service base URL
- `AI_GATEWAY_API_KEY` - AI gateway API key

**Optional/Configurable:**
- `APP_BASE_URL` (API) - Frontend base URL for OAuth redirects (default: `https://app.codevetter.com`)
- `API_WORKER_CORS_ORIGIN` (API) - Allowed CORS origin (default: `https://app.codevetter.com`)
- `SESSION_COOKIE_DOMAIN` (API) - Session cookie domain scope (default: `.codevetter.com`)
- `SESSION_TTL_HOURS` (API) - Session lifetime in hours (default: `168`)
- `RATE_LIMIT_WINDOW_MS` (API) - Rate limit window (default: `60000`)
- `RATE_LIMIT_MAX_REQUESTS` (API) - Max requests per window (default: `120`)
- `GITHUB_API_BASE_URL` (both) - GitHub API base (default: `https://api.github.com`, override for GHE)
- `AI_GATEWAY_MODEL` (Review) - AI model identifier (default: `llama-3.3-70b-versatile`)
- `REVIEW_WORKER_MAX_RETRIES` - Max retry attempts for jobs (default: `3`)
- `INDEX_MAX_FILE_BYTES` - Max file size for indexing (default: `10485760` bytes)
- `INDEX_MAX_CHUNK_LINES` - Max lines per semantic chunk (default: `220`)
- `NEXT_PUBLIC_SAASMAKER_API_KEY` - SaaS Maker analytics project ID (dashboard)
- `CODEVETTER_LINEAR_CLIENT_ID` - Linear OAuth client ID (desktop, optional)

**Secrets location:**
- `.env.example` documents required variables without values
- Cloudflare Workers: Use `wrangler secret put <NAME>` to upload (stored in Workers KV)
- Local dev: `.dev.vars` file in each worker (git-ignored)
- Desktop app: Environment variables from system or `.env`

## Webhooks & Callbacks

**Incoming:**
- `POST /v1/webhooks/github` - GitHub App webhook receiver (pull request events)
  - Triggers: `pull_request` opened/synchronize events
  - Handler: `workers/api/src/index.ts` (enqueues review jobs)
- `POST /webhook` - Review worker GitHub webhook receiver (redundant/direct feed)
  - Handler: `workers/review/src/index.ts`
- `GET /health` - Review worker liveness check

**Outgoing:**
- GitHub PR comments: Posted by Review Worker via GitHub API
  - Endpoint: `POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews`
  - Authentication: GitHub App installation token
  - Content: Inline comments with findings, summary review

**Platform Action Endpoint:**
- `POST /v1/actions/reviews/trigger` - Programmatic review triggering
  - Auth: Bearer token (`PLATFORM_ACTION_TOKEN`)
  - Purpose: Trigger reviews outside of webhook flow
  - Handler: `workers/api/src/index.ts`

---

*Integration audit: 2026-04-05*
