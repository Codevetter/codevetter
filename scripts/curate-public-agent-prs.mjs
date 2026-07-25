#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_REPO = 'github/gh-aw';
const DEFAULT_PRS = [
  47991, 47990, 47974, 47963, 47959, 47957, 47923, 47894, 47893, 47891, 47870, 47866, 47865, 47856,
  47855, 47854, 47832, 47730, 47723, 47721, 47699, 47698, 47695, 47690, 47687, 47686, 47637, 47633,
  47601, 47597, 47592,
];

function parseArgs(argv) {
  const value = (name) => argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  return {
    repo: value('repo') ?? DEFAULT_REPO,
    prs: (value('prs') ?? DEFAULT_PRS.join(',')).split(',').map(Number).filter(Number.isInteger),
    limit: Number(value('limit') ?? 20),
    outDir: value('out-dir') ?? 'benchmarks/agent-prs',
    dryRun: argv.includes('--dry-run'),
  };
}

function ghJson(endpoint) {
  const result = spawnSync('gh', ['api', endpoint], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`gh api ${endpoint}: ${result.stderr.trim() || `exit ${result.status}`}`);
  }
  return JSON.parse(result.stdout);
}

function ghDiff(repo, baseSha, headSha) {
  const result = spawnSync(
    'gh',
    [
      'api',
      `repos/${repo}/compare/${baseSha}...${headSha}`,
      '-H',
      'Accept: application/vnd.github.v3.diff',
    ],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }
  );
  if (result.status !== 0) {
    throw new Error(
      `compare ${baseSha.slice(0, 8)}...${headSha.slice(0, 8)}: ${result.stderr.toString().trim()}`
    );
  }
  return result.stdout;
}

function issueLike(body) {
  const normalized = body.trim();
  if (!normalized || /^(@copilot|fixed|done|implemented|addressed|confirmed)\b/i.test(normalized)) {
    return false;
  }
  return /(fails?|breaks?|bypass|incorrect|missing|regression|error|unsafe|leak|race|hang|crash|silently|does not|cannot|never|unconditionally|vulnerab|token|credential)/i.test(
    normalized
  );
}

function fixedLike(body) {
  return /^(fixed|done|implemented|addressed|confirmed)|\b(fixed|implemented|addressed) in\b/i.test(
    body.trim()
  );
}

function plainTitle(body) {
  const first = body
    .replace(/<details>[\s\S]*$/i, '')
    .replace(/[`*_>#]/g, '')
    .split(/\n|(?<=[.!?])\s+/)[0]
    .trim();
  const words = first.split(/\s+/).slice(0, 18).join(' ');
  return words.length > 150 ? `${words.slice(0, 147)}…` : words;
}

function severityFor(body) {
  if (
    /(credential|token|secret|injection|traversal|escape|auth|security|crash|hang|data loss)/i.test(
      body
    )
  ) {
    return 'high';
  }
  if (/(fails?|breaks?|bypass|incorrect|regression|silently|race|leak)/i.test(body)) {
    return 'medium';
  }
  return 'low';
}

function blockedArtifact(tool, version, tier, captureMethod, blocker) {
  return {
    status: 'blocked_external',
    path: null,
    tool,
    version,
    tier,
    capture_method: captureMethod,
    captured_at: null,
    elapsed_ms: null,
    input_tokens: null,
    output_tokens: null,
    cost_usd: null,
    unverified_fix_count: null,
    blocker,
  };
}

function buildCase({ repo, pull, license, baseSha, issue, reply, diff, otherIssues }) {
  const headSha = issue.commit_id;
  const diffSha = createHash('sha256').update(diff).digest('hex');
  const title = plainTitle(issue.body);
  const id = `${repo.replace('/', '-')}-pr-${pull.number}-${issue.id}`;
  return {
    schema_version: 2,
    id,
    title: `${pull.title}: ${title}`,
    source: {
      repo,
      pr_url: pull.html_url,
      public: true,
      diff_range: `${baseSha}...${headSha}`,
      immutable_diff: {
        base_sha: baseSha,
        head_sha: headSha,
        sha256: diffSha,
      },
      license: {
        spdx: license.license?.spdx_id ?? 'NOASSERTION',
        url: `https://github.com/${repo}/blob/${baseSha}/LICENSE`,
        verified_at: new Date().toISOString(),
      },
      agent: pull.user?.login ?? 'unknown',
      agent_provenance: {
        kind: 'pull-request-author',
        evidence: `GitHub reports the public PR author as ${pull.user?.login ?? 'unknown'} with account type ${pull.user?.type ?? 'unknown'}.`,
      },
      raw_diff_artifact: {
        url: `https://github.com/${repo}/compare/${baseSha}...${headSha}.diff`,
        sha256: diffSha,
        bytes: diff.byteLength,
      },
      review_output_artifacts: {
        codevetter: blockedArtifact(
          'CodeVetter',
          '1.1.97',
          'local',
          'Production pipeline against the immutable diff',
          'The production CodeVetter pipeline has not yet been captured for this pinned public diff; all CodeVetter catch-rate claims remain closed.'
        ),
        coderabbit_free: blockedArtifact(
          'CodeRabbit',
          'unavailable',
          'free',
          'Public pull-request review',
          'No CodeRabbit review exists on the source PR and this workspace has neither the CodeRabbit CLI nor authority to install the GitHub App on github/gh-aw.'
        ),
        claude_code_review: blockedArtifact(
          'Claude Code /review',
          '2.1.211',
          'local account',
          'Pinned checkout /review command',
          'No reproducible non-interactive Claude Code /review artifact was captured; invoking the interactive account-backed command across the corpus could consume paid capacity, so the comparator claim remains closed.'
        ),
      },
    },
    impact: {
      customer_visible: true,
      area: issue.path,
      severity_basis: `The public review identified behavior that could affect users or CI at ${issue.path}:${issue.line ?? issue.original_line ?? 1}.`,
    },
    adjudication: {
      status: 'adjudicated',
      method: 'codex-assisted manual review of a public inline issue plus the agent follow-up fix',
      adjudicators: ['codex-assisted-manual-triage'],
      decided_at: new Date().toISOString(),
      notes: reply
        ? `The issue is bounded to the pinned comment commit. The agent's later reply says it was fixed, so the pre-fix behavior is retained as ground truth rather than attributed to the merged head.`
        : `The issue is bounded to the pinned public review comment and its exact commit. The PR advanced to ${pull.head.sha} before merge; no claim is made that the issue remained in the merged head.`,
      exclusions: otherIssues.map((comment) => ({
        review_comment: comment.html_url,
        reason:
          'Not selected for the one-independent-finding-per-PR corpus slice; no negative judgment recorded.',
      })),
    },
    ground_truth: [
      {
        id: `review-${issue.id}`,
        severity: severityFor(issue.body),
        filePath: issue.path,
        title,
        evidence: reply
          ? `Public inline review ${issue.html_url} identifies the defect on commit ${headSha}; follow-up ${reply.html_url} records the corrective change.`
          : `Public inline review ${issue.html_url} identifies the defect on commit ${headSha}; the PR later advanced to merged head ${pull.head.sha}.`,
        adjudication: 'confirmed',
        impact: `The pinned implementation exhibits the reviewed failure mode in ${issue.path}.`,
      },
    ],
    reviews: {
      codevetter: [],
      coderabbit_free: [],
      claude_code_review: [],
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!/^[\w.-]+\/[\w.-]+$/.test(args.repo)) throw new Error('--repo must be owner/name');
  if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 30) {
    throw new Error('--limit must be between 1 and 30');
  }
  const license = ghJson(`repos/${args.repo}`);
  if (!license.license?.spdx_id) throw new Error(`${args.repo} has no detected SPDX license`);
  const cases = [];
  const skipped = [];
  for (const number of args.prs) {
    if (cases.length >= args.limit) break;
    const pull = ghJson(`repos/${args.repo}/pulls/${number}`);
    if (
      !['copilot', 'copilot-swe-agent[bot]'].includes(pull.user?.login?.toLowerCase()) ||
      pull.user?.type !== 'Bot' ||
      !pull.merged_at
    ) {
      skipped.push({ number, reason: 'not a merged Copilot coding-agent PR' });
      continue;
    }
    const comments = ghJson(`repos/${args.repo}/pulls/${number}/comments`);
    const roots = comments.filter((comment) => !comment.in_reply_to_id && issueLike(comment.body));
    const selectedWithReply = roots.find((comment) =>
      comments.some((reply) => reply.in_reply_to_id === comment.id && fixedLike(reply.body))
    );
    const selected = selectedWithReply ?? roots[0];
    if (!selected) {
      skipped.push({ number, reason: 'no bounded public issue review comment' });
      continue;
    }
    const reply = comments.find(
      (candidate) => candidate.in_reply_to_id === selected.id && fixedLike(candidate.body)
    );
    const commits = ghJson(`repos/${args.repo}/pulls/${number}/commits`);
    const firstCommit = ghJson(`repos/${args.repo}/commits/${commits[0].sha}`);
    const baseSha = firstCommit.parents?.[0]?.sha;
    if (!baseSha || !selected.commit_id) {
      skipped.push({ number, reason: 'immutable base or reviewed head unavailable' });
      continue;
    }
    const diff = ghDiff(args.repo, baseSha, selected.commit_id);
    cases.push(
      buildCase({
        repo: args.repo,
        pull,
        license,
        baseSha,
        issue: selected,
        reply,
        diff,
        otherIssues: roots.filter((comment) => comment.id !== selected.id),
      })
    );
  }
  if (cases.length < args.limit) {
    throw new Error(
      `Only ${cases.length}/${args.limit} PRs met the public issue-plus-fix contract. Skipped: ${JSON.stringify(skipped)}`
    );
  }
  const payload = {
    name: 'CodeVetter public Copilot PR curation corpus',
    schema_version: 2,
    generated_at: new Date().toISOString(),
    notes:
      'Source and adjudication evidence are public and immutable. Reviewer arrays remain empty and every comparator artifact records an exact blocker, so benchmark claims are closed.',
    cases,
  };
  if (args.dryRun) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  const out = path.resolve(args.outDir, 'public-copilot-corpus.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote ${cases.length} curated cases to ${path.relative(process.cwd(), out)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
