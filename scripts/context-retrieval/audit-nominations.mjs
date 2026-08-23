#!/usr/bin/env node

// Independently checks the deterministic mid-range audit sample stored in retrieval
// score artifacts. This intentionally does not reuse score.mjs's measurement helper:
// an audit performed by the same mechanism could reproduce the same defect.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// The score artifact contract stores four decimal places. Recompute from sets rather
// than importing score.mjs's helper, then compare at the artifact's precision.
const rounded = (value) => Math.round(value * 10_000) / 10_000;
const caseKey = (revision, query) => `${revision ?? ''}\0${query ?? ''}`;

function defaultGitCheck(repo, corpusCase, returned) {
  const changed = new Set(
    execFileSync(
      'git',
      ['-C', repo, 'diff', '--name-only', corpusCase.base_revision, corpusCase.commit, '--'],
      { encoding: 'utf8' }
    )
      .split('\n')
      .filter(Boolean)
  );
  const missingRequiredChanges = corpusCase.required_files.filter((path) => !changed.has(path));
  const indexedPaths = new Set(
    execFileSync('git', ['-C', repo, 'ls-tree', '-r', '--name-only', corpusCase.base_revision], {
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean)
  );
  const missingReturnedPaths = returned.filter((path) => !indexedPaths.has(path));
  return { missingRequiredChanges, missingReturnedPaths };
}

function auditNomination({ nomination, corpusCase, scoreCase, repo, gitCheck }) {
  const caseId = nomination.case_id ?? corpusCase?.case_id;
  const requiredFiles =
    nomination.required_files ?? nomination.expected ?? corpusCase?.required_files;
  const returned = nomination.returned ?? [];
  const storedWindow = nomination.returned_limit ?? 5;
  const claimedMetric = nomination.claimed_recall_at_10 ?? scoreCase?.[`recall_at_${storedWindow}`];
  const found = requiredFiles ? returned.filter((path) => requiredFiles.includes(path)).sort() : [];
  const independentlyMeasured = requiredFiles?.length
    ? rounded(new Set(found).size / requiredFiles.length)
    : null;
  const gitEvidence =
    repo && corpusCase
      ? gitCheck(repo, corpusCase, returned)
      : { missingRequiredChanges: null, missingReturnedPaths: null };

  return {
    provider_id: nomination.provider_id,
    case_id: caseId ?? null,
    query: nomination.query ?? corpusCase?.query ?? null,
    revision: nomination.revision ?? corpusCase?.base_revision ?? null,
    evidence_window: storedWindow,
    selection_metric: 'recall_at_10',
    selection_metric_evidence_complete: storedWindow >= 10,
    required_files: requiredFiles ?? null,
    returned,
    found,
    claimed_recall: claimedMetric ?? null,
    independently_measured_recall: independentlyMeasured,
    metric_consistent:
      Number.isFinite(claimedMetric) && independentlyMeasured !== null
        ? claimedMetric === independentlyMeasured
        : false,
    corpus_case_found: Boolean(corpusCase),
    score_case_found: Boolean(scoreCase),
    missing_required_changes: gitEvidence.missingRequiredChanges,
    missing_returned_paths: gitEvidence.missingReturnedPaths,
  };
}

function summarize(entries) {
  const count = (predicate) => entries.filter(predicate).length;
  return {
    nominations: entries.length,
    metric_consistent: count((entry) => entry.metric_consistent),
    selection_metric_evidence_complete: count((entry) => entry.selection_metric_evidence_complete),
    corpus_cases_found: count((entry) => entry.corpus_case_found),
    score_cases_found: count((entry) => entry.score_case_found),
    required_file_sets_confirmed_by_git: count(
      (entry) => entry.missing_required_changes?.length === 0
    ),
    returned_path_sets_confirmed_by_git: count(
      (entry) => entry.missing_returned_paths?.length === 0
    ),
  };
}

export function auditNominations({ corpus, scores, repo, gitCheck = defaultGitCheck }) {
  const corpusById = new Map(corpus.cases.map((entry) => [entry.case_id, entry]));
  const corpusByLegacyKey = new Map(
    corpus.cases.map((entry) => [caseKey(entry.base_revision, entry.query), entry])
  );
  const entries = [];

  for (const score of scores) {
    const scoreCases = new Map(
      (score.cases ?? []).map((entry) => [`${entry.provider_id}\0${entry.case_id}`, entry])
    );
    for (const nomination of score.gates?.nominated_for_hand_audit ?? []) {
      const corpusCase = nomination.case_id
        ? corpusById.get(nomination.case_id)
        : corpusByLegacyKey.get(caseKey(nomination.revision, nomination.query));
      const caseId = nomination.case_id ?? corpusCase?.case_id;
      const scoreCase = scoreCases.get(`${nomination.provider_id}\0${caseId}`);
      entries.push(auditNomination({ nomination, corpusCase, scoreCase, repo, gitCheck }));
    }
  }

  return {
    schema_version: 'codevetter.context-retrieval-audit.v1',
    summary: summarize(entries),
    entries,
  };
}

function checkLabel(missing) {
  if (!missing) return 'not checked';
  return missing.length === 0 ? 'pass' : `FAIL (${missing.join(', ')})`;
}

export function renderAudit(audit) {
  const { summary } = audit;
  const out = [
    '# Mid-range retrieval audit',
    '',
    `Nominations: ${summary.nominations}. Stored-window metrics reproduced independently: ${summary.metric_consistent}/${summary.nominations}.`,
    `Cases joined to corpus and score evidence: ${summary.corpus_cases_found}/${summary.nominations} and ${summary.score_cases_found}/${summary.nominations}.`,
    `Required-file sets confirmed against Git history: ${summary.required_file_sets_confirmed_by_git}/${summary.nominations}. Returned path sets present at the indexed revision: ${summary.returned_path_sets_confirmed_by_git}/${summary.nominations}.`,
    `Selection metric (recall@10) fully preserved: ${summary.selection_metric_evidence_complete}/${summary.nominations}.`,
    '',
    '| Provider | Case | Stored window | Claimed | Independent | Git ground truth | Returned paths |',
    '| --- | --- | ---: | ---: | ---: | --- | --- |',
  ];
  for (const entry of audit.entries) {
    const groundTruth = checkLabel(entry.missing_required_changes);
    const returnedPaths = checkLabel(entry.missing_returned_paths);
    out.push(
      `| ${entry.provider_id} | ${entry.case_id ?? 'missing'} | ${entry.evidence_window} | ${entry.claimed_recall ?? 'missing'} | ${entry.independently_measured_recall ?? 'missing'} | ${groundTruth} | ${returnedPaths} |`
    );
  }
  out.push('');
  if (summary.selection_metric_evidence_complete < summary.nominations) {
    out.push(
      '> Legacy limitation: these artifacts selected cases using recall@10 but retained only the first five returned paths. The audit can reproduce recall@5 and check those raw paths, but it cannot reconstruct ranks 6–10. New artifacts preserve all ten paths and bind the claimed metric.'
    );
    out.push('');
  }
  return out.join('\n');
}

function parseArgs(argv) {
  const options = { format: 'markdown' };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--corpus') options.corpus = argv[++i];
    else if (flag === '--score-dir') options.scoreDir = argv[++i];
    else if (flag === '--repo') options.repo = argv[++i];
    else if (flag === '--format') options.format = argv[++i];
    else throw new Error(`unknown argument: ${flag}`);
  }
  if (!options.corpus || !options.scoreDir) {
    throw new Error(
      'usage: audit-nominations.mjs --corpus <file> --score-dir <dir> [--repo <checkout>] [--format markdown|json]'
    );
  }
  if (!['markdown', 'json'].includes(options.format)) {
    throw new Error(`unsupported format: ${options.format}`);
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const corpus = JSON.parse(readFileSync(options.corpus, 'utf8'));
  const scores = readdirSync(options.scoreDir)
    .filter((file) => file.endsWith('.json') && !file.startsWith('EXCLUDED-'))
    .sort()
    .map((file) => JSON.parse(readFileSync(`${options.scoreDir}/${file}`, 'utf8')));
  const audit = auditNominations({ corpus, scores, repo: options.repo });
  console.log(options.format === 'json' ? JSON.stringify(audit, null, 2) : renderAudit(audit));
  if (
    audit.summary.metric_consistent !== audit.summary.nominations ||
    audit.summary.corpus_cases_found !== audit.summary.nominations ||
    audit.summary.score_cases_found !== audit.summary.nominations ||
    (options.repo &&
      (audit.summary.required_file_sets_confirmed_by_git !== audit.summary.nominations ||
        audit.summary.returned_path_sets_confirmed_by_git !== audit.summary.nominations))
  ) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
