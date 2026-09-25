# Usage direction selection — pending

Bounded side work: improve the existing allowance and usage viewer, not the core verification roadmap. No native UI implementation until owner selection.

Purpose: CodeVetter helps developers determine whether agent changes satisfy a task using reproducible execution evidence. Source: PRODUCT.md. Site Health has no purposeContract field for this project; its portfolio keep/stopBuilding fields agree with repository purpose. No portfolio writes are needed for this non-landing surface.

Audience: the operator using Claude/Codex and reviewing local usage history.
Screen job: understand remaining provider allowance, spending pace and token distribution across time, models and work without confusing local activity with provider quota.

All directions preserve DESIGN.md ink surfaces, native sans type, compact controls, bronze selection and textual semantic status. Model identity uses blue, lavender and neutral gray, separate from quota red/yellow/green. Existing Usage controls remain the source of date-window and day/week/month semantics. Preview data is explicitly illustrative except the owner-supplied Codex 13%.

## A — Timeline + model breakdown
Thesis: one time-first analytical card connects history to composition. Full-width stacked weekly bars with an adjacent ranked model summary; compact tabular token labels. Shared controls update both; selecting a bar narrows its breakdown. Signature: time and model totals reconcile visibly. Risk: small model segments need tooltips/exact-value rows and an Other category that can expand.

## B — Model cards with shared history
Thesis: compare individual model patterns without tracing stacked segments. Provider cards followed by equal-scale model mini-chart cards under shared controls. Strong model headings and token totals; lighter period axes. Selecting a model reveals its work. Signature: comparable weekly silhouettes per model. Risk: many models require bounded visible cards, stable ordering and an expansion path.

## C — Work-first usage explorer
Thesis: identify the repository responsible for usage, then inspect weekly/model composition. Provider cards above a work selector and aligned weekly graphical ledger; denser evidence typography and exact values. Signature: work identity anchors each token breakdown. Risk: current LocalUsageSession schema lacks repository identity; attribution must be added or explicitly unknown, never guessed from session ID or model.

## Status semantics proposed
- Remaining: <=20% red/Low, >20–40% yellow/Watch, >40% green/Healthy. Zero explicitly Exhausted; missing/stale values neutral and labelled.
- Pace is separate from absolute allowance: compare remaining percentage with fraction of the provider window remaining when duration/reset metadata is reliable. Describe as percentage points over/under even-use pace, never as a spending forecast or provider guarantee. Without reliable metadata, show Pace unavailable.
- Owner choice and threshold agreement are pending. Owner clarified that model grouping is the priority and project grouping is optional. A and B directly address the primary request; C is an optional project-oriented direction, conditional on trustworthy attribution.

## Evidence and constraints
Inspected PremiumUsageView.swift and UsageModels.swift. Current quota styling only flags <=10%; current model mix is a diagnostic list separate from history. No current native screen was controlled or captured; prior idle permission is stale. Static previews are not screenshots of the running app.

Design-workflow helper was located in saas-maker/tooling after its documented root path was absent. Existing .fleet/design-review.json belongs to Review/Explore and is preserved during selection. Missing adjacent design-inspiration skill was read from its available tooling copy. No dependencies, production UI, portfolio data, or release state changed.

## Owner refinement
Keep color sparse. Both model and project grouping are desired; tokens and cost should share the history time range and day/week/month controls. Interpretation of "branding" is grouping, stated explicitly to owner. A refined preview uses neutral taupe/slate/gray model series and small status accents; no saturated model palette or colored card fills. Selection of the layout remains pending, not inferred from this refinement.

Verified against installed ccusage 20.0.20 help and current Rust adapter: Claude daily exposes --instances and --project. Codex daily and the unified daily command do not expose the same project grouping options. The current RawMetadata and LocalUsageSession receipt do not preserve project identity. Existing RawModel/LocalUsageTotals do preserve input/output/cache tokens and cost. Project attribution requires an explicit adapter extension or separate trusted source and reconciliation; unavailable attribution must remain visible, not be silently dropped or guessed. No live account log scan was performed. Cost is locally reported or estimated using pricing, not actual subscription spending, and provider allowance remains separate.
