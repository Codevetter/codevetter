import type { EditorialContent } from '@/data/verification-content';

const repository = 'https://github.com/Significant-Hobbies/swe-interview-prep';
const before = '9cd5e5ebe84375277f0ff252052321024ec50e7b';
const repaired = '5f79e57fe99bfc22c576465214cf90881c71acab';
const sources = {
  change: `${repository}/pull/158`,
  before: `${repository}/blob/${before}/src/lib/publicEntry.ts#L13-L19`,
  repair: `${repository}/blob/${repaired}/src/lib/publicEntry.ts#L13-L35`,
  tests: `${repository}/blob/${repaired}/src/lib/publicEntry.test.ts#L8-L81`,
};
const replay = `git clone ${repository}.git swe-hydration-case
cd swe-hydration-case
git switch --detach ${repaired}
corepack pnpm install --frozen-lockfile
corepack pnpm exec vitest run src/lib/publicEntry.test.ts --reporter=json`;
const regression = `git show ${before}:src/lib/publicEntry.ts > src/lib/publicEntry.ts
corepack pnpm exec vitest run src/lib/publicEntry.test.ts --reporter=json
# Expected: two failing cases. Restore the repaired file afterward.
git restore --source=${repaired} -- src/lib/publicEntry.ts
corepack pnpm exec vitest run src/lib/publicEntry.test.ts --reporter=json`;

export const hydrationCaseContent: EditorialContent = {
  title: 'A React hydration race that left the page hidden',
  seoTitle: 'React hydration race: hidden-root regression | CodeVetter',
  description:
    'A CodeVetter review caught a React startup race. Inspect the public repair, before-and-after evidence, and replayable hydration regression tests.',
  path: '/articles/react-hydration-hidden-root-regression',
  intent:
    'debug a React page that stays hidden when localStorage changes before hydration; inspect a reproducible agent-change verification case',
  schema: ['TechArticle', 'BreadcrumbList'],
  internalLinks: [
    '/verify-ai-generated-code',
    '/verification-evidence-bundle',
    '/benchmark',
    '/download',
  ],
  markdown: `Last updated: 2026-10-31

A CodeVetter review of [SWE Interview Prep PR #158](${sources.change}) surfaced a startup race: removing a saved profile or progress before bootstrap could select hydration while the page root stayed hidden. The finding was then checked with the repository's visibility tests. **Before the repair: two failed, two passed. After the repair: all four passed.**

This is one observed review-and-reproduction workflow, not a catch-rate benchmark. [Inspect the redacted evidence summary](/examples/hydration-visibility-case.json) or [replay the checks](#reproduce-in-a-disposable-clone).

## How the page could stay hidden

An early script decided whether to show a prerendered public page. A visitor with saved learner state took a different path: the prerendered root kept its visibility guard while the client prepared the returning-user experience.

Bootstrap checked eligibility again. If the saved profile or progress had disappeared in between, the fresh decision now allowed the public page. The [reviewed guard](${sources.before}) checked that fresh decision and the root marker, but omitted the original decision. It could therefore choose hydration for a root that the early script had kept hidden.

This is a transition bug. Testing a guest from an empty storage state, or a returning learner whose state never changes, does not exercise the same sequence.

## What established the failure

The [regression tests](${sources.tests}) read the actual visibility CSS from the application's index.html. They run the early-entry script with a saved profile or progress, remove that state before bootstrap, and check both the hydration decision and the root's computed display.

The vulnerable guard returned hydrate: true with display: none in those two cases. The expected fallback was hydrate: false with display: block. The same four-check target passed after the repair. These are recorded local Vitest/happy-dom results, not measurements of real-user traffic or a browser compatibility study.

## The repair preserves both decisions

The [repaired guard](${sources.repair}) requires the original state.prerender decision as well as current entry.prerender eligibility. If either disallows hydration, it removes the prerender marker and clears the old children so normal client rendering can take over visibly.

The other checks retain real anchor destinations, hand one early Settings intent to the actual modal, and cover a profile arriving before bootstrap. React's [hydrateRoot documentation](https://react.dev/reference/react-dom/client/hydrateRoot) explains why hydration must attach to matching initial HTML; it is not a substitute for checking this application's visibility rules.

## Reproduce in a disposable clone

Use a new clone: the second block deliberately replaces one source file. The repository pins pnpm 10.33.2. First run the repaired version:

\`\`\`bash
${replay}
\`\`\`

To retain the repaired regression tests while trying the reviewed vulnerable guard, replace only publicEntry.ts. The middle command is expected to exit nonzero; then restore the repaired file and run again:

\`\`\`bash
${regression}
\`\`\`

This replays the focused test target, not the original model-backed review. The [public evidence summary](/examples/hydration-visibility-case.json) records the original before/after counts and pinned sources without exposing private review logs.

## What to take into your own agent workflow

When an agent changes startup or persistence behavior, write down the state transition you need to preserve. Bind the exact change, reproduce a suspected failure with repository-owned checks, and keep both the failing and passing results. A review finding identifies a risk; execution establishes the behavior those checks actually cover.

The four checks qualify this startup repair; broader browser behavior and user outcomes need separate evidence. [Download CodeVetter](/download?utm_source=case-study&utm_medium=owned&utm_campaign=hydration-visibility) to inspect an agent change locally, or follow the [AI-code verification recipe](/verify-ai-generated-code#worked-example).
`,
  html: `<p class="font-mono text-xs">Observed 31 October 2026 · one public-repository case</p>
<p>A CodeVetter review of <a href="${sources.change}">SWE Interview Prep PR #158</a> surfaced a startup race: removing a saved profile or progress before bootstrap could select hydration while the page root stayed hidden. The finding was then checked with the repository's visibility tests. <strong>Before the repair: two failed, two passed. After the repair: all four passed.</strong></p>
<p>This is one observed review-and-reproduction workflow, not a catch-rate benchmark. <a href="/examples/hydration-visibility-case.json" data-log="verification_proof_opened">Inspect the redacted evidence summary</a> or <a href="#reproduce-in-a-disposable-clone" data-log="verification_recipe_opened">replay the checks</a>.</p>
<h2>How the page could stay hidden</h2>
<p>An early script decided whether to show a prerendered public page. A visitor with saved learner state took a different path: the prerendered root kept its visibility guard while the client prepared the returning-user experience.</p>
<p>Bootstrap checked eligibility again. If the saved profile or progress had disappeared in between, the fresh decision now allowed the public page. The <a href="${sources.before}">reviewed guard</a> checked that fresh decision and the root marker, but omitted the original decision. It could therefore choose hydration for a root that the early script had kept hidden.</p>
<p>This is a transition bug. Testing a guest from an empty storage state, or a returning learner whose state never changes, does not exercise the same sequence.</p>
<h2>What established the failure</h2>
<p>The <a href="${sources.tests}">regression tests</a> read the actual visibility CSS from the application's <code>index.html</code>. They run the early-entry script with a saved profile or progress, remove that state before bootstrap, and check both the hydration decision and the root's computed display.</p>
<p>The vulnerable guard returned <code>hydrate: true</code> with <code>display: none</code> in those two cases. The expected fallback was <code>hydrate: false</code> with <code>display: block</code>. The same four-check target passed after the repair. These are recorded local Vitest/happy-dom results, not measurements of real-user traffic or a browser compatibility study.</p>
<h2>The repair preserves both decisions</h2>
<p>The <a href="${sources.repair}">repaired guard</a> requires the original <code>state.prerender</code> decision as well as current <code>entry.prerender</code> eligibility. If either disallows hydration, it removes the prerender marker and clears the old children so normal client rendering can take over visibly.</p>
<p>The other checks retain real anchor destinations, hand one early Settings intent to the actual modal, and cover a profile arriving before bootstrap. React's <a href="https://react.dev/reference/react-dom/client/hydrateRoot">hydrateRoot documentation</a> explains why hydration must attach to matching initial HTML; it is not a substitute for checking this application's visibility rules.</p>
<h2 id="reproduce-in-a-disposable-clone">Reproduce in a disposable clone</h2>
<p>Use a new clone: the second block deliberately replaces one source file. The repository pins pnpm 10.33.2. First run the repaired version:</p>
<pre class="whitespace-pre-wrap [overflow-wrap:anywhere]"><code>${replay}</code></pre>
<p>To retain the repaired regression tests while trying the reviewed vulnerable guard, replace only <code>publicEntry.ts</code>. The middle command is expected to exit nonzero; then restore the repaired file and run again:</p>
<pre class="whitespace-pre-wrap [overflow-wrap:anywhere]"><code>${regression.replace(' > ', ' &gt; ')}</code></pre>
<p>This replays the focused test target, not the original model-backed review. The <a href="/examples/hydration-visibility-case.json" data-log="verification_proof_opened">public evidence summary</a> records the original before/after counts and pinned sources without exposing private review logs.</p>
<h2>What to take into your own agent workflow</h2>
<p>When an agent changes startup or persistence behavior, write down the state transition you need to preserve. Bind the exact change, reproduce a suspected failure with repository-owned checks, and keep both the failing and passing results. A review finding identifies a risk; execution establishes the behavior those checks actually cover.</p>
<p>The four checks qualify this startup repair; broader browser behavior and user outcomes need separate evidence. <a href="/download?utm_source=case-study&amp;utm_medium=owned&amp;utm_campaign=hydration-visibility" data-log="verification_install_opened">Download CodeVetter</a> to inspect an agent change locally, or follow the <a href="/verify-ai-generated-code#worked-example" data-log="verification_recipe_opened">AI-code verification recipe</a>.</p>`,
};
