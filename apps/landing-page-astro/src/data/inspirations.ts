export type InspirationCategory =
  | 'Verification'
  | 'Code context'
  | 'Agent workflows'
  | 'Building blocks';
type InspirationRelation = 'In the product' | 'Design reference' | 'Research reference';

export interface Inspiration {
  slug: string;
  name: string;
  category: InspirationCategory;
  relation: InspirationRelation;
  idea: string;
  admiration: string;
  lesson: string;
  codevetter: string;
  source: { label: string; url: string };
  research: 'landscape' | 'competition' | 'integration' | 'project-log' | 'evidence-pattern';
}

export const researchSources = {
  landscape: {
    label: 'CodeVetter codebase-context research',
    url: 'https://github.com/Codevetter/codevetter/blob/main/docs/knowledge/codebase-context-tools-landscape.md',
  },
  competition: {
    label: 'CodeVetter competitive landscape',
    url: 'https://github.com/Codevetter/codevetter/blob/main/docs/knowledge/competitive-landscape.md',
  },
  integration: {
    label: 'CodeVetter OSS integration decision',
    url: 'https://github.com/Codevetter/codevetter/blob/main/docs/architecture/decisions/oss-integration.md',
  },
  'project-log': {
    label: 'CodeVetter project log',
    url: 'https://github.com/Codevetter/codevetter/blob/main/docs/archive/project-log.md',
  },
  'evidence-pattern': {
    label: 'CodeVetter evidence-pattern design',
    url: 'https://github.com/Codevetter/codevetter/blob/main/docs/archive/PRD-EVIDENCE-PATTERN-SEARCH.md',
  },
} as const;

// A curated ledger of named tools with a concrete lesson in our project research.
// This is not a claim that their authors endorse CodeVetter or that we copied their work.
export const inspirations: Inspiration[] = [
  {
    slug: 'aider',
    name: 'Aider',
    category: 'Code context',
    relation: 'Design reference',
    idea: 'A small, ranked repository map gives an agent useful context without dumping the whole tree.',
    admiration:
      'Aider makes repository context a deliberate budget. Its map uses syntax and relationships to select definitions that are likely to help with the current task, then leaves room for the agent to read the real files.',
    lesson:
      'The valuable unit is a navigable lead with an explicit source, rather than a large prompt that merely looks comprehensive. Ranking matters because every extra token competes with evidence from the actual change.',
    codevetter:
      'Our repository graph and Repo Unpack packets pursue bounded, source-linked navigation. We did not port Aider’s PageRank implementation or make a repository map the verdict. The verifier still has to execute checks and attach run evidence.',
    source: { label: 'Aider repository map', url: 'https://aider.chat/docs/repomap.html' },
    research: 'landscape',
  },
  {
    slug: 'greptile',
    name: 'Greptile',
    category: 'Verification',
    relation: 'Design reference',
    idea: 'A code review must follow a change beyond the diff.',
    admiration:
      'Greptile’s repository graph puts distant functions, dependencies, and callers into the reviewer’s field of view. That is a useful corrective to reviews that judge a changed line without seeing the behavior around it.',
    lesson:
      'A finding becomes stronger when the reviewer can explain the path from the changed code to the affected behavior. Broad context should help generate a testable claim, rather than replace proof with confidence.',
    codevetter:
      'CodeVetter builds local structural and historical context for review, then asks for executable verification and a bounded evidence receipt. We have not established a head-to-head catch-rate advantage over Greptile; our benchmark limitations remain public.',
    source: { label: 'Greptile overview', url: 'https://www.greptile.com/docs/introduction' },
    research: 'competition',
  },
  {
    slug: 'coderabbit',
    name: 'CodeRabbit',
    category: 'Verification',
    relation: 'Design reference',
    idea: 'Review is more useful when it arrives in the developer’s normal change workflow.',
    admiration:
      'CodeRabbit helped make automated, context-aware PR feedback a familiar part of the review cycle. Its summaries, inline comments, and developer-facing explanations show the value of giving findings a clear place to be acted on.',
    lesson:
      'Delivery and presentation matter, but a review comment is still a hypothesis until someone can reproduce the underlying problem. Review volume alone is not a quality metric.',
    codevetter:
      'We studied CodeRabbit as a baseline for agent-written PRs. CodeVetter keeps its verification local and records reproduced, unchecked, and failed states explicitly; the public synthetic corpus does not prove superiority on production PRs.',
    source: { label: 'CodeRabbit documentation', url: 'https://docs.coderabbit.ai/' },
    research: 'competition',
  },
  {
    slug: 'qodo',
    name: 'Qodo / PR-Agent',
    category: 'Verification',
    relation: 'Research reference',
    idea: 'A review should be close to tests and the intent behind a change.',
    admiration:
      'Qodo’s review work and open PR-Agent made the review pipeline inspectable to a wide audience. The emphasis on tests, descriptions, and repository instructions is especially relevant when an agent has written the patch.',
    lesson:
      'Pull request comments, test generation, and task context are separate evidence sources. Treating each as a distinct input makes it easier to see what a reviewer actually knows.',
    codevetter:
      'CodeVetter uses task intent, command results, and reproducible artifacts in one verification bundle. We studied Qodo’s workflow; we do not use PR-Agent as CodeVetter’s review engine.',
    source: { label: 'PR-Agent documentation', url: 'https://docs.pr-agent.ai/' },
    research: 'competition',
  },
  {
    slug: 'ellipsis',
    name: 'Ellipsis',
    category: 'Verification',
    relation: 'Research reference',
    idea: 'The useful review loop continues from finding to attempted fix.',
    admiration:
      'Ellipsis connects review feedback with an agent that can make a change and run checks. That closes an important gap between a comment that identifies a problem and an actual repair that a developer can inspect.',
    lesson:
      'A generated fix needs its own verification. The fact that an agent acted on a comment does not establish that the behavior is repaired or that the patch stayed within scope.',
    codevetter:
      'CodeVetter’s agent-fix packets and review-proof states make the proposed repair reviewable and distinguish fixed, reproduced, and unchecked outcomes. Ellipsis was a workflow reference, not an integration.',
    source: {
      label: 'Ellipsis code review documentation',
      url: 'https://www.ellipsis.dev/docs/code-review',
    },
    research: 'competition',
  },
  {
    slug: 'sourcery',
    name: 'Sourcery',
    category: 'Verification',
    relation: 'Research reference',
    idea: 'Fast review can combine code quality signals with readable feedback.',
    admiration:
      'Sourcery’s review product helped frame the baseline expectation that automated feedback should be quick and accessible where developers work. Its focus on code quality also highlights the breadth of what a reviewer can look for.',
    lesson:
      'A style or maintainability suggestion has a different evidentiary burden from a claimed runtime bug. Keeping those claims separate prevents a long review from sounding more certain than it is.',
    codevetter:
      'Our research compared Sourcery with other PR reviewers. CodeVetter’s core verdict is reserved for executable task evidence; we have not integrated Sourcery or copied its rules.',
    source: { label: 'Sourcery documentation', url: 'https://docs.sourcery.ai/' },
    research: 'competition',
  },
  {
    slug: 'bito',
    name: 'Bito',
    category: 'Verification',
    relation: 'Research reference',
    idea: 'Repository architecture and external project context can change the meaning of a diff.',
    admiration:
      'Bito’s AI Architect and review tooling treat the codebase as more than a set of changed files. The connection between architecture, history, and review was a useful research reference for our own context work.',
    lesson:
      'Context sources should remain attributable. A ticket, a graph edge, and a test failure carry different kinds of authority, and mixing them without provenance makes a verdict harder to trust.',
    codevetter:
      'CodeVetter records source-linked graph and history leads and keeps runtime checks distinct. Bito is part of our landscape research; there is no Bito dependency or service connection.',
    source: {
      label: 'Bito review overview',
      url: 'https://docs.bito.ai/ai-code-reviews-in-git/overview',
    },
    research: 'competition',
  },
  {
    slug: 'graphite',
    name: 'Graphite Agent',
    category: 'Verification',
    relation: 'Research reference',
    idea: 'Review quality depends on the shape and timing of the change.',
    admiration:
      'Graphite brought stacked changes and code review into one workflow, then added an agent reviewer. The product is a reminder that a reviewer is only as usable as the change boundary it receives.',
    lesson:
      'Smaller, well-scoped diffs are easier to reason about, reproduce, and attribute. A system should make the boundary of a review obvious before claiming that a finding covers the whole task.',
    codevetter:
      'CodeVetter scopes verification to an exact change and records coverage gaps. We studied Graphite’s workflow; CodeVetter does not manage stacked PRs or use Graphite Agent internally.',
    source: {
      label: 'Graphite Agent introduction',
      url: 'https://graphite.com/blog/introducing-graphite-agent-and-pricing',
    },
    research: 'landscape',
  },
  {
    slug: 'panto',
    name: 'Panto AI',
    category: 'Verification',
    relation: 'Research reference',
    idea: 'Design documents, tickets, and code history can be relevant to review.',
    admiration:
      'Panto’s approach to reviewing with multiple context sources stood out in our landscape survey. A changed function can satisfy its local tests while still violating a product requirement recorded elsewhere.',
    lesson:
      'More sources can improve review only when the system identifies where each claim came from. A plausible business rule inferred from prose is a lead, not an observed runtime result.',
    codevetter:
      'CodeVetter’s intent and business-rule work preserves source identity and uncertainty. Panto is a research reference; our local verifier does not import Panto’s context or scanning service.',
    source: {
      label: 'Panto official site',
      url: 'https://www.getpanto.ai/',
    },
    research: 'landscape',
  },
  {
    slug: 'github-copilot',
    name: 'GitHub Copilot code review',
    category: 'Verification',
    relation: 'Research reference',
    idea: 'A code host can make automated review a normal request on a pull request.',
    admiration:
      'Copilot code review is a useful mainstream baseline: a developer can ask for review in the same place they inspect a PR and act on suggestions without learning a separate system.',
    lesson:
      'Convenience makes review more likely to happen. It does not establish whether a suggestion describes a reproducible failure, so benchmark comparisons must count real findings and false positives.',
    codevetter:
      'CodeVetter’s benchmark and verification bundle make evidence and scoring inspectable outside a code host. We have not claimed a production catch-rate win against Copilot code review.',
    source: {
      label: 'GitHub Copilot code review',
      url: 'https://docs.github.com/en/copilot/concepts/agents/code-review',
    },
    research: 'landscape',
  },
  {
    slug: 'deepwiki',
    name: 'DeepWiki',
    category: 'Code context',
    relation: 'Design reference',
    idea: 'A repository can be made legible quickly through structured explanation.',
    admiration:
      'DeepWiki turned public repository exploration into a low-friction experience: enter a repo and get navigable explanations and diagrams. That feeling of a codebase becoming understandable was a strong reference for Repo Unpack.',
    lesson:
      'Generated explanations are useful entry points, especially for unfamiliar repos. They need direct links back to files and a clear freshness boundary before someone relies on them for a technical decision.',
    codevetter:
      'Repo Unpack publishes source-linked, pinned-commit artifacts and labels inferences. CodeVetter does not claim that generated prose proves behavior, and it does not depend on DeepWiki.',
    source: { label: 'Cognition introduces DeepWiki', url: 'https://cognition.com/blog/deepwiki' },
    research: 'landscape',
  },
  {
    slug: 'sourcegraph',
    name: 'Sourcegraph',
    category: 'Code context',
    relation: 'Design reference',
    idea: 'Finding the right code is a first-class engineering workflow.',
    admiration:
      'Sourcegraph made large-scale code search and navigation a product in their own right. Its search grammar, symbol navigation, and cross-repository perspective are useful reminders that context begins with locating the right source.',
    lesson:
      'Search results should be navigable and attributable. A good retrieval system helps a human or agent inspect the code rather than burying the path and line behind a prose answer.',
    codevetter:
      'CodeVetter’s local graph, history, and evidence search serve a narrower verification task. We do not offer Sourcegraph’s organization-wide index or use its service.',
    source: { label: 'Sourcegraph code search', url: 'https://sourcegraph.com/code-search' },
    research: 'landscape',
  },
  {
    slug: 'augment-code',
    name: 'Augment Code',
    category: 'Code context',
    relation: 'Research reference',
    idea: 'Fresh repository context should follow the developer across tools.',
    admiration:
      'Augment’s Context Engine emphasizes a continuously updated understanding of code, dependencies, and history. The ambition is compelling because stale context can make an otherwise capable agent confidently wrong.',
    lesson:
      'Freshness is part of correctness. A context packet should identify the revision it describes and say when indexing is incomplete or out of date.',
    codevetter:
      'Our graph and history receipts report indexed revisions and stale states. Augment was a context-engine research reference; CodeVetter does not use its hosted index.',
    source: { label: 'Augment Context Engine', url: 'https://www.augmentcode.com/context-engine' },
    research: 'landscape',
  },
  {
    slug: 'arbor',
    name: 'Arbor',
    category: 'Code context',
    relation: 'Design reference',
    idea: 'Deterministic graph traversal is a useful answer to structural questions.',
    admiration:
      'Arbor’s graph-native approach values exact symbol relationships over a vague semantic match. That is a principled way to answer questions such as “what calls this function?” and “what might this change affect?”',
    lesson:
      'A graph edge should carry a source location and a defined extraction rule. Determinism makes a result repeatable, although a parser graph still cannot prove the program’s runtime behavior.',
    codevetter:
      'CodeVetter owns a bundled Tree-sitter structural graph and marks extracted links as evidence leads. Arbor’s philosophy informed our evaluation, but its engine is not bundled.',
    source: { label: 'Arbor source repository', url: 'https://github.com/getArbor-dev/arbor' },
    research: 'landscape',
  },
  {
    slug: 'logicstamp',
    name: 'LogicStamp Context',
    category: 'Code context',
    relation: 'Research reference',
    idea: 'Architecture facts can be compiled into deterministic, diffable contracts.',
    admiration:
      'LogicStamp’s TypeScript context compiler produces structured architectural information from source rather than asking a model to summarize everything from scratch. The diffable output is the interesting part: architectural change becomes inspectable.',
    lesson:
      'A context artifact should tell us what changed and how it was derived. Repeatable extraction is especially valuable when comparing agent patches over time.',
    codevetter:
      'Our repository graph and verification receipts use versioned schemas and source anchors. We studied LogicStamp, but CodeVetter does not embed its TypeScript compiler pipeline.',
    source: {
      label: 'LogicStamp Context repository',
      url: 'https://github.com/LogicStamp/logicstamp-context',
    },
    research: 'landscape',
  },
  {
    slug: 'repomix',
    name: 'Repomix',
    category: 'Code context',
    relation: 'Research reference',
    idea: 'A repository packet should be portable and deliberate about what it includes.',
    admiration:
      'Repomix made repo-to-prompt packaging concrete, with explicit formats, filters, and output that can travel between tools. It set a high bar for making source context shareable without requiring a live index.',
    lesson:
      'Packaging is useful only when selection, omission, and size are visible. An enormous serialized repo can hide what mattered just as easily as a tiny, under-scoped excerpt.',
    codevetter:
      'Repo Unpack and evidence bundles use bounded, structured artifacts tied to a revision. Repomix was evaluated as an optional adapter, not chosen as the review engine or a required dependency.',
    source: { label: 'Repomix source repository', url: 'https://github.com/yamadashy/repomix' },
    research: 'integration',
  },
  {
    slug: 'swimm',
    name: 'Swimm',
    category: 'Code context',
    relation: 'Research reference',
    idea: 'Documentation is more useful when it remains connected to code.',
    admiration:
      'Swimm’s code-coupled documentation addresses a familiar problem: prose that was once correct slowly drifts away from the implementation. Keeping a document near the source it explains makes that drift easier to notice.',
    lesson:
      'A useful explanation needs both a stable narrative and a checkable source reference. Generated knowledge should expose stale links rather than silently sounding current.',
    codevetter:
      'CodeVetter’s canonical docs live in the repo; Repo Unpack cites a pinned commit and source paths. We do not use Swimm or claim automatic documentation maintenance.',
    source: {
      label: 'Swimm on code-coupled docs',
      url: 'https://swimm.io/blog/advanced-documentation-editor-how-to-create-code-coupled-docs-in-seconds',
    },
    research: 'landscape',
  },
  {
    slug: 'google-code-wiki',
    name: 'Google Code Wiki',
    category: 'Code context',
    relation: 'Research reference',
    idea: 'Repository explanations should be refreshed as code changes.',
    admiration:
      'Google Code Wiki’s continuously updated wiki is a useful counterpoint to one-time documentation generation. It treats freshness as part of the reader’s experience, not an implementation detail.',
    lesson:
      'A wiki should say which version of the repository it describes. Regeneration alone is not enough if readers cannot trace an important statement to source or distinguish an inferred relationship.',
    codevetter:
      'Repo Unpack artifacts carry a scanned commit and evidence links. We researched Code Wiki as a documentation pattern; CodeVetter does not generate a continuously hosted wiki.',
    source: {
      label: 'Google introduces Code Wiki',
      url: 'https://developers.googleblog.com/introducing-code-wiki-accelerating-your-code-understanding/',
    },
    research: 'landscape',
  },
  {
    slug: 'opendeepwiki',
    name: 'OpenDeepWiki',
    category: 'Code context',
    relation: 'Research reference',
    idea: 'Repository documentation can be self-hosted and available to agents.',
    admiration:
      'OpenDeepWiki explores a more operator-controlled version of generated repository knowledge, including an agent-facing interface. It shows that discoverability and data ownership can coexist.',
    lesson:
      'An agent-readable explanation should expose the same provenance and limitations as the human page. A convenient MCP endpoint is a delivery mechanism, not evidence that an answer is true.',
    codevetter:
      'CodeVetter exposes Rust-owned receipts through CLI, MCP, and the native viewer. OpenDeepWiki was a research reference; it is not part of the application.',
    source: {
      label: 'OpenDeepWiki source repository',
      url: 'https://github.com/Flopsky/OpenDeepWiki',
    },
    research: 'landscape',
  },
  {
    slug: 'claude-code',
    name: 'Claude Code',
    category: 'Agent workflows',
    relation: 'Design reference',
    idea: 'An agent can discover context through targeted search and reads.',
    admiration:
      'Claude Code’s tool-driven workflow helped normalize a coding agent that explores the repository, edits files, and runs checks in one loop. Its review workflow also provides a clear comparison for AI-first review.',
    lesson:
      'The path from task to change is observable, but an agent’s own confidence is not a verdict. Independent, executable checks and explicit coverage are needed before calling the task complete.',
    codevetter:
      'CodeVetter can work with an installed Claude CLI and can evaluate its changes. It stores per-run evidence and does not treat a Claude review as independent proof of correctness.',
    source: {
      label: 'Claude Code overview',
      url: 'https://code.claude.com/docs/en/overview',
    },
    research: 'project-log',
  },
  {
    slug: 'codex',
    name: 'OpenAI Codex',
    category: 'Agent workflows',
    relation: 'Design reference',
    idea: 'An agent’s patch and its execution trace should be available for inspection.',
    admiration:
      'Codex’s task-oriented coding workflow makes it natural to delegate a change and inspect the resulting diff, commands, and tests. That creates the exact handoff CodeVetter was built to verify.',
    lesson:
      'Even when an agent reports successful tests, the verifier should bind those observations to the precise revision and test scope. A changed branch or missing environment changes what the claim means.',
    codevetter:
      'CodeVetter supports local Codex sessions as one input to verification. It is independent software and does not use Codex output itself as the final judge.',
    source: { label: 'OpenAI Codex', url: 'https://developers.openai.com/learn/codex' },
    research: 'project-log',
  },
  {
    slug: 'cursor',
    name: 'Cursor',
    category: 'Agent workflows',
    relation: 'Design reference',
    idea: 'Codebase navigation can feel immediate inside a coding workflow.',
    admiration:
      'Cursor made repository-aware editing feel accessible to many developers. Its ability to move from a question to relevant code is a useful interaction reference even for a separate verification product.',
    lesson:
      'Fast retrieval is valuable when it leads to inspectable files and a small next action. It should never let an inferred summary quietly become a claim about runtime behavior.',
    codevetter:
      'CodeVetter’s local graph and repo-query tools favor attributable source leads. It is a verifier alongside coding tools, not a Cursor extension or IDE replacement.',
    source: {
      label: 'Cursor documentation',
      url: 'https://cursor.com/docs',
    },
    research: 'landscape',
  },
  {
    slug: 'windsurf',
    name: 'Windsurf',
    category: 'Agent workflows',
    relation: 'Research reference',
    idea: 'An agent’s context has to be assembled from several live signals.',
    admiration:
      'Windsurf’s Cascade put retrieval, workspace state, rules, and recent activity into a single coding flow. Its context choices were useful material for our research into how agents understand a repository.',
    lesson:
      'A context system should know what is current, what came from memory, and what was directly read. Persistent notes can help, but stale notes require an explicit check against source.',
    codevetter:
      'Our graph and history receipts identify revisions and mark stale coverage. Windsurf is a research reference; no Cascade service is part of CodeVetter.',
    source: {
      label: 'Cascade documentation',
      url: 'https://docs.devin.ai/desktop/cascade/cascade',
    },
    research: 'landscape',
  },
  {
    slug: 'continue',
    name: 'Continue',
    category: 'Agent workflows',
    relation: 'Research reference',
    idea: 'The developer should be able to choose models and context sources.',
    admiration:
      'Continue’s context-provider model makes the source of an AI assistant’s context more explicit. The openness to different models and local setups is a useful reference for a product that should not depend on one provider.',
    lesson:
      'Provider choice is strongest when the evidence contract stays stable. Swapping a model should not change the meaning of a verification receipt or quietly change the rules for a verdict.',
    codevetter:
      'CodeVetter supports user-configured providers while Rust-owned schemas keep CLI, MCP, and viewer aligned. Continue was a design study, not an integration.',
    source: {
      label: 'Continue context providers',
      url: 'https://docs.continue.dev/customize/deep-dives/custom-providers',
    },
    research: 'landscape',
  },
  {
    slug: 'cline',
    name: 'Cline',
    category: 'Agent workflows',
    relation: 'Research reference',
    idea: 'Planning and acting benefit from a visible boundary.',
    admiration:
      'Cline’s Plan and Act workflow makes a consequential transition clear: first understand the task, then change code and run tools. That is a helpful reference for communicating what an agent is doing.',
    lesson:
      'A plan is useful evidence of intent, but it does not verify the implementation. The final check still has to inspect what changed and what actually ran.',
    codevetter:
      'CodeVetter records the task and exact agent change before executable verification. Cline is one of the coding-agent workflows we studied, not a bundled runtime.',
    source: {
      label: 'Cline Plan and Act',
      url: 'https://github.com/cline/cline/blob/main/docs/core-workflows/plan-and-act.mdx',
    },
    research: 'landscape',
  },
  {
    slug: 'gemini-cli',
    name: 'Gemini CLI',
    category: 'Agent workflows',
    relation: 'Research reference',
    idea: 'A terminal agent can keep planning, tools, and code changes in one inspectable loop.',
    admiration:
      'Gemini CLI’s open terminal workflow was part of our survey of agent tools. It illustrates how a developer can combine a large-context model with local search and controlled tool use.',
    lesson:
      'A context window is not a substitute for proving the changed behavior. The verifier needs explicit tests, exact source state, and the limitations of the run.',
    codevetter:
      'CodeVetter can verify changes made by terminal agents without adopting their internal planning model. Gemini CLI was studied as an agent workflow, not made a required companion.',
    source: {
      label: 'Gemini CLI source repository',
      url: 'https://github.com/google-gemini/gemini-cli',
    },
    research: 'landscape',
  },
  {
    slug: 'tree-sitter',
    name: 'Tree-sitter',
    category: 'Building blocks',
    relation: 'In the product',
    idea: 'Syntax trees make source relationships repeatable and fast enough for local tooling.',
    admiration:
      'Tree-sitter’s incremental parsing and language grammars offer a practical foundation for extracting symbols and source locations. It lets a tool build structural context without asking an LLM to invent the shape of the program.',
    lesson:
      'A parser gives syntax facts, not an oracle for behavior. Each extracted node and edge should retain its file and location, and unsupported languages should remain visible as a coverage boundary.',
    codevetter:
      'CodeVetter bundles pinned Tree-sitter grammar crates in its Rust structural graph. That graph feeds local navigation and evidence leads; runtime verification remains the authority for behavioral claims.',
    source: {
      label: 'Tree-sitter introduction',
      url: 'https://tree-sitter.github.io/tree-sitter/',
    },
    research: 'integration',
  },
  {
    slug: 'ast-grep',
    name: 'ast-grep',
    category: 'Building blocks',
    relation: 'In the product',
    idea: 'Structural search can express focused review rules more clearly than text matching.',
    admiration:
      'ast-grep makes syntax-aware search available as a straightforward CLI. It is well suited to small, inspectable rules over changed code rather than an opaque, sweeping analyzer.',
    lesson:
      'A rule match is a lead with a source location. An absent match does not mean the patch is safe; the rule may not cover the language, pattern, or behavior that matters.',
    codevetter:
      'CodeVetter can use an installed `sg` as an optional collector for narrow changed-file evidence. It falls back cleanly when absent and does not require ast-grep for the canonical graph.',
    source: { label: 'ast-grep CLI reference', url: 'https://ast-grep.github.io/reference/cli' },
    research: 'integration',
  },
  {
    slug: 'semgrep',
    name: 'Semgrep',
    category: 'Building blocks',
    relation: 'Research reference',
    idea: 'Security and bug patterns can be written as reviewable code-shaped rules.',
    admiration:
      'Semgrep’s rules demonstrate the power of describing a problem in a form close to the source being checked. That makes static findings easier to understand and audit.',
    lesson:
      'Static analysis is strongest with a selected rule pack and known scope. A generic scanner cannot turn every warning into a reproduced failure, and running more rules is not automatically better.',
    codevetter:
      'Our OSS decision parked Semgrep until specific rule packs justify its cost and packaging. CodeVetter’s current verification loop does not depend on Semgrep.',
    source: { label: 'Semgrep source repository', url: 'https://github.com/semgrep/semgrep' },
    research: 'integration',
  },
  {
    slug: 'codeql',
    name: 'CodeQL',
    category: 'Building blocks',
    relation: 'Research reference',
    idea: 'Deep code queries can reveal data flow and security relationships.',
    admiration:
      'CodeQL is a strong example of asking precise questions over a structured representation of code. Its query libraries show how much depth a specialized security analyzer can provide.',
    lesson:
      'Extraction and query scope are part of the result. A deep analyzer is valuable when its language support, database state, and findings can be connected to the exact change under review.',
    codevetter:
      'We evaluated CodeQL and parked a direct integration for a security-focused need. CodeVetter’s local graph is narrower and its verdict remains grounded in the checks actually run.',
    source: { label: 'CodeQL documentation', url: 'https://codeql.github.com/docs/' },
    research: 'integration',
  },
  {
    slug: 'ripgrep',
    name: 'ripgrep',
    category: 'Building blocks',
    relation: 'Research reference',
    idea: 'Fast, plain text search is often the right first step in code exploration.',
    admiration:
      'ripgrep proves the value of a small, dependable tool that does one job extremely well. Search gives both agents and people direct paths into source without a complex indexing service.',
    lesson:
      'Use the simplest search that answers the question, then read the file and verify the claim. A matching line is context, not proof that a runtime path was exercised.',
    codevetter:
      'Our integration decision permits opportunistic local search while keeping it optional. CodeVetter does not require ripgrep to be installed or confuse text matches with verified behavior.',
    source: { label: 'ripgrep source repository', url: 'https://github.com/BurntSushi/ripgrep' },
    research: 'integration',
  },
  {
    slug: 'gitnexus',
    name: 'GitNexus',
    category: 'Building blocks',
    relation: 'Research reference',
    idea: 'A code graph can be exposed as a useful interface for agents.',
    admiration:
      'GitNexus explores code knowledge graphs that an agent can query for relationships and flows. It was a useful comparison while we decided how much of our graph should be an owned local engine.',
    lesson:
      'The graph’s runtime and parser versions affect reproducibility. An optional external adapter can be useful, but the canonical evidence path should remain available offline.',
    codevetter:
      'The graph decision keeps CodeVetter’s Tree-sitter index in Rust and treats a GitNexus subprocess as optional secondary research. It is not required by the product.',
    source: {
      label: 'GitNexus source repository',
      url: 'https://github.com/abhigyanpatwari/GitNexus',
    },
    research: 'integration',
  },
  {
    slug: 'gitoxide',
    name: 'gitoxide',
    category: 'Building blocks',
    relation: 'Research reference',
    idea: 'Git history can be explored through an owned Rust interface.',
    admiration:
      'gitoxide is an ambitious Rust implementation of Git. Its library approach was worth considering for local history traversal and diff processing, where process boundaries and correctness both matter.',
    lesson:
      'An integration has to improve a measured bottleneck or capability. A cleaner dependency graph on paper does not justify replacing a working Git CLI path without parity evidence.',
    codevetter:
      'Our OSS review kept gitoxide on a watchlist. CodeVetter continues to use its current Git path for history evidence; gitoxide is not a production dependency.',
    source: {
      label: 'gitoxide source repository',
      url: 'https://github.com/GitoxideLabs/gitoxide',
    },
    research: 'integration',
  },
  {
    slug: 'scip',
    name: 'SCIP',
    category: 'Building blocks',
    relation: 'Research reference',
    idea: 'An interchange format can connect symbol and reference information across tools.',
    admiration:
      'SCIP gives code intelligence a portable vocabulary for symbols and references. That is appealing when a product needs to consume precise navigation data without reinventing every language indexer.',
    lesson:
      'An interchange format is useful only with reliable producers and a clear freshness contract. It should not be mistaken for a complete graph or a behavioral verifier.',
    codevetter:
      'We recorded SCIP as research only. CodeVetter’s canonical graph uses its own versioned Rust receipts and bundled parsers; no SCIP indexer is required.',
    source: { label: 'SCIP source repository', url: 'https://github.com/scip-code/scip' },
    research: 'integration',
  },
  {
    slug: 'codesize',
    name: 'codesize',
    category: 'Building blocks',
    relation: 'Research reference',
    idea: 'A tiny heuristic can still point a reviewer toward risky code.',
    admiration:
      'codesize was interesting because it suggests function size as one inexpensive maintainability and review signal. Small, transparent heuristics can be useful when they are clearly labeled as leads.',
    lesson:
      'Function size cannot predict a defect by itself. A signal should be calibrated against real outcomes and should never be presented as a proof of failure.',
    codevetter:
      'Our integration review decided not to depend on codesize. Repo Unpack’s health inventory remains explicitly heuristic and keeps defect, maintainability, and performance leads separate.',
    source: { label: 'codesize source repository', url: 'https://github.com/ChrisGVE/codesize' },
    research: 'integration',
  },
  {
    slug: 'unsupervised-finder',
    name: 'Unsupervised Finder',
    category: 'Verification',
    relation: 'Design reference',
    idea: 'Search a space of possible explanations before asking an agent to tell a story.',
    admiration:
      'Finder searches data for ranked patterns and gives an analyst evidence to investigate. The idea transfers well beyond analytics: a verifier can systematically surface contradictory claims, stale tests, and risky combinations before an LLM chooses what to inspect.',
    lesson:
      'Candidate generation should be repeatable and caveated. A ranked pattern is an investigation lead, and its scale, source, and unanswered questions should travel with it.',
    codevetter:
      'Evidence Pattern Search explicitly borrows this search-before-prose principle for changed files, sessions, command output, and prior findings. CodeVetter does not analyze customer warehouse data or run Finder.',
    source: { label: 'Unsupervised Finder', url: 'https://www.unsupervised.com/finder' },
    research: 'evidence-pattern',
  },
  {
    slug: 'deepwork',
    name: 'DeepWork',
    category: 'Verification',
    relation: 'Design reference',
    idea: 'Long agent tasks need explicit steps, artifacts, and quality gates.',
    admiration:
      'DeepWork turns a loosely worded task into a procedure with required steps and checks. That is a useful model for work that cannot be trusted merely because an agent produced a polished final answer.',
    lesson:
      'A procedure should say what each step consumes, what it produces, and what makes it pass. When a gate fails, the handoff should preserve the failure and the remaining questions.',
    codevetter:
      'CodeVetter’s Evidence Pattern Search design names DeepWork-style procedures for review, fix, QA, and handoff. That reference is about workflow structure; DeepWork is not a required runtime or dependency.',
    source: {
      label: 'DeepWork source repository',
      url: 'https://github.com/Unsupervisedcom/deepwork',
    },
    research: 'evidence-pattern',
  },
  {
    slug: 'llm-wiki',
    name: 'Karpathy’s LLM Wiki',
    category: 'Code context',
    relation: 'Design reference',
    idea: 'Knowledge can accumulate as a maintained, inspectable artifact.',
    admiration:
      'Andrej Karpathy’s LLM Wiki idea treats a body of knowledge as something an agent can maintain over time, rather than rediscovering the same relationships from scratch on every question. That compounding quality made it a direct reference for Review Memory.',
    lesson:
      'Memory only helps when a reader can tell which source and revision support a claim. An old observation should become stale when the code it describes changes.',
    codevetter:
      'The project log explicitly credits this pattern for Review Memory. The idea remains bounded by source fingerprints and staleness rules; this article does not claim the full proposal is shipped or that Karpathy built a CodeVetter integration.',
    source: {
      label: 'Karpathy’s LLM Wiki idea file',
      url: 'https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f',
    },
    research: 'project-log',
  },
];

const seen = new Set<string>();
for (const item of inspirations) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug) || seen.has(item.slug)) {
    throw new Error(`Invalid or duplicate inspiration slug: ${item.slug}`);
  }
  if (
    !item.idea ||
    !item.admiration ||
    !item.lesson ||
    !item.codevetter ||
    !item.source.url.startsWith('https://')
  ) {
    throw new Error(`Incomplete inspiration article: ${item.slug}`);
  }
  seen.add(item.slug);
}
