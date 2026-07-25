#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_FIXTURE = 'benchmarks/agent-prs/cases';
const REQUIRED_REVIEWERS = ['codevetter', 'coderabbit_free', 'claude_code_review'];

function parseArgs(argv) {
  const fixture = argv.find((arg) => !arg.startsWith('--')) ?? DEFAULT_FIXTURE;
  const formatArg = argv.find((arg) => arg.startsWith('--format='));
  const format = formatArg?.slice('--format='.length) ?? 'text';
  const requirePublishable = argv.includes('--require-publishable');
  return { fixture, format, requirePublishable };
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readCases(fixturePath) {
  const abs = path.resolve(process.cwd(), fixturePath);
  if (!fs.existsSync(abs)) {
    return [];
  }
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) {
    return fs
      .readdirSync(abs)
      .filter((name) => name.endsWith('.json') && !name.startsWith('_'))
      .sort()
      .map((name) => readJsonFile(path.join(abs, name)));
  }
  const parsed = readJsonFile(abs);
  return Array.isArray(parsed.cases) ? parsed.cases : [parsed];
}

function hasValue(value) {
  return typeof value === 'string' && value.trim() !== '' && !/\bTODO\b/i.test(value);
}

function hasArtifactReference(value) {
  if (hasValue(value)) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return value.status === 'captured' ? hasValue(value.path) : hasValue(value.blocker);
}

function caseIssues(testCase) {
  const issues = [];
  if (!hasValue(testCase.id)) issues.push('missing id');
  if (!hasValue(testCase.title)) issues.push('missing title');
  if (!hasValue(testCase.source?.repo)) issues.push('missing source.repo');
  if (!hasValue(testCase.source?.pr_url)) issues.push('missing source.pr_url');
  if (!hasValue(testCase.source?.diff_range)) issues.push('missing source.diff_range');
  if (!hasValue(testCase.source?.agent)) issues.push('missing source.agent');
  if (
    !hasValue(testCase.source?.raw_diff_artifact) &&
    !hasValue(testCase.source?.raw_diff_artifact?.url)
  ) {
    issues.push('missing source.raw_diff_artifact');
  }
  for (const reviewer of REQUIRED_REVIEWERS) {
    if (!hasArtifactReference(testCase.source?.review_output_artifacts?.[reviewer])) {
      issues.push(`missing source.review_output_artifacts.${reviewer}`);
    }
  }

  if (!Array.isArray(testCase.ground_truth) || testCase.ground_truth.length === 0) {
    issues.push('missing ground_truth');
  } else {
    for (const [idx, issue] of testCase.ground_truth.entries()) {
      if (!hasValue(issue.id)) issues.push(`ground_truth[${idx}] missing id`);
      if (!hasValue(issue.severity)) issues.push(`ground_truth[${idx}] missing severity`);
      if (!hasValue(issue.title)) issues.push(`ground_truth[${idx}] missing title`);
      if (!hasValue(issue.evidence)) issues.push(`ground_truth[${idx}] missing evidence`);
    }
  }

  const issueIds = new Set((testCase.ground_truth ?? []).map((issue) => issue.id));
  const reviews = testCase.reviews ?? {};
  for (const reviewer of REQUIRED_REVIEWERS) {
    if (!Array.isArray(reviews[reviewer])) {
      issues.push(`missing reviews.${reviewer}`);
    }
  }
  for (const [reviewer, findings] of Object.entries(reviews)) {
    if (!Array.isArray(findings)) {
      issues.push(`reviews.${reviewer} must be an array`);
      continue;
    }
    for (const [idx, finding] of findings.entries()) {
      if (!hasValue(finding.title)) issues.push(`reviews.${reviewer}[${idx}] missing title`);
      const matches = finding.matched_ground_truth ?? [];
      if (!Array.isArray(matches)) {
        issues.push(`reviews.${reviewer}[${idx}] matched_ground_truth must be an array`);
        continue;
      }
      for (const id of matches) {
        if (!issueIds.has(id)) {
          issues.push(`reviews.${reviewer}[${idx}] references unknown issue ${id}`);
        }
      }
      if (matches.length > 0 && !hasValue(finding.match_rationale)) {
        issues.push(`reviews.${reviewer}[${idx}] missing match_rationale`);
      }
    }
  }

  return issues;
}

function publishableCaseIssues(testCase) {
  const issues = [...caseIssues(testCase)];
  if (testCase.source?.public !== true) issues.push('source.public must be true');
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/i.test(testCase.source?.pr_url ?? '')) {
    issues.push('source.pr_url must identify one public GitHub pull request');
  }
  for (const field of ['base_sha', 'head_sha']) {
    if (!/^[a-f0-9]{40}$/i.test(testCase.source?.immutable_diff?.[field] ?? '')) {
      issues.push(`source.immutable_diff.${field} must be a full commit SHA`);
    }
  }
  if (!/^[a-f0-9]{64}$/i.test(testCase.source?.immutable_diff?.sha256 ?? '')) {
    issues.push('source.immutable_diff.sha256 must be a SHA-256 digest');
  }
  if (!hasValue(testCase.source?.license?.spdx)) issues.push('missing source.license.spdx');
  if (!hasValue(testCase.source?.license?.url)) issues.push('missing source.license.url');
  if (!hasValue(testCase.source?.license?.verified_at)) {
    issues.push('missing source.license.verified_at');
  }
  if (!hasValue(testCase.source?.agent_provenance?.kind)) {
    issues.push('missing source.agent_provenance.kind');
  }
  if (!hasValue(testCase.source?.agent_provenance?.evidence)) {
    issues.push('missing source.agent_provenance.evidence');
  }
  if (!hasValue(testCase.source?.raw_diff_artifact?.url)) {
    issues.push('missing source.raw_diff_artifact.url');
  }
  if (testCase.source?.raw_diff_artifact?.sha256 !== testCase.source?.immutable_diff?.sha256) {
    issues.push('raw diff digest must equal immutable diff identity');
  }
  if (testCase.adjudication?.status !== 'adjudicated') {
    issues.push('adjudication.status must be adjudicated');
  }
  if (!hasValue(testCase.adjudication?.method)) issues.push('missing adjudication.method');
  if (
    !Array.isArray(testCase.adjudication?.adjudicators) ||
    !testCase.adjudication.adjudicators.length
  ) {
    issues.push('adjudication.adjudicators must name at least one reviewer');
  }
  if (!hasValue(testCase.adjudication?.decided_at)) issues.push('missing adjudication.decided_at');
  if (!Array.isArray(testCase.adjudication?.exclusions)) {
    issues.push('adjudication.exclusions must be an array');
  }
  if (typeof testCase.impact?.customer_visible !== 'boolean') {
    issues.push('impact.customer_visible must be boolean');
  }
  if (!hasValue(testCase.impact?.area)) issues.push('missing impact.area');
  if (!hasValue(testCase.impact?.severity_basis)) issues.push('missing impact.severity_basis');

  for (const [index, issue] of (testCase.ground_truth ?? []).entries()) {
    if (issue.adjudication !== 'confirmed') {
      issues.push(`ground_truth[${index}].adjudication must be confirmed`);
    }
    if (!hasValue(issue.impact)) issues.push(`ground_truth[${index}] missing impact`);
    if (!hasValue(issue.filePath)) issues.push(`ground_truth[${index}] missing filePath`);
  }

  for (const reviewer of REQUIRED_REVIEWERS) {
    const artifact = testCase.source?.review_output_artifacts?.[reviewer];
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
      issues.push(`source.review_output_artifacts.${reviewer} must be a metadata object`);
      continue;
    }
    if (!['captured', 'blocked_external'].includes(artifact.status)) {
      issues.push(`source.review_output_artifacts.${reviewer}.status is invalid`);
    }
    for (const field of ['tool', 'version', 'tier', 'capture_method']) {
      if (!hasValue(artifact[field])) {
        issues.push(`source.review_output_artifacts.${reviewer}.${field} is missing`);
      }
    }
    if (artifact.status === 'captured') {
      if (!hasValue(artifact.path)) {
        issues.push(`source.review_output_artifacts.${reviewer}.path is missing`);
      }
      if (!hasValue(artifact.captured_at)) {
        issues.push(`source.review_output_artifacts.${reviewer}.captured_at is missing`);
      }
      if (!Number.isFinite(artifact.elapsed_ms) || artifact.elapsed_ms < 0) {
        issues.push(`source.review_output_artifacts.${reviewer}.elapsed_ms is invalid`);
      }
      if (!Number.isInteger(artifact.unverified_fix_count) || artifact.unverified_fix_count < 0) {
        issues.push(`source.review_output_artifacts.${reviewer}.unverified_fix_count is invalid`);
      }
    } else if (!hasValue(artifact.blocker)) {
      issues.push(`source.review_output_artifacts.${reviewer}.blocker is missing`);
    }
  }
  return [...new Set(issues)];
}

function summarize(cases) {
  const rows = cases.map((testCase) => ({
    id: testCase.id ?? '(missing id)',
    title: testCase.title ?? '',
    issues: caseIssues(testCase),
    publishable_issues: publishableCaseIssues(testCase),
    claim_blockers: REQUIRED_REVIEWERS.flatMap((reviewer) => {
      const artifact = testCase.source?.review_output_artifacts?.[reviewer];
      return artifact?.status === 'blocked_external'
        ? [`${reviewer}: ${artifact.blocker ?? 'external capture unavailable'}`]
        : [];
    }),
  }));
  const ready = rows.filter((row) => row.issues.length === 0).length;
  return {
    total_cases: rows.length,
    ready_cases: ready,
    incomplete_cases: rows.length - ready,
    publishable_ready_cases: rows.filter((row) => row.publishable_issues.length === 0).length,
    required_case_range: [20, 30],
    local_curation_complete:
      rows.length >= 20 &&
      rows.length <= 30 &&
      rows.every((row) => row.publishable_issues.length === 0),
    corpus_publishable:
      rows.length >= 20 &&
      rows.length <= 30 &&
      rows.every((row) => row.publishable_issues.length === 0 && row.claim_blockers.length === 0),
    rows,
  };
}

const { fixture, format, requirePublishable } = parseArgs(process.argv.slice(2));
if (!['text', 'json'].includes(format)) {
  console.error('--format must be one of: text, json');
  process.exit(1);
}

let cases;
try {
  cases = readCases(fixture);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const report = summarize(cases);
if (format === 'json') {
  console.log(JSON.stringify({ fixture, ...report }, null, 2));
} else {
  console.log(`Benchmark curation: ${report.ready_cases}/${report.total_cases} ready`);
  console.log(
    `Publishable corpus: ${report.publishable_ready_cases}/${report.total_cases} schema-ready · required 20-30 · ${report.corpus_publishable ? 'ready' : 'closed'}`
  );
  if (report.incomplete_cases > 0) {
    console.log(`Incomplete: ${report.incomplete_cases}`);
  }
  for (const row of report.rows) {
    const status = row.issues.length === 0 ? 'ready' : `${row.issues.length} issue(s)`;
    console.log(`- ${row.id}: ${status}`);
    for (const issue of row.issues.slice(0, 5)) {
      console.log(`  - ${issue}`);
    }
    if (row.issues.length > 5) {
      console.log(`  - ${row.issues.length - 5} more`);
    }
    if (row.publishable_issues.length > 0) {
      console.log(`  - publishable blockers: ${row.publishable_issues.length}`);
    }
    if (row.claim_blockers.length > 0) {
      console.log(`  - external capture blockers: ${row.claim_blockers.length}`);
    }
  }
}
if (requirePublishable && !report.corpus_publishable) {
  const rangeReady = report.total_cases >= 20 && report.total_cases <= 30;
  const externalBlockers = report.rows.reduce((count, row) => count + row.claim_blockers.length, 0);
  console.error(
    `Benchmark publication gate closed: ${report.publishable_ready_cases}/${report.total_cases} cases satisfy the v2 evidence contract; ${
      rangeReady ? 'case count is within 20-30' : '20-30 are required'
    }; ${externalBlockers} external comparator capture blocker(s) remain.`
  );
  process.exit(2);
}
