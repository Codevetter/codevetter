import benchmark from '@/../public/benchmark/codevetter-benchmark-v1.json';
import results from '@/data/benchmark-results.json';
import examples from '@/data/xray-examples.json';
import docsIndexSource from '../../../../docs/index.md?raw';
import { verificationContent } from '@/data/verification-content';

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

const benchmarkResults = results.codevetter.overall;
const baselineResults = results['raw-claude'].overall;

const docsIndex = docsIndexSource.replace(/^---[\s\S]*?---\s*/, '').replaceAll('](./', '](/docs/');

const staticPages: Record<string, string> = {
  download: page(
    'Download CodeVetter',
    '/download',
    `CodeVetter is distributed as a native desktop application through GitHub Releases. It runs locally, requires no CodeVetter account, stores product state in local SQLite, and checks GitHub Releases for updates.

## Supported release artifacts

- macOS on Apple Silicon: \`CodeVetter_*_aarch64.dmg\`
- macOS on Intel: \`CodeVetter_*_x64.dmg\`
- Windows on x86_64: \`CodeVetter_*_x64-setup.exe\`
- Linux on x86_64: Debian package or AppImage

[Open the latest release](https://github.com/Codevetter/codevetter/releases/latest).`
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
  privacy: page(
    'CodeVetter privacy',
    '/privacy',
    `CodeVetter is a local desktop application. Repository context, diffs, notes, and review history are stored in a local SQLite database; CodeVetter has no hosted review server.

## External requests

- A configured LLM provider receives code and prompt content only when the user initiates a provider-backed review. The provider's privacy policy applies.
- The optional updater checks GitHub Releases for new versions.

## Telemetry and deletion

CodeVetter does not enable crash or usage telemetry by default. A user can remove local state by uninstalling the application and deleting its local application-data directory.`
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
  docs: `${docsIndex.trim()}

> Canonical rendered documentation: https://codevetter.com/docs/
`,
};

for (const content of Object.values(verificationContent)) {
  staticPages[content.path.replace(/^\//, '')] = page(
    content.title,
    content.path,
    content.markdown
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
