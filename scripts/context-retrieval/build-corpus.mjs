#!/usr/bin/env node

// Builds a retrieval-evaluation corpus from a local repository's own fix history.
// Ground truth is the set of code files a real fix had to touch; the query is the
// commit subject. No network, no agent, no model.

import { execFileSync } from 'node:child_process';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const RETRIEVAL_CORPUS_SCHEMA_VERSION = 'codevetter.context-retrieval-corpus.v1';
export const MAX_REQUIRED_FILES = 8;

const UNIT_SEPARATOR = '\u001f';

// Bookkeeping that rides along in fix commits without being part of the fix.
const NOISE_DIRECTORY = /(^|\/)(docs|openspec|\.github|node_modules|\.changeset)\//;
// .rst and .webp were missing from this list, and the omission put flask's
// CHANGES.rst into the ground truth of 14 of its 39 cases and hugo's golden .webp
// fixtures into 2 more. A changelog entry is not a file anyone had to locate, so
// those cases were rewarding a tool for returning a changelog. `got`, the corpus
// the published field measurement uses, contains neither and is unaffected.
const NOISE_EXTENSION = /\.(md|mdx|rst|png|jpe?g|svg|ico|gif|webp|jsonl|snap|lock|txt)$/i;
const LOCKFILE = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|Cargo\.lock|yarn\.lock)$/;
const TEST_FILE = /(\.test\.|\.spec\.|(^|\/)(tests?|__tests__|e2e)\/)/;
// Version manifests ride along with releases. Nobody had to *find* them, so they
// only count as ground truth when the change is genuinely about the manifest.
const VERSION_MANIFEST =
  /(^|\/)(package\.json|tauri\.conf\.json|Cargo\.toml|wrangler\.jsonc?|tsconfig(\.\w+)?\.json)$/;
const SUBJECT_PREFIX = /^(\w+)(\([^)]*\))?!?:\s*/;
// Sweeps and releases are not retrieval tasks: nothing had to be located.
const EXCLUDED_SUBJECT = /^(release|chore|revert|merge|docs|style|format|bump|wip|deps)\b/i;
const FIX_SUBJECT = /^(fix|bug|hotfix|patch|repair|correct)/i;
// Vocabulary that appears in fix subjects without naming anything retrievable.
// "fix email manager bugs" is not a retrieval task: after removing the generic
// words and the repository's own name, nothing is left to search for, and the
// case rewards whichever provider happens to prefix-match a common filename.
const GENERIC_TOKEN = new Set([
  'again',
  'also',
  'better',
  'broken',
  'bugs',
  'catch',
  'cases',
  'change',
  'changes',
  'cleanup',
  'correct',
  'correctly',
  'crash',
  'error',
  'errors',
  'fail',
  'failing',
  'fails',
  'fixes',
  'handle',
  'handling',
  'improve',
  'issue',
  'issues',
  'minor',
  'misc',
  'various',
  'proper',
  'properly',
  'quick',
  'small',
  'stuff',
  'things',
  'update',
  'updates',
  'wrong',
]);
const MINIMUM_SPECIFIC_TOKENS = 2;
const STOPWORDS = new Set([
  'after',
  'again',
  'against',
  'always',
  'before',
  'being',
  'below',
  'between',
  'both',
  'during',
  'each',
  'from',
  'into',
  'more',
  'must',
  'never',
  'only',
  'other',
  'over',
  'same',
  'should',
  'some',
  'such',
  'than',
  'that',
  'then',
  'there',
  'these',
  'this',
  'those',
  'through',
  'under',
  'until',
  'when',
  'where',
  'which',
  'while',
  'with',
  'without',
]);

export function buildRetrievalCorpus({
  repo = process.cwd(),
  limit = 600,
  maxRequiredFiles = MAX_REQUIRED_FILES,
  fixesOnly = true,
} = {}) {
  const root = resolve(repo);
  const repoId = git(root, ['rev-parse', '--show-toplevel']).split('/').pop();
  const log = git(root, ['log', '--no-merges', `--max-count=${limit}`, '--format=%H%x1f%s%x1f%aI']);
  const cases = [];
  const rejected = [];
  for (const line of log.split('\n').filter(Boolean)) {
    const [commit, subject, authoredAt] = line.split(UNIT_SEPARATOR);
    const outcome = buildCase({
      root,
      repoId,
      commit,
      subject,
      authoredAt,
      maxRequiredFiles,
      fixesOnly,
    });
    if (outcome.case) cases.push(outcome.case);
    else rejected.push({ commit, subject, reason: outcome.reason });
  }
  cases.sort((left, right) => left.case_id.localeCompare(right.case_id));
  return {
    schema_version: RETRIEVAL_CORPUS_SCHEMA_VERSION,
    repository: { id: repoId, head: git(root, ['rev-parse', 'HEAD']) },
    selection: {
      commits_scanned: log.split('\n').filter(Boolean).length,
      fixes_only: fixesOnly,
      max_required_files: maxRequiredFiles,
    },
    counts: {
      cases: cases.length,
      path_leak: cases.filter((entry) => entry.retrieval.path_leak).length,
      baseline_blind: cases.filter((entry) => !entry.retrieval.path_leak).length,
      multi_file: cases.filter((entry) => entry.required_files.length > 1).length,
    },
    cases,
    rejected_sample: rejected.slice(0, 20),
  };
}

function buildCase({ root, repoId, commit, subject, authoredAt, maxRequiredFiles, fixesOnly }) {
  if (EXCLUDED_SUBJECT.test(subject)) return { reason: 'excluded-subject' };
  const query = subject.replace(SUBJECT_PREFIX, '').trim();
  if (fixesOnly && !FIX_SUBJECT.test(subject)) return { reason: 'not-a-fix' };
  if (query.length < 12) return { reason: 'query-too-short' };
  let base;
  try {
    base = git(root, ['rev-parse', `${commit}^`]);
  } catch {
    return { reason: 'root-commit' };
  }
  const changed = git(root, ['show', '--name-only', '--format=', commit])
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (changed.length === 0) return { reason: 'no-files' };

  const kept = changed.filter((path) => !isNoise(path));
  const excluded = changed.filter((path) => isNoise(path));
  const sources = kept.filter((path) => !TEST_FILE.test(path));
  // A test co-located with a changed source is derivable from it, so counting it
  // as ground truth would hand every provider free recall.
  const derivable = kept.filter(
    (path) => TEST_FILE.test(path) && sources.some((source) => sharesStem(source, path))
  );
  const candidates = [
    ...sources,
    ...kept.filter((path) => TEST_FILE.test(path) && !derivable.includes(path)),
  ]
    .sort()
    .filter((path, index, all) => all.indexOf(path) === index);
  const substantive = candidates.filter((path) => !VERSION_MANIFEST.test(path));
  const incidental =
    substantive.length > 0 ? candidates.filter((path) => VERSION_MANIFEST.test(path)) : [];
  const required = substantive.length > 0 ? substantive : candidates;

  if (required.length === 0) return { reason: 'no-code-files' };
  if (required.length > maxRequiredFiles) return { reason: 'too-broad' };

  const queryTokens = tokenize(query);
  // A query has to name something. Repo-name tokens are excluded too: matching
  // "email" inside private-B discriminates nothing.
  const repoTokens = tokenize(repoId);
  const specific = [...queryTokens].filter(
    (token) => !GENERIC_TOKEN.has(token) && !repoTokens.has(token)
  );
  if (specific.length < MINIMUM_SPECIFIC_TOKENS) return { reason: 'query-not-specific' };

  const overlaps = required.map((path) => ({
    path,
    shared: [...pathTokens(path)].filter((token) => queryTokens.has(token)).sort(),
  }));
  return {
    case: {
      case_id: `${repoId}-${commit.slice(0, 12)}`,
      repository: repoId,
      commit,
      base_revision: base,
      authored_at: authoredAt,
      query,
      query_tokens: [...queryTokens].sort(),
      specific_tokens: specific.sort(),
      required_files: required,
      derivable_files: derivable.sort(),
      incidental_files: incidental.sort(),
      excluded_files: excluded.sort(),
      retrieval: {
        // Whether query vocabulary leaks into the file path. This is a property of the
        // query, not a difficulty label: content search does not read paths.
        path_leak: overlaps.some((entry) => entry.shared.length > 0),
        path_leak_ratio: round(
          overlaps.filter((entry) => entry.shared.length > 0).length / required.length
        ),
        shared_tokens: overlaps
          .filter((entry) => entry.shared.length > 0)
          .map((entry) => ({ path: entry.path, tokens: entry.shared })),
      },
    },
  };
}

export function tokenize(text) {
  const spaced = String(text).replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  const tokens = spaced
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token) && !/^\d+$/.test(token));
  return new Set(tokens);
}

export function pathTokens(path) {
  return tokenize(path.replace(/\.[a-z0-9]+$/i, '').replace(/[/\\]/g, ' '));
}

function sharesStem(source, test) {
  const stem = (value) =>
    value
      .split('/')
      .pop()
      .replace(/\.(test|spec)\./, '.')
      .replace(/\.[a-z0-9]+$/i, '');
  return stem(source) === stem(test);
}

function isNoise(path) {
  return NOISE_DIRECTORY.test(path) || NOISE_EXTENSION.test(path) || LOCKFILE.test(path);
}

export function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

async function writeJsonAtomic(path, value) {
  const destination = resolve(path);
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, destination);
}

function parseArgs(args) {
  const options = { repo: process.cwd(), limit: 600, out: undefined, fixesOnly: true };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--all-commits') {
      options.fixesOnly = false;
      continue;
    }
    if (!['--repo', '--limit', '--out'].includes(argument)) {
      throw new Error(`unknown argument: ${argument}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
    index += 1;
    if (argument === '--repo') options.repo = value;
    if (argument === '--limit') options.limit = Number.parseInt(value, 10);
    if (argument === '--out') options.out = value;
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const corpus = buildRetrievalCorpus(options);
    if (options.out) await writeJsonAtomic(options.out, corpus);
    process.stdout.write(
      `Repository: ${corpus.repository.id}\n` +
        `Cases: ${corpus.counts.cases} (${corpus.counts.multi_file} multi-file)\n` +
        `Path-leak queries: ${corpus.counts.path_leak}\n` +
        `No path leak: ${corpus.counts.baseline_blind}\n` +
        (options.out ? `Artifact: ${options.out}\n` : '')
    );
  } catch (error) {
    process.stderr.write(
      `Corpus build failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 2;
  }
}
