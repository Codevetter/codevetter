## Context

CodeVetter's useful proof lives in a local Tauri review: findings, graph-derived impact, executable checks, and staged verification. The marketing site and benchmark harness cannot currently consume that proof as a safe standalone artifact. The design must preserve the desktop/no-server boundary and assume the source review may include private code, local paths, prompts, and credentials.

## Goals / Non-Goals

**Goals:**

- Export one deterministic verification packet from an existing review.
- Make the artifact useful in a PR, benchmark case, or static public example.
- Fail closed on unsafe or unsupported content.
- Build an honest dogfood corpus before catch-rate promotion.

**Non-Goals:**

- A hosted PR analysis service or repository upload API.
- Running new model analysis during export.
- Publishing private-repository artifacts by default.
- Auto-commenting on GitHub or replacing the desktop review workflow.

## Decisions

### Introduce one versioned X-Ray payload

The desktop normalizes persisted review data into a versioned JSON payload. Markdown and HTML renderers consume only that payload, so content and omission semantics remain identical across formats.

Alternative considered: render each format directly from UI state. Rejected because the formats would drift and tests could not assert one stable contract.

### Export only from persisted completed reviews

Generation reads the review database and staged verification records after they reach a stable outcome. Export does not call a provider or infer new findings.

Alternative considered: add a special concise-report LLM call. Rejected because it adds cost, nondeterminism, and a new opportunity to invent unsupported claims.

### Make sanitization a typed allowlist plus scanners

The public payload is assembled from an allowlist of fields. A second pass scans rendered values for secret patterns, absolute paths, disallowed prompt/provider material, and unapproved code. A positive detection blocks export rather than silently masking a potentially misleading artifact.

Alternative considered: serialize the full review and redact known keys. Rejected because denylist redaction fails as review schemas grow.

### Preserve missing proof as first-class output

Unsupported claims, unrun checks, private evidence, and not-applicable stages remain explicit packet items. The aggregate result follows existing staged-verification semantics and cannot upgrade a mixed outcome.

Alternative considered: omit incomplete sections for a cleaner marketing report. Rejected because completeness theater would contradict CodeVetter's evidence positioning.

### Publish static reviewed artifacts first

Dogfood exports are reviewed against the actual PR, review discussion, and CI outcome. Approved artifacts are copied into a static example corpus with state metadata. Benchmark-ground-truth promotion requires independent labels; only those cases can contribute to catch-rate claims.

Alternative considered: accept a public PR URL on the landing page. Rejected for the first phase because it implies a new server, GitHub abuse handling, compute budgets, and a privacy/security surface unrelated to proving the desktop product.

## Risks / Trade-offs

- [Export leaks private content] → Typed allowlist, blocking scanners, explicit excerpt approval, and adversarial fixtures.
- [Static examples become stale] → Pin artifact schema and source commit/PR revision; publish new versions instead of rewriting evidence.
- [Packet overstates aggregate confidence] → Reuse staged verification rules and test mixed, waived, missing, and failed stages.
- [Dogfood cases bias toward successes] → Require corpus metadata for misses and exclusions and keep catch-rate claims limited to adjudicated ground truth.
- [HTML becomes an injection vector] → Escape all payload content, prohibit remote scripts, and enforce a restrictive static template.

## Migration Plan

1. Add the versioned payload types and fixture schema without changing persisted review behavior.
2. Extend staged verification persistence only where structured export provenance is missing.
3. Add sanitizer, validation, and deterministic JSON/Markdown/HTML renderers.
4. Add the desktop export action and explicit excerpt approval flow.
5. Dogfood on fleet PRs, adjudicate outcomes, and publish reviewed static examples.

Rollback removes the export UI and static examples. Existing reviews remain readable because persistence changes are additive.

## Open Questions

- Which bounded code excerpt policy gives enough context without turning the artifact into a diff mirror?
- Should the first static gallery live inside the Astro landing app or the benchmark report output?
- What minimum case mix is required within the 20–30 reviewed cases before publishing a catch-rate number?
