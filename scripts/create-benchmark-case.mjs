#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const out = {
    id: null,
    title: null,
    repo: null,
    prUrl: null,
    diffRange: null,
    outPath: null,
    force: false,
  };
  for (const arg of argv) {
    if (arg === '--force') {
      out.force = true;
    } else if (arg.startsWith('--id=')) {
      out.id = arg.slice('--id='.length);
    } else if (arg.startsWith('--title=')) {
      out.title = arg.slice('--title='.length);
    } else if (arg.startsWith('--repo=')) {
      out.repo = arg.slice('--repo='.length);
    } else if (arg.startsWith('--pr-url=')) {
      out.prUrl = arg.slice('--pr-url='.length);
    } else if (arg.startsWith('--diff-range=')) {
      out.diffRange = arg.slice('--diff-range='.length);
    } else if (arg.startsWith('--out=')) {
      out.outPath = arg.slice('--out='.length);
    }
  }
  return out;
}

function usage() {
  return [
    'Usage:',
    '  npm run bench:new-case -- --id=<case-id> --title=<title> --repo=<owner/repo-or-url> [--pr-url=<url>] [--diff-range=<base...head>] [--out=<path>] [--force]',
    '',
    'Creates one per-case benchmark JSON fixture. Fill TODO fields before running publishable gates.',
  ].join('\n');
}

function assertRequired(value, name, errors) {
  if (!value?.trim()) errors.push(`${name} is required`);
}

const args = parseArgs(process.argv.slice(2));
const errors = [];
assertRequired(args.id, '--id', errors);
assertRequired(args.title, '--title', errors);
assertRequired(args.repo, '--repo', errors);
if (errors.length) {
  console.error(usage());
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const caseId = args.id.trim();
if (!/^[a-z0-9][a-z0-9._-]*$/i.test(caseId)) {
  console.error('--id must be filesystem-safe: letters, numbers, dots, underscores, and dashes');
  process.exit(1);
}

const outPath = path.resolve(
  process.cwd(),
  args.outPath ?? path.join('benchmarks/agent-prs/cases', `${caseId}.json`)
);
if (fs.existsSync(outPath) && !args.force) {
  console.error(`Refusing to overwrite existing file: ${outPath}`);
  console.error('Pass --force to overwrite.');
  process.exit(1);
}

const benchmarkCase = {
  id: caseId,
  title: args.title.trim(),
  source: {
    repo: args.repo.trim(),
    pr_url: args.prUrl?.trim() || 'TODO-public-pr-url',
    public: true,
    diff_range: args.diffRange?.trim() || 'TODO-base...head',
    immutable_diff: {
      base_sha: 'TODO-full-base-sha',
      head_sha: 'TODO-full-head-sha',
      sha256: 'TODO-sha256-of-raw-diff',
    },
    license: {
      spdx: 'TODO-SPDX-id',
      url: 'TODO-public-license-url',
      verified_at: 'TODO-ISO-timestamp',
    },
    agent: 'TODO-agent-or-tool',
    agent_provenance: {
      kind: 'TODO-author-body-commit-or-session',
      evidence: 'TODO-public-evidence-that-the-pinned-change-was-agent-generated',
    },
    raw_diff_artifact: {
      url: 'TODO-immutable-public-diff-url',
      sha256: 'TODO-sha256-of-raw-diff',
      bytes: null,
    },
    review_output_artifacts: {
      codevetter: {
        status: 'TODO-captured-or-blocked_external',
        path: 'TODO-path-or-url-to-codevetter-output',
        tool: 'CodeVetter',
        version: 'TODO-version',
        tier: 'local',
        capture_method: 'TODO-production-pipeline-command',
        captured_at: 'TODO-ISO-timestamp',
        elapsed_ms: null,
        input_tokens: null,
        output_tokens: null,
        cost_usd: null,
        unverified_fix_count: null,
        blocker: null,
      },
      coderabbit_free: {
        status: 'TODO-captured-or-blocked_external',
        path: null,
        tool: 'CodeRabbit',
        version: 'TODO-version-or-unavailable',
        tier: 'free',
        capture_method: 'TODO-public-PR-review-or-exact-blocker',
        captured_at: null,
        elapsed_ms: null,
        input_tokens: null,
        output_tokens: null,
        cost_usd: null,
        unverified_fix_count: null,
        blocker: 'TODO-exact-external-blocker-if-not-captured',
      },
      claude_code_review: {
        status: 'TODO-captured-or-blocked_external',
        path: null,
        tool: 'Claude Code /review',
        version: 'TODO-version-or-unavailable',
        tier: 'TODO-account-tier',
        capture_method: 'TODO-local-command-or-exact-blocker',
        captured_at: null,
        elapsed_ms: null,
        input_tokens: null,
        output_tokens: null,
        cost_usd: null,
        unverified_fix_count: null,
        blocker: 'TODO-exact-external-blocker-if-not-captured',
      },
    },
  },
  impact: {
    customer_visible: null,
    area: 'TODO-product-area',
    severity_basis: 'TODO-concrete-user-or-system-impact',
  },
  adjudication: {
    status: 'TODO-adjudicated',
    method: 'TODO-manual-diff-and-evidence-review',
    adjudicators: [],
    decided_at: null,
    notes: 'TODO-why-the-labels-are-supported',
    exclusions: [],
  },
  ground_truth: [
    {
      id: 'TODO-issue-id',
      severity: 'medium',
      filePath: 'TODO/path/to/file',
      title: 'TODO hand-labeled issue title',
      evidence: 'TODO exact reason this is a real bug, with diff/test/user-impact evidence.',
      adjudication: 'TODO-confirmed-or-excluded',
      impact: 'TODO-concrete-impact',
    },
  ],
  reviews: {
    codevetter: [
      {
        severity: 'medium',
        filePath: 'TODO/path/to/file',
        title: 'TODO CodeVetter finding title',
        matched_ground_truth: ['TODO-issue-id'],
        match_rationale: 'TODO why this finding catches the ground-truth issue.',
      },
    ],
    coderabbit_free: [],
    claude_code_review: [],
  },
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(benchmarkCase, null, 2)}\n`);
console.log(`Created ${path.relative(process.cwd(), outPath)}`);
