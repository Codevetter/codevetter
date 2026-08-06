## Context

The Astro landing site already keeps educational content in one typed registry.
The registry feeds a shared editorial component and the Markdown projection. See
`proposal.md` for motivation and the capability spec for observable behavior.

## Goals / Non-Goals

**Goals:**

- Add two routes without introducing a second content model.
- Keep visible copy and agent-readable copy derived from one content entry.
- Make dated sources and the absent head-to-head result explicit.

**Non-Goals:**

- Run CodeRabbit or Greptile, alter benchmark data, or change product behavior.
- Deploy or redesign the marketing site.

## Decisions

1. Extend `verificationContent` and render through `EditorialPage`. This preserves
   canonical metadata, schema, visual language, and Markdown behavior. Separate
   handcrafted pages were rejected because they would duplicate content truth.
2. Use one source-backed page per named competitor. Expanding the generic
   review-versus-verification page was rejected because it would not answer exact
   comparison intent and would weaken that page's category role.
3. Treat competitor pricing and capability details as dated observations. The
   page will direct readers to official sources rather than implying permanence.

## Risks / Trade-offs

- [Competitor details drift] -> Show a checked date and retain primary source links.
- [Comparison becomes a disguised benchmark claim] -> State the missing shared run
  before the CTA and prohibit outcome superiority language.
- [Thin orphan pages] -> Add sitemap, Markdown, and adjacent internal links through
  the existing registry mechanisms.

## Migration Plan

Land the two static routes and registry changes on a source branch. A later manual
site deployment can publish them. Rollback is a normal source revert; no data or
runtime migration exists.
