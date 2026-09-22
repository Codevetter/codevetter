import benchmark from '@/../public/benchmark/codevetter-benchmark-v1.json';
import results from '@/data/benchmark-results.json';
import examples from '@/data/xray-examples.json';
import unpackReports from '@/data/unpack-reports.json';
import unpackPairs from '@/data/unpack-pairs.json';
import docsIndexSource from '../../../../docs/index.md?raw';
import { verificationContent } from '@/data/verification-content';
import { articlesContent } from '@/data/articles-content';
import { currentReleaseUrl, publishedRelease, updateSummary } from '@/data/release';
import { privacyMarkdownBody, privacyPolicy } from '@/data/privacy';
import {
  optimizationCaseStudies,
  type OptimizationCaseStudy,
} from '@/data/optimization-case-studies';

const SITE_URL = 'https://codevetter.com';

function page(title: string, canonicalPath: string, body: string): string {
  const canonical = `${SITE_URL}${canonicalPath}`;
  return `# ${title}

> Canonical page: ${canonical}

${body.trim()}

## Public product links

- [CodeVetter](https://codevetter.com/)
- [Download](https://codevetter.com/download)
- [Documentation](https://codevetter.com/docs/)
- [Source](https://github.com/Codevetter/codevetter)
`;
}

function optimizationCaseStudyBody(study: OptimizationCaseStudy): string {
  return `${study.summary}

## Result

- Decision: ${study.decision}
- Observation date: ${study.date}
- Primary metric: ${study.primaryMetric.label} — ${study.primaryMetric.value}
- Measurement note: ${study.primaryMetric.note}
- Availability: ${study.availability}

## Tested boundary

- Flow: ${study.testedFlow}
- Source: ${study.source}
- Revision: ${study.revision}
- Correctness: ${study.correctness}
- Patch cost: ${study.changeCost.files} file${study.changeCost.files === 1 ? '' : 's'}, ${study.changeCost.gross} gross changed lines, net ${study.changeCost.net}, ${study.changeCost.dependencies} production dependencies

## Decision path

${study.process.map((step) => `- **${step.title} (${step.decision}):** ${step.evidence}`).join('\n')}

## Limitations

${study.limitations.map((limitation) => `- ${limitation}`).join('\n')}`;
}

const benchmarkResults = results.codevetter.overall;
const baselineResults = results['raw-claude'].overall;

const docsIndex = docsIndexSource.replace(/^---[\s\S]*?---\s*/, '').replaceAll('](./', '](/docs/');

const staticPages: Record<string, string> = {
  download: page(
    'Download CodeVetter',
    '/download',
    `CodeVetter is distributed as a native SwiftUI/AppKit macOS application through GitHub Releases. It runs locally, requires no CodeVetter account, and stores product state in local SQLite. ${updateSummary}

## Supported release artifacts

${
  publishedRelease
    ? `- macOS 14 or newer on Apple Silicon: \`${publishedRelease.installer}\` (drag-to-Applications installer)${publishedRelease.updateArchive ? ` and \`${publishedRelease.updateArchive}\` (the Sparkle update archive)` : ''}, published on ${publishedRelease.tag}. Developer ID signed and notarized.`
    : '- macOS 14 or newer on Apple Silicon: the Apple-silicon DMG attached to the newest GitHub release. Developer ID signed and notarized.'
}

The current public release does not contain Intel macOS, Windows, Linux, or
Homebrew installers. The repository remains available for source inspection
and local builds.

[Open the latest release](${currentReleaseUrl}).`
  ),
  faq: page(
    'CodeVetter FAQ',
    '/faq',
    `## What is CodeVetter?

CodeVetter is an execution-backed verification and evaluation system for coding agents. Its core loop is task, agent change, executable verification, evidence, and a measurable verdict. CLI, MCP, and machine-readable verification bundles are primary product surfaces; the desktop app is a local viewer.

## Does CodeVetter upload repositories to its own server?

No. CodeVetter has no hosted review backend. Repository context, review history, and product state remain on the local machine. When a user explicitly invokes an external model provider, that provider receives the request under its own policy.

## Which coding agents and model providers can it work with?

The desktop work surface can supervise installed Codex and Claude CLIs. Review supports user-configured Anthropic, OpenAI, and OpenRouter providers. Provider availability and account policy remain external to CodeVetter.

## What evidence does a review retain?

Findings can retain source anchors, command or test evidence, verification state, and portable proof exports. Missing, waived, stale, and unverified stages stay explicit rather than being presented as successful.

## Is there a public benchmark?

Yes. The public synthetic benchmark contains ${benchmark.case_count} hand-labeled cases and ${benchmark.expected_findings_total} expected findings. Its cases, labels, reviewer outputs, and scorer are published so the result can be reproduced.`
  ),
  benchmark: page(
    'AI code review benchmark for agent-written code',
    '/benchmark',
    `CodeVetter publishes a reproducible recognition benchmark for AI code review and security analysis. Its 27 synthetic cases are designed for transparent issue-type coverage and precise false-positive accounting, not as proof of performance on a large production pull request.

## How to interpret the score

- Inspect whether the corpus is synthetic or production-derived and what languages and issue classes it includes.
- Inspect whether ground truth comes from human labels, regression tests, or model judges.
- Read catch rate together with precision and false positives.
- Do not compare per-finding, per-pull-request, and per-task scores as if they were interchangeable.
- Prefer benchmarks that publish cases, outputs, scoring rules, and limitations.

CodeVetter v1 optimizes for reproducibility: every case and expected finding is published, and false positives and redundant matches count against precision. The corpus is small, mostly one finding per case, synthetic, labeled by one person, and does not measure latency or cost.

## Dataset

- ${benchmark.case_count} hand-labeled cases
- ${benchmark.expected_findings_total} expected findings
- Languages: ${benchmark.languages.join(', ')}
- Categories: ${benchmark.categories.join(', ')}
- Released: ${benchmark.released}
- License: ${benchmark.license}

## Recorded results

- CodeVetter: ${benchmarkResults.totalCaught}/${benchmarkResults.totalExpected} findings caught (${(benchmarkResults.catchRate * 100).toFixed(1)}% catch rate), precision ${benchmarkResults.precision.toFixed(3)}, F1 ${benchmarkResults.f1.toFixed(3)}
- Raw Claude baseline: ${baselineResults.totalCaught}/${baselineResults.totalExpected} findings caught (${(baselineResults.catchRate * 100).toFixed(1)}% catch rate), precision ${baselineResults.precision.toFixed(3)}, F1 ${baselineResults.f1.toFixed(3)}

Use this result as an inspectable check of known-issue recognition. Use the separate real-agent-PR evaluation work for repository-scale claims.

[Download the benchmark dataset](${SITE_URL}/benchmark/codevetter-benchmark-v1.json).`
  ),
  optimize: page(
    'Optimize local application flows with runtime evidence',
    '/optimize',
    `CodeVetter gives a coding agent a bounded loop for finding a local bottleneck, proposing one small experiment, and retaining it only when correctness and repeated before/after evidence agree.

## The bounded loop

1. Discover one executable local test or benchmark flow.
2. Measure repeatable timing, CPU, allocation, and memory evidence supported by that flow.
3. Diagnose source-backed bottlenecks while separating observation from inference.
4. Experiment with one bounded candidate and reject disproportionate patches.
5. Verify exact correctness and repeated before/after measurements before retaining anything.

The compact current path targets repository-owned JavaScript, Node.js, and Go tests and benchmarks. It does not turn a plausible edit, a noisy measurement, or a synthetic result into a production performance claim.`
  ),
  'benchmark/optimization': page(
    'Optimization benchmarks and case studies',
    '/benchmark/optimization',
    `These dated local trials have separate evidence boundaries rather than one blended headline. Each case study names the exact flow, revision, source candidate, patch cost, correctness scope, repeated measurement, decision, availability, and limitations.

${optimizationCaseStudies.map((study) => `- [${study.project}](${SITE_URL}/benchmark/optimization/${study.slug}) — ${study.decision}: ${study.summary}`).join('\n')}

A rejected experiment remains visible. Historical research capability is labeled separately from the compact runtime path currently shipped in CodeVetter.`
  ),
  changelog: page(
    'CodeVetter changelog',
    '/changelog',
    `This curated changelog records shipped user-visible outcomes. Planned work remains in [GitHub Issues](https://github.com/Codevetter/codevetter/issues).

## 2026-07-26 — Focused on executable verification

- CodeVetter now centers on proving whether coding agents completed a task correctly with reproducible runtime evidence.
- CLI, MCP, and machine-readable verification bundles are primary surfaces; the desktop app remains a local viewer.

## 2026-07-25 — Complete local verification loop

- Reviews can retain local sessions, recover managed runs, record intent closure, and produce evidence-owned artifact previews.
- A public agent-PR corpus and redacted performance receipts support reproducible regression and reliability comparisons.

## 2026-07-24 — Deterministic Review and Agent PR X-Ray

- Broad reviews cover changed files through bounded, checkpointed verification units.
- Completed reviews can export fail-closed JSON, Markdown, and self-contained offline HTML evidence.

## 2026-07-21 — Conversation-first Work

- Codex and Claude sessions gained provider-aware controls, attention states, searchable history, and safe archiving.
- A local Plan, Build, Review, Verify, Done board keeps sessions attached to repository context.`
  ),
  // Projected from src/data/privacy.ts so /privacy.md cannot drift from the
  // /privacy HTML page. Edit the policy there, never here (#254).
  privacy: page(privacyPolicy.title, privacyPolicy.path, privacyMarkdownBody()),
  about: page(
    'About CodeVetter',
    '/about',
    `CodeVetter is an execution-backed verification and evaluation system for coding agents. It determines whether an agent completed a software task correctly using reproducible runtime evidence — not another LLM opinion. The review pipeline runs locally in a native macOS app; your repository never hits a CodeVetter server.

## What it does

The core loop is: task → agent change → executable verification → evidence → measurable verdict. CodeVetter runs tests, type checks, builds, and profiling against the agent's diff, then produces a portable evidence bundle that proves whether the task is done.

## Open source

CodeVetter is open-source under the ISC license. The source lives at github.com/Codevetter/codevetter. The current Apple-silicon macOS build and updater archive are published via GitHub Releases.

## Built by

Sarthak Agrawal — AI infrastructure and product engineer. More at sarthakagrawal.dev.

## Public benchmark

CodeVetter maintains a public benchmark of reproducible verification cases, a scorer, and published results with documented limitations.`
  ),
  contact: page(
    'Contact CodeVetter',
    '/contact',
    `CodeVetter is open-source and local-first. The fastest way to get help or report a bug is GitHub Issues.

## GitHub

- github.com/Codevetter/codevetter/issues — bug reports, feature requests, and verification case contributions
- github.com/Codevetter/codevetter — source code and releases

## Email

sarthakagrawal@agentmail.to

## Social

- @sarthakcodes on X
- sarthakagrawal.dev — personal site

## Agent email

For agent-to-agent or directory verification, use sarthakagrawal@agentmail.to.`
  ),
  terms: page(
    'CodeVetter terms of use',
    '/terms',
    `CodeVetter is open-source desktop software distributed under the ISC License. Source and release binaries are provided as-is.

Code review and verification output is assistive, not authoritative. Users remain responsible for the software they ship and should not treat CodeVetter as a substitute for human review or security testing.

When a user invokes Claude, Codex, Gemini, or another external CLI or provider, that provider's terms apply to the external request. CodeVetter does not store repositories on a central server.`
  ),
  xray: page(
    'Agent PR X-Ray examples',
    '/xray',
    `Agent PR X-Rays are static, portable exports from completed local reviews. They retain evidence state and keep failed, waived, missing, and unverified stages visible.

The public examples below use adjudicated synthetic benchmark ground truth. They are not claims about uploaded or private repositories.

${examples.map((example) => `- [${example.title}](${SITE_URL}/xray/${example.id}) — ${example.finding.summary}`).join('\n')}`
  ),
  docs: page('CodeVetter docs', '/docs/', docsIndex),
};

staticPages.articles = page(
  'CodeVetter articles',
  '/articles',
  `Editorial articles on execution-backed coding-agent verification, reproducible evidence, and verification receipts.

${Object.values(articlesContent)
  .map((article) => `- [${article.title}](${SITE_URL}${article.path}) — ${article.description}`)
  .join('\n')}`
);

for (const content of Object.values(verificationContent)) {
  staticPages[content.path.replace(/^\//, '')] = page(
    content.title,
    content.path,
    content.markdown
  );
}

for (const content of Object.values(articlesContent)) {
  staticPages[content.path.replace(/^\//, '')] = page(
    content.title,
    content.path,
    content.markdown
  );
}

const unpackBody = (report: (typeof unpackReports)[number]) => {
  const lines = [
    `This is a deterministic Repo Unpack scan of ${report.repo} — a structural map, not a review, security audit, or maintainer-endorsed description.`,
    '',
    `- Scanned commit: ${report.commit.sha} (${report.commit.date})`,
    `- Last upstream commit: ${report.commit.subject}`,
    `- Generated by ${report.codevetterVersion} on ${report.collectedAt.slice(0, 10)}`,
    `- ${report.stats.filesScanned} files scanned · ${report.stats.size}`,
    '',
    '## Languages',
    '',
    ...report.languages.map((l) => `- ${l.language}: ${l.files} files`),
    '',
    '## Repository structure',
    '',
    ...report.topDirs.map((d) => `- ${d.path}/ — ${d.file_count} files`),
  ];
  if (report.probableEntry) {
    lines.push(
      '',
      `Probable source entrypoint: \`${report.probableEntry}\` (inferred from the tree, not upstream docs)`
    );
  }
  if (report.sourceLayout) {
    lines.push(
      '',
      `## Source layout — ${report.sourceLayout.path}/`,
      '',
      ...report.sourceLayout.children.map(
        (c) =>
          `- ${c.is_dir ? `${c.path}/` : c.path} — ${c.file_count} file${c.file_count === 1 ? '' : 's'}`
      )
    );
  }
  if (report.manifest) {
    lines.push(
      '',
      '## Package',
      '',
      `- ${report.manifest.path}: ${report.manifest.name}${report.manifest.version ? ` v${report.manifest.version}` : ''} — ${report.manifest.dependencyCount} declared dependencies`
    );
  }
  if (report.health) {
    lines.push(
      '',
      '## Structural health signals',
      '',
      `Average score ${report.health.averageScore}/10 across ${report.health.filesAnalyzed} files; ${report.health.hotspotCount} hotspots. These are deterministic review leads, not proof of a bug.`
    );
  }
  if (report.history.length > 0) {
    lines.push(
      '',
      '## Recent history',
      '',
      ...report.history.map((c) => `- ${c.sha} (${c.date}) ${c.subject}`)
    );
  }
  if (report.sections) {
    const titles = {
      overview: 'Overview',
      system_map: 'System map',
      feature_catalog: 'Feature catalog',
      data_flow: 'Data flow',
      behavior_traces: 'Behavior traces',
      testing_signals: 'Testing signals',
      risk_map: 'Risk map',
      extension_points: 'Extension points',
      agent_handoff: 'Contributor handoff',
    };
    for (const [key, title] of Object.entries(titles)) {
      const section = report.sections[key];
      if (!section) continue;
      lines.push('', `## ${title}`, '', section.summary ?? '');
      for (const claim of section.claims ?? []) {
        const srcs = (claim.sources ?? [])
          .map(
            (s) =>
              `[${s}](https://github.com/${report.repo}/blob/${report.commit.sha}/${s.split('#')[0]})`
          )
          .join(' ');
        lines.push(
          `- ${claim.claim}${claim.kind === 'inference' ? ' (inferred)' : ''}${srcs ? ` — ${srcs}` : ''}`
        );
      }
    }
  }
  lines.push(
    '',
    `Source repository: https://github.com/${report.repo}`,
    `Full evidence corpus: https://github.com/Codevetter/codevetter/tree/main/benchmarks/repo-unpacks/${report.slug}.json`
  );
  return lines.join('\n');
};

staticPages.unpack = page(
  'Repo Unpack evidence',
  '/unpack',
  `Deterministic Repo Unpack scans of well-known open-source repositories at pinned commits.

${unpackReports.map((r) => `- [${r.repo}](${SITE_URL}/unpack/${r.slug}) — ${r.stats.filesScanned} files, commit ${r.commit.sha.slice(0, 7)} (${r.commit.date})`).join('\n')}`
);

const SECTION_MD_TITLES: Record<string, string> = {
  system_map: 'System map',
  feature_catalog: 'Feature catalog',
  data_flow: 'Data flow',
  behavior_traces: 'Behavior traces',
  testing_signals: 'Testing signals',
  risk_map: 'Risk map',
  extension_points: 'Extension points',
  agent_handoff: 'Contributor handoff',
};

for (const report of unpackReports) {
  staticPages[`unpack/${report.slug}`] = page(
    `${report.repo} — codebase unpack`,
    `/unpack/${report.slug}`,
    unpackBody(report)
  );
  if (!report.sections) continue;
  for (const [key, title] of Object.entries(SECTION_MD_TITLES)) {
    const section = (
      report.sections as Record<
        string,
        { summary?: string; claims?: { claim: string; sources?: string[]; kind?: string }[] }
      >
    )[key];
    if (!section) continue;
    const lines = [
      `# ${title} — ${report.repo}`,
      '',
      `Scanned commit ${report.commit.sha} (${report.commit.date}). Generated by codevetter ${report.codevetterVersion} on ${report.collectedAt.slice(0, 10)}.`,
      '',
      section.summary ?? '',
    ];
    for (const claim of section.claims ?? []) {
      const srcs = (claim.sources ?? [])
        .map(
          (s) =>
            `[${s}](https://github.com/${report.repo}/blob/${report.commit.sha}/${s.split('#')[0]})`
        )
        .join(' ');
      lines.push(
        `- ${claim.claim}${claim.kind === 'inference' ? ' (inferred)' : ''}${srcs ? ` — ${srcs}` : ''}`
      );
    }
    lines.push(
      '',
      'Every claim cites the file(s) it was read from at the pinned commit. Independent CodeVetter scan — not reviewed by upstream maintainers.'
    );
    staticPages[`unpack/${report.slug}/${key.replace(/_/g, '-')}`] = page(
      `${title} — ${report.repo}`,
      `/unpack/${report.slug}/${key.replace(/_/g, '-')}`,
      lines.join('\n')
    );
  }
}

for (const pair of unpackPairs) {
  const a = unpackReports.find((r) => r.slug === pair.a);
  const b = unpackReports.find((r) => r.slug === pair.b);
  if (!a || !b) continue;
  const slug = `unpack/compare/${a.slug}-vs-${b.slug}`;
  const lines = [
    `# ${a.name} vs ${b.name} — codebase comparison`,
    '',
    pair.angle,
    '',
    `| | ${a.repo} | ${b.repo} |`,
    `|---|---|---|`,
    `| Scanned commit | ${a.commit.sha.slice(0, 7)} (${a.commit.date}) | ${b.commit.sha.slice(0, 7)} (${b.commit.date}) |`,
    `| Files | ${a.stats.filesScanned} | ${b.stats.filesScanned} |`,
    `| Primary source root | ${a.sourceRoots?.[0]?.path ?? '—'} | ${b.sourceRoots?.[0]?.path ?? '—'} |`,
    '',
    `## ${a.name}`,
    '',
    (a.sections?.overview?.summary as string) ?? a.readmePreview ?? '',
    '',
    `## ${b.name}`,
    '',
    (b.sections?.overview?.summary as string) ?? b.readmePreview ?? '',
    '',
    `Full evidence: https://codevetter.com/unpack/${a.slug} · https://codevetter.com/unpack/${b.slug}`,
  ];
  staticPages[slug] = page(
    `${a.name} vs ${b.name} — codebase comparison`,
    `/${slug}`,
    lines.join('\n')
  );
}

for (const study of optimizationCaseStudies) {
  const path = `/benchmark/optimization/${study.slug}`;
  staticPages[path.slice(1)] = page(
    `${study.project} optimization case study`,
    path,
    optimizationCaseStudyBody(study)
  );
}

for (const example of examples) {
  staticPages[`xray/${example.id}`] = page(
    `${example.title} — Agent PR X-Ray`,
    `/xray/${example.id}`,
    `This is an adjudicated synthetic benchmark example, not a claim about an uploaded repository.

## Source

- Corpus: ${example.source}
- Language: ${example.language}
- Category: ${example.category}
- Evidence state: ${example.corpusState}

## Finding

- Severity: ${example.finding.severity}
- Title: ${example.finding.title}
- Summary: ${example.finding.summary}
- Source anchor: \`${example.finding.file}:${example.finding.line}\`

## Verification boundary

The static finding is qualified against benchmark ground truth. No exact-current executable test or audience validation is included in this example, so those stages remain unverified.`
  );
}

export const agentMarkdownPages = staticPages;
