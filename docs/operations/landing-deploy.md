---
title: Landing page deploy
description: How the Astro landing page deploys to Cloudflare Pages.
sidebar:
  order: 2
---

# Landing page deploy

The marketing site (`apps/landing-page-astro`) is a static Astro export
deployed to Cloudflare Pages at **codevetter.com**.

## Trigger

`deploy-landing.yml` runs on `workflow_dispatch` (manual). It is **not**
auto-triggered on push to `main` — landing deploys are intentional.

## Steps

1. `pnpm install --frozen-lockfile` (root).
2. `npm run build` in `apps/landing-page-astro` → `dist/`.
3. Verify required static routes exist:
   - `dist/index.html`
   - `dist/privacy.html`
   - `dist/download.html`
   - `dist/sitemap-index.xml`
   - `dist/robots.txt`
4. Check `CLOUDFLARE_API_TOKEN` secret is present.
5. Deploy to the Cloudflare Pages project `codevetter` via `wrangler pages deploy`.

## Required secret

- `CLOUDFLARE_API_TOKEN` — GitHub Actions secret, scoped to the Pages project.
  Do not commit it. The desktop app does not use this token.

## Local build

```bash
cd apps/landing-page-astro
pnpm install
pnpm build      # → dist/
pnpm preview    # local preview of the static export
```

## Agent indexing surfaces

The landing page (and its proxy worker) serve agent-discovery surfaces:
`llms.txt`, `llms-full`, `/api/ai`, `robots.txt`, `IndexNow` key, and
`FAQPage` JSON-LD. These are part of the static export — do not strip them
when modifying the site. See
[knowledge/learnings/new-things.md](../knowledge/learnings/new-things.md)
(GEO entry).

## Gotchas

- **`out` vs `dist`**: the desktop Vite config uses `outDir: "out"`, but the
  Astro site uses `dist`. The May-2026 CF Pages reconfig failed because the
  Pages `destination_dir` was set to `dist` while the desktop build wrote to
  `out`. The Astro site is the only thing deployed to Pages now — keep
  `destination_dir: dist` and don't point Pages at `apps/desktop`.
- **Single lockfile**: Pages must use `pnpm install --frozen-lockfile` against
  the root `pnpm-lock.yaml`. Do not let a `package-lock.json` reappear.

See [runbooks/deploy-landing.md](./runbooks/deploy-landing.md) for the
manual runbook.
