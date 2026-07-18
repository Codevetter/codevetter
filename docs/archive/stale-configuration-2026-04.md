> **Superseded 2026-07-18** by `docs/development/configuration.md`. This doc described Cloudflare Workers / GitHub OAuth / D1 / dashboard env vars — none of which are in the product. Kept for git history.

<!-- generated-by: gsd-doc-writer -->
# Configuration

This document covers every configurable setting across the CodeVetter monorepo.

---

## Environment Variables

### Root `.env.example` (Cloudflare Workers — shared secrets)

| Variable | Required | Default | Description |
|---|---|---|---|
| `GITHUB_CLIENT_ID` | Yes (OAuth) | — | GitHub OAuth App client ID. Required for user login. |
| `GITHUB_CLIENT_SECRET` | Yes (OAuth) | — | GitHub OAuth App client secret. Required for user login. |
| `GITHUB_WEBHOOK_SECRET` | Yes (webhooks) | — | HMAC secret used to verify incoming GitHub webhook payloads. |
| `SESSION_SECRET` | Yes | — | Secret used to sign session tokens. Throws at invocation if missing. |
| `WORKSPACE_SECRET_ENCRYPTION_KEY` | Yes (prod) | — | AES key for encrypting per-workspace AI gateway credentials at rest. |
| `AI_GATEWAY_BASE_URL` | Yes (reviews) | — | Base URL of the AI inference gateway (e.g. `https://openrouter.ai/api/v1`). Without it, review jobs are skipped. |
| `AI_GATEWAY_API_KEY` | Yes (reviews) | — | API key for the AI inference gateway. Without it, review jobs are skipped. |
| `AI_GATEWAY_MODEL` | No | `llama-3.3-70b-versatile` (wrangler) / `auto` (worker code) | LLM model identifier forwarded to the AI gateway. Must not be empty. |
| `GITHUB_APP_ID` | Yes (review posting) | — | Numeric GitHub App ID used to generate installation tokens for posting PR review comments. |
| `GITHUB_APP_PRIVATE_KEY` | Yes (review posting) | — | PEM private key for the GitHub App (newlines encoded as `\n`). |
| `NEXT_PUBLIC_SAASMAKER_API_KEY` | No | — | SaaS Maker public API key for the feedback widget embedded in the dashboard. |
| `CODEVETTER_LINEAR_CLIENT_ID` | No | — | Linear OAuth client ID for the desktop app's task board integration. |

### `apps/dashboard/.env.example` (Next.js dashboard)

| Variable | Required | Default | Description |
|---|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | No | — | Documented in `.env.example`; superseded in code by `NEXT_PUBLIC_PLATFORM_API_BASE_URL`. |
| `NEXT_PUBLIC_PLATFORM_API_BASE_URL` | No | `http://127.0.0.1:8787` | Public-side URL of the API worker, injected into the Next.js client bundle. Falls back to the local wrangler dev address. |
| `NEXT_PUBLIC_SAASMAKER_API_KEY` | No | — | SaaS Maker public key (also present in root `.env.example`). |

### Additional dashboard variables (not in `.env.example`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `PLATFORM_API_BASE_URL` | No | `http://127.0.0.1:8787` | Server-side URL for Next.js RSC fetches. Takes precedence over `NEXT_PUBLIC_PLATFORM_API_BASE_URL`. |
| `DEV_BYPASS` | No | — | Set to `true` while `NODE_ENV=development` to skip real API calls and return mock data. |

### `workers/api` bindings (Cloudflare Worker — API worker)

All bindings are set via `wrangler secret put` or declared as `[vars]` in `wrangler.toml`.

| Variable | Required | Default | Description |
|---|---|---|---|
| `APP_BASE_URL` | No | `https://app.codevetter.com` | Post-OAuth redirect base URL. <!-- VERIFY: production value matches deployed dashboard URL --> |
| `API_WORKER_CORS_ORIGIN` | No | `https://app.codevetter.com` | `Access-Control-Allow-Origin` value returned by the worker. <!-- VERIFY: production value matches deployed dashboard URL --> |
| `SESSION_COOKIE_NAME` | No | `cr_session` | Name of the session cookie set on authentication. |
| `SESSION_COOKIE_DOMAIN` | No | `.codevetter.com` (wrangler) | Cookie domain; unset in code defaults to browser-scoped. <!-- VERIFY: production cookie domain --> |
| `SESSION_TTL_HOURS` | No | `168` (7 days) | Session expiry in hours. |
| `RATE_LIMIT_WINDOW_MS` | No | `60000` (1 min) | Sliding-window duration for the rate limiter. |
| `RATE_LIMIT_MAX_REQUESTS` | No | `120` | Maximum requests per IP per window. |
| `GITHUB_API_BASE_URL` | No | `https://api.github.com` | GitHub REST API base URL; override for GitHub Enterprise. |
| `GITHUB_OAUTH_REDIRECT_URI` | Yes (OAuth) | — | Full callback URL for the GitHub OAuth flow (e.g. `https://api.codevetter.com/v1/auth/github/callback`). Throws at runtime if missing when OAuth is initiated. |
| `GITHUB_SYNC_TOKEN` | No | — | Fallback GitHub token used by the repository sync endpoint when no installation token is available. |
| `GITHUB_DRIFT_CHECK_TOKEN` | No | — | GitHub token for drift-check operations. Falls back to `GITHUB_APP_INSTALLATION_TOKEN` then `GITHUB_TOKEN`. |
| `PLATFORM_ACTION_TOKEN` | No | — | Bearer token required by internal platform-action endpoints (`/v1/actions/…`). Endpoints return `503` when unset. |
| `DB_USE_IN_MEMORY` | No | `false` | Set to `true` to force the in-memory D1 adapter (useful for local dev without a real database). |

### `workers/review` bindings (Cloudflare Worker — review worker)

| Variable | Required | Default | Description |
|---|---|---|---|
| `REVIEW_WORKER_POLL_MS` | No | `2000` | Job-queue poll interval in milliseconds. Minimum `250`. |
| `REVIEW_WORKER_MAX_ITERATIONS` | No | `10` | Maximum poll cycles before the worker exits (prevents infinite loops). Minimum `1`. |
| `REVIEW_WORKER_MAX_RETRIES` | No | `3` | Per-job retry budget (0–10). |
| `REVIEW_WORKER_RETRY_BASE_MS` | No | `1000` | Base delay for exponential backoff. Minimum `50 ms`. |
| `REVIEW_WORKER_RETRY_MAX_MS` | No | `30000` | Maximum backoff cap. Must be ≥ `REVIEW_WORKER_RETRY_BASE_MS`. |
| `INDEX_MAX_FILE_BYTES` | No | `10485760` (10 MB) | Files larger than this are skipped during indexing. Minimum `1`. |
| `INDEX_CHUNK_STRATEGY` | No | `tree-sitter` | Code-chunking strategy. Only `tree-sitter` is supported in v1. |
| `INDEX_MAX_CHUNK_LINES` | No | `220` | Maximum lines per tree-sitter chunk (20–1000). |
| `CF_REVIEW_QUEUE_NAME` | No | `review-jobs` | Cloudflare Queue name for review jobs. <!-- VERIFY: matches queue name configured in Cloudflare dashboard --> |
| `CF_INDEXING_QUEUE_NAME` | No | `indexing-jobs` | Cloudflare Queue name for indexing jobs. <!-- VERIFY: matches queue name configured in Cloudflare dashboard --> |

---

## Config File Format

### `workers/api/wrangler.toml`

Cloudflare Worker configuration. Non-secret defaults live here; secrets are uploaded separately.

```toml
name = "code-reviewer-api"
main = "src/index.ts"
compatibility_date = "2026-02-22"
compatibility_flags = ["nodejs_compat"]

routes = [
  { pattern = "api.codevetter.com", zone_name = "codevetter.com", custom_domain = true }
]

[vars]
APP_BASE_URL = "https://app.codevetter.com"
API_WORKER_CORS_ORIGIN = "https://app.codevetter.com"
SESSION_COOKIE_DOMAIN = ".codevetter.com"
SESSION_TTL_HOURS = "168"
RATE_LIMIT_WINDOW_MS = "60000"
RATE_LIMIT_MAX_REQUESTS = "120"
DB_USE_IN_MEMORY = "false"

[[d1_databases]]
binding = "DB"
database_name = "codevetter"
database_id = "79f405dc-aefe-495b-883c-1f7623f0f0bf"
```

Upload secrets once with:

```bash
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put GITHUB_WEBHOOK_SECRET
wrangler secret put SESSION_SECRET
wrangler secret put WORKSPACE_SECRET_ENCRYPTION_KEY
wrangler secret put GITHUB_APP_ID
wrangler secret put GITHUB_APP_PRIVATE_KEY
wrangler secret put PLATFORM_ACTION_TOKEN
```

### `workers/review/wrangler.toml`

```toml
name = "code-reviewer-worker"
main = "src/index.ts"
compatibility_date = "2026-02-22"
compatibility_flags = ["nodejs_compat"]

[triggers]
crons = ["* * * * *"]

[vars]
GITHUB_API_BASE_URL = "https://api.github.com"
AI_GATEWAY_MODEL = "llama-3.3-70b-versatile"

[[d1_databases]]
binding = "DB"
database_name = "codevetter"
database_id = "79f405dc-aefe-495b-883c-1f7623f0f0bf"
```

Upload secrets:

```bash
wrangler secret put GITHUB_APP_ID
wrangler secret put GITHUB_APP_PRIVATE_KEY
wrangler secret put AI_GATEWAY_BASE_URL
wrangler secret put AI_GATEWAY_API_KEY
```

### `apps/dashboard/next.config.js`

Minimal Next.js configuration:

```js
const nextConfig = {
  reactStrictMode: true,
  typedRoutes: false,
  transpilePackages: ['@radix-ui/themes'],
};
```

No environment-specific overrides are applied here; env vars are loaded at runtime.

### `apps/desktop/vite.config.ts`

Vite configuration for the Tauri desktop front-end:

```ts
export default defineConfig({
  server: { port: 1420, strictPort: false },
  build:  { outDir: "out" },
});
```

No environment variables are consumed by Vite itself; AI gateway credentials are stored in `localStorage` under the key `codevetter_review_config` at runtime.

### `apps/desktop/src-tauri/tauri.conf.json`

Tauri 2 application manifest. Key fields:

```json
{
  "identifier": "com.codevetter.desktop",
  "build": {
    "devUrl": "http://localhost:1420",
    "frontendDist": "../out"
  },
  "app": {
    "security": {
      "csp": "default-src 'self'; connect-src 'self' https://api.codevetter.com https://api.github.com; ..."
    }
  }
}
```

The CSP hard-codes the production API hostname. For development the devUrl points to the local Vite server.

### Root `tsconfig.json`

Shared TypeScript baseline (`target: es2020`, `strict: true`). Each workspace extends or defines its own `tsconfig.json`; the root one covers `packages/` only and excludes `apps/` and `workers/`.

### Root `eslint.config.js`

Flat ESLint config applied to all `*.ts` / `*.tsx` files via `lint-staged` on pre-commit. No environment-specific overrides.

---

## Required vs Optional Settings

### Settings that cause startup failure if absent

| Setting | Worker / App | Failure mode |
|---|---|---|
| `API_WORKER_PORT` invalid integer | `workers/api` (local dev) | `loadApiWorkerConfig()` throws `Invalid API_WORKER_PORT` |
| `REVIEW_WORKER_POLL_MS` < 250 | `workers/review` (local dev) | `loadReviewWorkerConfig()` throws |
| `REVIEW_WORKER_MAX_ITERATIONS` < 1 | `workers/review` (local dev) | Throws |
| `REVIEW_WORKER_MAX_RETRIES` outside 0–10 | `workers/review` (local dev) | Throws |
| `REVIEW_WORKER_RETRY_BASE_MS` < 50 | `workers/review` (local dev) | Throws |
| `REVIEW_WORKER_RETRY_MAX_MS` < base delay | `workers/review` (local dev) | Throws |
| `INDEX_MAX_FILE_BYTES` < 1 | `workers/review` (local dev) | Throws |
| `INDEX_CHUNK_STRATEGY` != `tree-sitter` | `workers/review` (local dev) | Throws |
| `INDEX_MAX_CHUNK_LINES` outside 20–1000 | `workers/review` (local dev) | Throws |
| `AI_GATEWAY_MODEL` empty string | `workers/review` (local dev) | Throws `AI_GATEWAY_MODEL must not be empty` |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` / `GITHUB_OAUTH_REDIRECT_URI` | `workers/api` | Throws at OAuth route invocation (not startup) |
| `PLATFORM_ACTION_TOKEN` missing | `workers/api` | Internal action endpoints return `503` |

### Settings that degrade gracefully if absent

| Setting | Degraded behaviour |
|---|---|
| `SESSION_SECRET` | Logs warning at startup; throws when a session route is invoked |
| `GITHUB_WEBHOOK_SECRET` | Logs warning; webhook signature validation is skipped |
| `AI_GATEWAY_BASE_URL` / `AI_GATEWAY_API_KEY` | Logs warning; review jobs are skipped |
| `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` | Logs warning; cannot post PR review comments |
| `NEXT_PUBLIC_PLATFORM_API_BASE_URL` | Dashboard falls back to `http://127.0.0.1:8787` |
| `CODEVETTER_LINEAR_CLIENT_ID` | Desktop app Linear integration is unavailable |

---

## Defaults

| Variable | Default value | Source |
|---|---|---|
| `API_WORKER_HOST` | `127.0.0.1` | `workers/api/src/config.ts` |
| `API_WORKER_PORT` | `8080` | `workers/api/src/config.ts` |
| `API_WORKER_CORS_ORIGIN` | `https://app.codevetter.com` | `workers/api/src/config.ts` (code) / `wrangler.toml` |
| `GITHUB_API_BASE_URL` | `https://api.github.com` | Both worker config files |
| `SESSION_COOKIE_NAME` | `cr_session` | `workers/api/src/index.ts` constant |
| `SESSION_TTL_HOURS` | `168` (7 days) | `workers/api/src/index.ts` constant / `wrangler.toml` |
| `RATE_LIMIT_WINDOW_MS` | `60000` | `workers/api/src/index.ts` constant / `wrangler.toml` |
| `RATE_LIMIT_MAX_REQUESTS` | `120` | `workers/api/src/index.ts` constant / `wrangler.toml` |
| `DB_USE_IN_MEMORY` | `false` | `wrangler.toml` |
| `AI_GATEWAY_MODEL` | `llama-3.3-70b-versatile` (review worker `wrangler.toml`) / `auto` (code fallback) | `workers/review/wrangler.toml` / `workers/review/src/index.ts` |
| `REVIEW_WORKER_POLL_MS` | `2000` | `workers/review/src/config.ts` |
| `REVIEW_WORKER_MAX_ITERATIONS` | `10` | `workers/review/src/config.ts` |
| `REVIEW_WORKER_MAX_RETRIES` | `3` | `workers/review/src/config.ts` |
| `REVIEW_WORKER_RETRY_BASE_MS` | `1000` | `workers/review/src/config.ts` |
| `REVIEW_WORKER_RETRY_MAX_MS` | `30000` | `workers/review/src/config.ts` |
| `INDEX_MAX_FILE_BYTES` | `10485760` (10 MB) | `workers/review/src/config.ts` |
| `INDEX_CHUNK_STRATEGY` | `tree-sitter` | `workers/review/src/config.ts` |
| `INDEX_MAX_CHUNK_LINES` | `220` | `workers/review/src/config.ts` |
| `CF_REVIEW_QUEUE_NAME` | `review-jobs` | `workers/review/src/config.ts` |
| `CF_INDEXING_QUEUE_NAME` | `indexing-jobs` | `workers/review/src/config.ts` |
| `NEXT_PUBLIC_PLATFORM_API_BASE_URL` | `http://127.0.0.1:8787` | `apps/dashboard/lib/platform.ts` |
| Desktop Vite dev port | `1420` | `apps/desktop/vite.config.ts` |

---

## Per-Environment Overrides

### Local development

No `.env.development` files are present in the repo. Development overrides are applied via shell exports or a local `.env.local` file (gitignored).

**Dashboard** — override the API URL:

```bash
# apps/dashboard — create or edit apps/dashboard/.env.local
NEXT_PUBLIC_PLATFORM_API_BASE_URL=http://127.0.0.1:8787
```

Enable the dev bypass (skip real API calls, return mock data):

```bash
# .env.local or shell
NODE_ENV=development
DEV_BYPASS=true
```

**Workers (local)** — run with `wrangler dev`; `wrangler.toml` `[vars]` values are applied automatically. Override individual values:

```bash
wrangler dev --var DB_USE_IN_MEMORY:true
```

**Desktop** — Vite serves on port `1420` and Tauri points `devUrl` to `http://localhost:1420`. AI gateway credentials are entered via the Settings UI and persisted in `localStorage`; no env file is needed.

**Local graph/history MCP** — no environment variable, credential, URL, or port is
used. Enable one repository under **Settings → Agent MCP** after building its
history, then copy the generated stdio configuration into the client you control.
The config contains only the packaged binary path, local database path, and an
opaque repository scope. See [MCP.md](./MCP.md) for privacy and limits.

### Production (Cloudflare Workers)

All production variables that are non-secret are declared in the `[vars]` block of each `wrangler.toml`. Secrets are uploaded once:

```bash
cd workers/api  && wrangler secret put <NAME>
cd workers/review && wrangler secret put <NAME>
```

To override a `[vars]` value per environment, add a `[env.production.vars]` block to `wrangler.toml`:

```toml
[env.production.vars]
RATE_LIMIT_MAX_REQUESTS = "200"
```

<!-- VERIFY: staging environment name and whether a [env.staging] block is in use -->

### `NODE_ENV` behaviour

`NODE_ENV` is only explicitly checked in the dashboard (`apps/dashboard`). Setting it to `development` unlocks the `DEV_BYPASS` mock mode described above. Cloudflare Workers do not expose `NODE_ENV` at runtime.
