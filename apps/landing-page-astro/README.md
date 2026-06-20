# CodeVetter landing (Astro)

Static marketing site for [codevetter.com](https://codevetter.com). Deploys to Cloudflare Pages project `codevetter`.

## Deploy

```bash
npm run build
npx wrangler pages deploy dist --project-name=codevetter --branch=main
```

CI: `.github/workflows/deploy-landing.yml` on pushes to `apps/landing-page-astro/**`.

## Custom-domain cache

`codevetter.com` sits on a Cloudflare zone with the fleet HTML cache rule (`psi-swarm/scripts/deploy-cf-cache-rules.mjs`). A temporary Worker (`worker.mjs`, `wrangler.worker.jsonc`) serves `dist/` on `codevetter.com/*` routes until zone cache purge works. It fixes stale HTML but adds ~300–400ms TTFB vs `codevetter.pages.dev` (~300ms LCP). **Remove the worker routes** after `CLOUDFLARE_API_TOKEN` has **Zone.Cache Purge** and post-deploy purge succeeds.

After deploy (once purge is available), **purge the zone edge cache** or canonical URLs can serve stale HTML even while `codevetter.pages.dev` is fresh.

Post-deploy (needs `Zone.Cache Purge` on the API token):

```bash
CLOUDFLARE_API_TOKEN=... node scripts/purge-edge-cache.mjs
```

Or: Cloudflare dashboard → **codevetter.com** → Caching → **Purge Everything**.

GitHub Actions secrets:
- `CLOUDFLARE_ZONE_ID_CODEVETTER` — `c1e6464302240c22f727ce64262136fe`
- Org `CLOUDFLARE_API_TOKEN` must include **Zone.Cache Purge** (purge step currently 401 without it)

HTML cache headers (`public/_headers`): `s-maxage=300`, `stale-while-revalidate=60`.