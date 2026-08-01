---
target: current CodeVetter desktop product and UI
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 4
timestamp: 2026-08-01T17-55-01Z
slug: apps-desktop-src-app-tsx
---
# CodeVetter product and desktop critique

## Strategic verdict

CodeVetter is impressive engineering but not yet a coherent product. The repository contains a substantial local verification stack: bounded execution, runtime receipts, structural and historical evidence, deterministic scoring, a qualified synthetic task corpus, CLI/MCP boundaries, and unusually honest failure states. But that core is buried beneath an older AI-review workbench, repository-intelligence suite, usage dashboard, agent workspace, board, and native agent presentation layer.

The July pivot exists in product documentation and newer harness work. It does not yet exist as the user's product. The desktop's default object is still a dashboard or repository; it should be a verification case.

The focused job should be:

> Given a task and an agent-authored change, did it actually work? Show the executable evidence, state what remains unverified, and make the result reproducible.

Comparative agent and context experiments are the second job, powered by the same receipts. Graph context is an experimental input, not the product.

## Competition

The tools initially identified are several different markets:

- pgGraph and HydraDB are graph infrastructure. They are not meaningful product competitors.
- CodeGraph, Graphify, and RepoWise are agent-readable context engines. RepoWise also spans human wiki, history, decisions, and code health, creating direct overlap with Repo Unpack.
- DeepWiki is primarily human-readable generated documentation and grounded Q&A.
- Sourcegraph is enterprise code search and multi-repository context.
- CodeRabbit and Qodo compete with the legacy Review proposition and have much stronger pull-request distribution.
- Harbor/Terminal-Bench and SWE-bench occupy coding-agent benchmark infrastructure.
- Braintrust and LangSmith occupy general experiment, dataset, scoring, tracing, and comparison infrastructure.

CodeVetter should not try to beat focused context providers at indexing, established review vendors at PR distribution, or general evaluation platforms at horizontal breadth. Its credible wedge is local, software-specific, execution-backed verification with hidden checks, immutable evidence identities, contamination detection, and reproducible comparisons.

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 3 | Strong local states, but no unified verification-run status across surfaces. |
| 2 | Match System / Real World | 2 | Repo Unpack, T-Rex, warm verification, and Review with Claude obscure the core job. |
| 3 | User Control and Freedom | 3 | Good cancellation, retry, persistence, and reversible actions; deeper exits and undo vary. |
| 4 | Consistency and Standards | 2 | Coherent tokens, inconsistent page structures and navigation documentation. |
| 5 | Error Prevention | 3 | Strong validation and confirmations, but advanced forms expose too many paths. |
| 6 | Recognition Rather Than Recall | 2 | Users must remember how Repo, Review, Testing, and Work compose. |
| 7 | Flexibility and Efficiency | 3 | Strong shortcuts, persistent state, history, and expert affordances. |
| 8 | Aesthetic and Minimalist Design | 2 | Visually disciplined but functionally overloaded. |
| 9 | Error Recovery | 2 | Several actionable errors, but no consistent guided recovery model. |
| 10 | Help and Documentation | 1 | Onboarding teaches the outdated review product rather than verification evidence. |
| **Total** |  | **23/40** | **Acceptable craft; substantial product simplification required.** |

## Design Specificity Verdict

### Design assessment

Visually authored, structurally unfocused. The dark ink and warm amber Evidence Bench language is coherent and appropriate. The app feels technically serious. But the shell presents several historical products as peers, so it reads as a consolidated suite rather than one verification instrument.

### Deterministic scan

The detector reported 10 `gray-on-color` findings: five in Home, three in AgentPanel, and two in QuickReview. Source inspection makes six definite false positives and the remaining four likely false positives because the backgrounds are mutually exclusive branches or very low-opacity tints over dark surfaces. The scan did not reveal a systemic mechanical design defect.

This reinforces the main conclusion: the highest-impact UI problems are information architecture, terminology, and hierarchy—not Tailwind color cleanup.

### Visual overlays

No reliable visual overlay is available. Browser control reported no connected browser, so mutable injection and screenshots could not be performed. Five representative Vite routes returned HTTP 200, which confirms routing only, not rendered quality.

## Overall Impression

The strongest moments are the honest receipt and no-confidence states in Testing and Review. The weakest moment is the product entrance: onboarding teaches model selection and AI review, then the app opens on usage telemetry. A user must cross several legacy concepts before reaching the differentiated product.

The biggest opportunity is not a redesign of each page. It is choosing one canonical object—`verification case`—and reorganizing everything around it.

## What's Working

- Honest semantic states such as partial coverage, passed with limits, and no confidence are unusually good.
- Persistent routes, cancellation, retries, bounded output, and history show excellent operational care.
- The ink/amber system, evidence typography, focus treatment, and written status labels are a solid craft foundation worth preserving.

## Priority Issues

### P0 — The visible product contradicts the stated product

**Why it matters:** The repo says CLI/MCP verification is primary and desktop is a receipt viewer. The app leads with Usage, Repo Unpack, Work, Board, Review, and Testing. The landing page still sells a desktop AI reviewer and makes claims about vulnerability classes and offline behavior. Users cannot form a stable expectation.

**Fix:** Pick the verification product explicitly. Rewrite landing, onboarding, navigation, and the default route around one verification case. Remove unsupported claims and demote unrelated surfaces.

**Suggested command:** `$impeccable shape`

### P1 — The shell contradicts the core loop

**Why it matters:** Launching into usage telemetry makes administration feel more important than determining whether a change is correct. Work and Board are agent-control products placed inside Verification.

**Fix:** Use a minimal shell such as Verify, Runs, Experiments, and Settings. Put repository context inside a case; move Usage, Work, Board, and Agent Island to Labs/Legacy or remove them from primary navigation.

**Suggested command:** `$impeccable distill`

### P1 — Review and Testing split one user question across two products

**Why it matters:** A user asks whether a change is correct. Review emphasizes model findings; Testing owns the strongest executable receipts. The user must mentally merge them.

**Fix:** Model a verification case with stages: target and intent, checks, findings, runtime evidence, verdict, limitations, and next action.

**Suggested command:** `$impeccable shape`

### P1 — Results bury the verdict beneath accumulated features

**Why it matters:** Review's sidebar contains roughly a dozen evidence, graph, QA, export, and audience systems. Equal visual weight makes source-backed limitations and next actions hard to locate.

**Fix:** Pin verdict, evidence strength, limitations, and next action. Move graphs, audience simulation, X-Ray, synthetic QA, and exports behind secondary disclosure.

**Suggested command:** `$impeccable distill`

### P1 — Onboarding installs the wrong mental model

**Why it matters:** It teaches model selection, usage stats, and AI review instead of task completion and executable proof.

**Fix:** First run should select a repository/change, run one bounded check, and teach how to read a receipt, failure, and limitation.

**Suggested command:** `$impeccable onboard`

### P2 — Dense evidence presentation strains accessibility

**Why it matters:** Critical context is often 9–11px and muted; dense sidebars create long keyboard paths.

**Fix:** Increase essential evidence metadata size and contrast, simplify result order, and confirm effective runtime contrast visually.

**Suggested command:** `$impeccable audit`

## Cognitive Load

High: seven of eight checklist areas fail. Grouping is generally good, but single focus, chunking, hierarchy, one-thing-at-a-time flow, minimal choices, working-memory burden, and progressive disclosure do not.

Decision points above four include:

- six primary destinations plus Settings and command search;
- up to eight Repo Unpack sections;
- eleven Settings categories;
- roughly a dozen Review result-side modules; and
- seven setup concepts inside expanded Review context.

## Emotional Journey

The user expects verification, encounters usage administration, becomes uncertain about which surface owns the task, then finally reaches excellent evidence language in Testing. The product peaks late and ends without one calm closure: verified, failed, or no confidence, followed by the next safe action.

## Persona Red Flags

**Alex, power user:** Strong shortcuts and persistent state do not answer whether the same change belongs in Repo, Review, or Testing. A trustworthy evaluation in under a minute is unlikely.

**Jordan, first-timer:** Usage telemetry and AI-review onboarding create the wrong model before they encounter Repo Unpack, T-Rex, warm verification, and scenario compilation.

**Sam, keyboard/low-vision user:** Focus and reduced-motion support are positive, but tiny muted evidence text and the long Review sidebar journey reduce practical accessibility.

## Minor Observations

- Design and surface documentation describe a top rail while implementation uses a fixed left rail.
- Board has a keyboard shortcut but is absent from the command palette.
- Page-title structures differ substantially by route.
- T-Rex is internal-history branding, not self-explanatory product language.
- The sidebar subtitle Evidence workbench is good; the rest of the IA does not yet fulfill it.
- The four largest page files total roughly 14,900 lines, mirroring feature and state accumulation in the user experience.

## Questions to Consider

- If Usage, Work, Board, Agent Island, and most Repo Unpack sections disappeared from primary navigation, would the actual verification product lose anything essential?
- Why are Review and Testing separate when the user asks one question: is this change correct?
- Does a panel change the verdict or explain its confidence? If not, why is it in the primary result view?
- Is CodeVetter a daily verification tool, an evaluation research lab, or a broad agent workbench? It cannot lead with all three.
