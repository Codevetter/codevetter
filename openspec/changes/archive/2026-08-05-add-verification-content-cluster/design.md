# Context

The landing site already owns layout, tokens, metadata, sitemap generation, and agent Markdown. The new material is a Read-mode extension of that system.

# Approach

Create a typed content registry containing title, description, lede, sections, CTA, related links, and structured-data type. A shared Astro page renders each guide while explicit route files keep canonical URLs obvious. The same registry feeds `agent-markdown.ts`, preventing human and agent copy from drifting.

```mermaid
flowchart LR
  Registry[Typed guide registry] --> Pages[Astro routes]
  Registry --> Markdown[Agent Markdown routes]
  Pages --> Sitemap[Astro sitemap]
  Pages --> Links[Contextual internal links]
  Benchmark[Existing benchmark data] --> Proof[/benchmark proof hub]
```

# Decisions

- Preserve the current ink-and-amber design system.
- Use static HTML and existing dependencies only.
- Keep benchmark values sourced from committed data.
- Use Article, TechArticle, HowTo, Dataset, and BreadcrumbList only when visible content supports them.
- Make limitations visible before conversion CTAs.

# Validation

Strict OpenSpec validation, Astro build, docs check, targeted route/schema/link assertions, manual detector, and browser evidence at 390, 768, and 1440 pixels.
