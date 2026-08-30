---
title: Documentation tooling — the DeepWiki decision
description: Why DeepWiki is not adopted for CodeVetter's documentation, and what would fit if auto-generated architecture docs are wanted.
sidebar:
  order: 14
---

# Documentation tooling — the DeepWiki decision

Verified **2026-08-30**. See [tooling-decisions.md](./tooling-decisions.md) for
the cross-category summary.

**Verdict: reject** DeepWiki as a documentation pipeline dependency. The only
form that composes with the existing stack is a passive outbound link (a README
or landing badge to `deepwiki.com/Codevetter/codevetter`), not an integration.

## Why

### The privacy question is subtler than it first appears

CodeVetter's own repository is **public**, so the free hosted deepwiki.com and
its MCP server (`https://mcp.deepwiki.com/mcp`) already work on it today with
zero setup. The private-repo blocker does not bite *this* repo.

It bites hard the moment DeepWiki-style indexing touches the product's actual
privacy-sensitive surface: **the user repositories being reviewed**. Adopting
the pattern for our own docs normalises a dependency that cannot be extended to
the product itself without contradicting its central promise.

### Private repos are paid, and nothing runs offline

Private repositories require a **paid Devin account** (ACU-billed). The free
public MCP server and web UI work only on public repos.

**Exact pricing is UNVERIFIED** — both `devin.ai/pricing` and
`cognition.com/pricing` returned HTTP 429 to every fetch attempt.

Nothing about the deepwiki.com product runs offline. The only offline-capable
option is a **different, independent project** (`AsyncFuncAI/deepwiki-open`),
not the hosted product.

### It fails on process grounds independently of privacy

Even setting privacy aside, DeepWiki conflicts with this repo's own documented
rules:

- **"Markdown under `docs/` is the source of truth."** A hosted generated wiki
  is a second, non-authoritative home for the same facts.
- **"One canonical home per fact."** It duplicates by construction.
- It is invisible to `scripts/check-docs.mjs` and to Blume's navigation, so
  nothing validates its links or keeps it in the sidebar.

## This was already known

[`codebase-context-tools-landscape.md`](./codebase-context-tools-landscape.md)
assessed DeepWiki in **April 2026** and reached the same conclusion. That
document sat in a top-level `research/` directory that nothing linked to, so the
finding was effectively lost and the question got asked again.

The August 2026 re-check confirmed the April verdict still holds, and that the
three self-hosted alternatives it named remain active:

| Project | Stars | License | Last push |
|---|---|---|---|
| `AsyncFuncAI/deepwiki-open` | 17.8k | MIT | 2026-08-16 |
| `AIDotNet/OpenDeepWiki` | 3.5k | MIT | 2026-08-27 |
| `sopaco/deepwiki-rs` | 1.7k | MIT | 2026-08-14 |

The reusable lesson is filed in
[failed-approaches.md](./failed-approaches.md): research that lives outside
`docs/` gets re-done.

## If auto-generated architecture docs are still wanted

**`sopaco/deepwiki-rs`** (MIT) is the closest fit. Use it as a **generator, not
a service**:

1. Run it locally to produce Mermaid/C4 markdown.
2. Commit the output into `docs/architecture/`.
3. Let it go through normal PR review like any other change.

That keeps markdown as the source of truth, keeps `check-docs.mjs` and Blume in
control of validation and navigation, and adds no runtime dependency or network
call. **Never embed it as a live service** — that reintroduces every problem
listed above.

`AsyncFuncAI/deepwiki-open` ships Ollama Docker configs and is the option to
look at if fully local model-driven generation is ever wanted, at the cost of
running a container stack.

## Method note

WebSearch was already at its session budget cap when this was verified, so all
facts came from direct fetches of primary sources (deepwiki.com, docs.devin.ai)
and `gh api` / `gh search` against GitHub. No claims here come from model
memory. Pricing remains the one unverified item.
