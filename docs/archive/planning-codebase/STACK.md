# Technology Stack

**Analysis Date:** 2026-04-05

## Languages

**Primary:**
- TypeScript 5.7-5.9 - Used across all workspaces (web, desktop, workers, packages)
- HTML/CSS - Used in frontend applications

**Secondary:**
- Rust - Via Tauri desktop application runtime

## Runtime

**Environment:**
- Node.js (version not pinned in repo, uses npm workspaces)

**Package Manager:**
- npm (with monorepo workspaces)
- Lockfile: `package-lock.json` present

**Desktop Runtime:**
- Tauri 2.2.0 - Cross-platform desktop application framework

## Frameworks

**Frontend:**
- Next.js 15.5.6 - Dashboard (`apps/dashboard`)
- React 19.1.0 - UI library across all frontend applications
- React DOM 19.1.0 - React rendering target
- Vite 6.0.0 - Build tool and dev server for desktop app (`apps/desktop`)

**Backend/Workers:**
- Hono 4.7.2 - Lightweight HTTP framework for Cloudflare Workers (`workers/api`)
- Cloudflare Workers - Serverless execution platform (2 workers: `workers/api` and `workers/review`)

**UI Components & Styling:**
- Radix UI 3.3.0 (dashboard) - Unstyled component library
- Radix UI Dialog, Dropdown Menu, Separator, Slot, Tabs, Tooltip - Individual component packages (desktop)
- Tailwind CSS 3.4.0 - Utility-first CSS framework (desktop)
- Tailwind CSS 4.2.2 - Landing page Astro site (`apps/landing-page-astro`)
- Tailwind CSS postcss plugin 4.2.2 - PostCSS integration
- class-variance-authority 0.7.1 - Utility for managing component variants
- tailwind-merge 3.5.0 - Merges Tailwind class lists without conflicts
- clsx 2.1.1 - Conditional class name utility
- lucide-react 1.7.0 - Icon library

**Markdown & Code Display:**
- react-markdown 10.1.0 - Markdown rendering
- remark-gfm 4.0.1 - GitHub-flavored Markdown support
- rehype-highlight 7.0.2 - Syntax highlighting for code blocks

**Desktop UI:**
- react-router-dom 7.1.0 - Client-side routing
- react-resizable-panels 4.9.0 - Resizable panel layout
- xterm 5.5.0 - Terminal emulator (`@xterm/xterm`)
- xterm addon-fit 0.10.0 - Fit xterm to container
- xterm addon-web-links 0.11.0 - Clickable links in terminal

**Testing:**
- Playwright 1.58.2 - E2E and browser automation testing (`@playwright/test`)
- Node.js test runner (built-in) - Used for unit tests with `tsx` loader

**Build/Dev:**
- Tauri CLI 2.2.0 - Desktop app build and development
- Wrangler 4.3.0 - Cloudflare Workers development and deployment tool
- tsx 4.19.0-4.21.0 - TypeScript execution and test runner
- TypeScript 5.7-5.9 - Language compiler
- Vite Plugin React 4.3.0 - React Fast Refresh for Vite
- ESLint 10.0.3 - JavaScript/TypeScript linting
- @typescript-eslint/parser 8.57.1 - TypeScript parser for ESLint
- @typescript-eslint/eslint-plugin 8.57.1 - TypeScript ESLint rules
- Husky 9.1.7 - Git hooks framework
- lint-staged 16.4.0 - Run linters on staged files
- PostCSS 8.5.0-8.5.8 - CSS transformation framework
- Autoprefixer 10.4.20 - Adds vendor prefixes to CSS
- tailwindcss-animate 1.0.7 - Animation utilities for Tailwind
- Tailwind Typography 0.5.19 - Prose utility for styled typography

## Key Dependencies

**Critical:**
- `@code-reviewer/shared-types` (local package) - Shared TypeScript types across all packages
- `@code-reviewer/db` (local package) - Database abstraction layer for D1
- `@code-reviewer/ai-gateway-client` (local package) - OpenAI-compatible AI gateway client
- `@code-reviewer/review-core` (local package) - Core review logic and scoring algorithms

**Infrastructure:**
- Cloudflare Workers Types 4.20260215.0-4.20260329.1 - Type definitions for Workers environment
- Tauri API 2.2.0 - IPC bridge for desktop app
- Tauri Plugin Dialog 2.6.0 - File/directory dialogs for desktop
- Tauri Plugin Process 2.0.0 - Process spawning (child processes)
- Tauri Plugin SQL 2.2.0 - SQLite database plugin for desktop
- Tauri Plugin Updater 2.0.0 - Built-in auto-update for desktop releases

**Database:**
- pg 8.16.3 - PostgreSQL client (used in `workers/review` only, likely for queue adapter)
- web-tree-sitter 0.26.6 - Tree-sitter parser library for semantic code indexing

**UI & Analytics:**
- @saas-maker/sdk 0.2.0 - Analytics SDK
- @saas-maker/feedback 0.2.0 - Feedback widget
- @saas-maker/testimonials 0.2.0 - Testimonials carousel
- @saas-maker/changelog-widget 0.2.0 - Changelog timeline (all used in dashboard)

## Configuration

**Build Configuration Files:**
- `tsconfig.json` - TypeScript compilation settings (root and workspace-specific)
- `vite.config.ts` - Vite build configuration for desktop app (`apps/desktop/vite.config.ts`)
- `tauri.conf.json` - Tauri desktop app configuration (`apps/desktop/src-tauri/tauri.conf.json`)
- `wrangler.toml` - Cloudflare Workers deployment config (2 files: `workers/api/wrangler.toml`, `workers/review/wrangler.toml`)
- `next.config.js` - Next.js configuration for web apps
- `postcss.config.js` - PostCSS configuration
- `tailwind.config.js` - Tailwind CSS configuration
- `playwright.config.ts` - Playwright test configuration
- `playwright.e2e.config.ts` - E2E-specific Playwright config
- `eslint.config.js` - ESLint configuration (flat config format)

**Environment:**
See `.env.example` for required variables:
- Cloudflare Workers D1 database
- GitHub OAuth (client ID, secret, webhook secret)
- GitHub App credentials (app ID, private key)
- Session management (secret, TTL, cookie domain)
- AI Gateway configuration (base URL, API key, model)
- Workspace encryption key
- SaaS Maker API key (dashboard analytics/widgets)
- Linear integration (desktop app, optional)

**Development Presets:**
- No `.nvmrc` file (Node version not pinned)
- Vite dev server port: 1420 (desktop app)
- Next.js dev server ports: 4174 (dashboard), default 3000 (landing page)

## Platform Requirements

**Development:**
- Node.js (npm packages/workspaces)
- Rust toolchain (for Tauri desktop build)
- Git (for Husky hooks)
- Modern browser (for dashboard and landing page development)

**Production:**
- **API & Review Workers:** Cloudflare Workers platform
- **Dashboard:** Vercel or any Node.js hosting (Next.js compatible)
- **Landing Page:** Vercel or any static/Node.js hosting (Next.js compatible)
- **Desktop:** macOS, Windows, Linux (via Tauri binary distribution)

**Deployment:**
- API Worker: `api.codevetter.com` (Cloudflare Workers custom domain)
- Compatibility flags: `nodejs_compat` (for Node.js API in Workers)
- D1 Database: Cloudflare D1 (SQLite-compatible, id: `79f405dc-aefe-495b-883c-1f7623f0f0bf`)

---

*Stack analysis: 2026-04-05*
