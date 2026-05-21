<!-- generated-by: gsd-doc-writer -->
# CodeVetter

AI code review platform for agent-generated code — desktop-first, works offline.

## Deployment & External Services

| Concern | Service |
|---------|---------|
| Desktop app | GitHub Releases — Tauri 2 macOS build, with `@tauri-apps/plugin-updater` auto-updater (`latest.json` manifest) |
| Landing page | Cloudflare Pages (`codevetter`, codevetter.com) — static Next.js export |
| Database | Local SQLite via `@tauri-apps/plugin-sql` (desktop only, no server) |
| Auth | None — LLM provider API keys stored in user settings |
| AI | User-supplied keys (Anthropic / OpenAI / OpenRouter) |
| CI/CD | GitHub Actions — `release.yml` builds Tauri binaries on GitHub release; `deploy-landing.yml` deploys the landing page to Cloudflare Pages on push to `main` |

## Installation

```bash
# Clone and install dependencies (uses npm workspaces)
git clone https://github.com/sarthakagrawal927/CodeVetter.git
cd CodeVetter
npm install
```

> Requires [Rust + Tauri prerequisites](https://tauri.app/v1/guides/getting-started/prerequisites) for the desktop app.

## Quick Start

1. Install dependencies (see above)
2. Launch the desktop app in development mode:
   ```bash
   cd apps/desktop && npm run tauri:dev
   ```
3. Add an AI provider API key (Anthropic, OpenAI, or OpenRouter) in Settings, then open the Review tab to run your first review.

## Usage Examples

**Run the desktop app (dev mode)**
```bash
cd apps/desktop
npm run tauri:dev
```

**Run Playwright end-to-end tests for the desktop app**
```bash
cd apps/desktop
npm test
```

**Build the landing page**
```bash
cd apps/landing-page
npm run build
```

## Monorepo Structure

```
apps/
  desktop/          Tauri 2 + React 19 + Vite desktop app — the core product
  landing-page/     Next.js marketing site (static export, deployed to Cloudflare Pages — codevetter.com)
```

## Tech Stack

| Layer | Technologies |
|---|---|
| Desktop frontend | React 19, Vite, Tailwind CSS, shadcn/ui |
| Desktop backend | Rust (Tauri 2), SQLite |
| Review engine | TypeScript — runs in the webview, no server required |
| Landing page | Next.js 15 (static export → Cloudflare Pages) |
| Testing | Playwright (e2e) |
| Package manager | npm workspaces |

## License

ISC (root package); MIT (landing-page template — Copyright 2022 Themesberg)
