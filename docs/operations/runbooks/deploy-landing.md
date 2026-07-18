---
title: Deploy the landing page
description: Runbook for deploying the Astro site to Cloudflare Pages.
sidebar:
  order: 2
---

# Runbook: deploy the landing page

Landing deploys are manual (`workflow_dispatch` on `deploy-landing.yml`).
They are not triggered by push.

## Steps

1. **Confirm `main` is green** — check the latest `CI` workflow run.

2. **Build locally to catch issues before triggering the workflow:**
   ```bash
   cd apps/landing-page-astro
   pnpm install
   pnpm build
   test -f dist/index.html
   test -f dist/privacy.html
   test -f dist/download.html
   test -f dist/sitemap-index.xml
   test -f dist/robots.txt
   ```

3. **Trigger the deploy workflow:**
   ```bash
   gh workflow run deploy-landing.yml --ref main
   gh run watch
   ```
   Or use the GitHub Actions UI: Actions → "Deploy Landing Page" → Run workflow.

4. **Verify the deploy** in the Cloudflare Pages dashboard (project
   `codevetter`). The workflow logs the deployment ID and status.

5. **Smoke-check the live site:**
   - `https://codevetter.com` loads.
   - `https://codevetter.com/llms.txt` and `/api/ai` are reachable (agent
     indexing surfaces).
   - `https://codevetter.com/sitemap-index.xml` and `/robots.txt` are present.

## Required secret

- `CLOUDFLARE_API_TOKEN` must be set as a GitHub Actions secret. If the
  workflow fails at "Check Cloudflare deploy secrets", the token is missing
  or expired — rotate it in the repo settings, not in code.

## Common failures

- **Build type error in `Footer.tsx` or similar** — fix the type error on
  `main` and re-run. (This happened 2026-05-02; see
  [knowledge/failed-approaches.md](../../knowledge/failed-approaches.md).)
- **`pnpm-lock.yaml` out of sync** — run `pnpm install` at root, commit the
  lockfile, push, then re-trigger. The May-2026 CF Pages outage was this.
- **Wrong output directory** — the Astro site writes to `dist`; the desktop
  Vite writes to `out`. Do not point Pages at `apps/desktop`.

## Do not

- Do not auto-trigger landing deploys on push — keep them intentional.
- Do not deploy from a branch other than `main` unless explicitly coordinating
  a preview.
- Do not strip the agent indexing surfaces (`llms.txt`, `/api/ai`, JSON-LD)
  when editing the site.
