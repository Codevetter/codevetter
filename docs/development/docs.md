---
title: Working on docs
description: How the docs tree is organized, validated, and rendered with Blume.
sidebar:
  order: 4
---

# Working on docs

The committed Markdown under `docs/` is the **source of truth**. Blume is only
the presentation/search layer. Code and executable configuration remain
authoritative for implementation details and schedules.

## Tree

```
docs/
  index.md                      navigation hub (this site's home)
  product/                      what the product is and which surfaces exist
  architecture/                 how it's built
    decisions/                  pinned technical decisions
  development/                  how to build, test, perf, and work on docs
  operations/                   release, landing, CI
    jobs/                       scheduled workflows
    runbooks/                   step-by-step operational runbooks
  knowledge/                    durable learnings + failed approaches
    learnings/                  concept bridges to external sources
  current/                      short-lived current state
  archive/                      superseded docs (kept for git history)
    planning-codebase/          pre-desloppification planning docs (stale)
```

## Rules

1. **One canonical home per fact.** Don't re-explain something that already
   has a doc — link to it.
2. **Markdown is the source of truth.** Blume config, generated HTML, and
   search indexes are derived artifacts.
3. **Don't duplicate code-discoverable facts.** Link to the file or command
   instead.
4. **Mark unresolved questions explicitly** — do not invent information.
5. **Prefer `docs/archive/<name>.md` over deletion** so git rename history
   survives.
6. **Keep pages 150–300 lines.** Split catch-all pages into focused topics.
7. **Learning docs lean on external sources.** For concepts with
   authoritative sources, reduce each entry to: one-sentence "what",
   one-sentence "why it matters here", link to the source, optional "where
   in this codebase".

## Validate

```bash
node scripts/check-docs.mjs           # link + structure + frontmatter checks
```

CI runs this on every push/PR via `.github/workflows/docs.yml`. The checker
verifies:

- Every `docs/**/*.md` has a `title` in frontmatter (Blume renders it as the
  page heading).
- Every relative Markdown link resolves to a file that exists.
- No broken anchors to headings that don't exist (best-effort).
- `docs/index.md` exists.
- Archived docs are not linked from non-archive docs as canonical sources.

## Render with Blume

Blume reads `blume.config.ts` at the repo root and renders `docs/` as a
static site. It is **not** the source of truth — it only presents the
Markdown.

```bash
npx blume dev      # local dev server
npx blume build    # static export → .blume/dist/
```

Generated Blume output (`.blume/`) is gitignored. Do not commit it.

## Frontmatter

Every page should have at minimum:

```yaml
---
title: Page title
description: One-line summary.
sidebar:
  order: 1
---
```

`sidebar.order` controls the page's position within its section. Other
Blume frontmatter (`seo`, `search`, `draft`, `lastModified`) is optional —
see [Blume's frontmatter reference](https://useblume.dev/docs/reference/frontmatter).

## Maintenance

- When you add a doc, add it to `docs/index.md` and the relevant section's
  navigation.
- When you move a doc, use `git mv` to preserve history, then update all
  inbound links (the checker will catch stragglers).
- When a doc goes stale, move it to `docs/archive/` with a `stale-` prefix
  and a one-line note at the top explaining what superseded it. Do not
  delete.
- When a non-obvious concept lands in code, add a one-line entry to the
  matching `knowledge/learnings/` page (or a new page past ~300 lines) and a
  row in `knowledge/learnings/README.md`.
