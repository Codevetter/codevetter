#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultCasesRoot = join(repositoryRoot, 'benchmarks/public-catch-rate/cases');
const defaultBinary = join(repositoryRoot, 'apps/desktop/src-tauri/target/debug/codevetter');
const genericTask =
  'Review this exact change for correctness, security, reliability, and maintainability defects.';

const typeKeywords = {
  sql_injection: ['sql injection', 'parameteriz', 'interpolat'],
  xss: ['xss', 'cross-site scripting', 'innerhtml', 'unescaped', 'sanitiz'],
  hardcoded_credentials: ['hardcoded', 'hard-coded', 'credential', 'secret', 'password'],
  hardcoded_secret: ['hardcoded', 'hard-coded', 'credential', 'secret', 'api key'],
  command_injection: ['command injection', 'shell', 'exec', 'subprocess', 'os.system'],
  path_traversal: ['path traversal', 'directory traversal', '../', 'normaliz'],
  ssrf: ['ssrf', 'server-side request forgery', 'internal network', 'metadata'],
  insecure_deserialization: ['deserializ', 'pickle', 'unpickl', 'yaml.load'],
  weak_hash: ['md5', 'sha1', 'sha-1', 'weak hash'],
  insecure_random: ['random', 'prng', 'securerandom', 'predictable'],
  race_condition: ['race', 'concurrent', 'mutex', 'atomic', 'lock'],
  nil_dereference: ['nil pointer', 'nil deref', 'null pointer', 'nil check'],
  unchecked_error: ['unchecked error', 'ignored error', 'error return', 'err !='],
  code_injection: ['eval', 'code injection', 'function constructor'],
  open_redirect: ['open redirect', 'redirect', 'unvalidated url'],
  swallowed_error: ['bare except', 'broad exception', 'swallow'],
  resource_exhaustion: ['zip bomb', 'decompression', 'uncompressed size', 'resource'],
  integer_overflow: ['overflow', 'wrapping', 'checked_', 'saturating'],
  dead_code: ['dead code', 'unused', 'unreachable'],
  missing_await: ['await', 'unawaited', 'floating promise'],
  prototype_pollution: ['prototype pollution', '__proto__', 'constructor.prototype'],
  regex_dos: ['redos', 'regex dos', 'catastrophic backtracking', 'exponential'],
  insecure_cookie: ['cookie', 'httponly', 'secure flag', 'samesite'],
  type_confusion: ['type confusion', 'unsafe cast', 'as unknown', 'any'],
};

export function parseArguments(argv) {
  const options = {
    binary: defaultBinary,
    casesRoot: defaultCasesRoot,
    caseIDs: [],
    limit: undefined,
    outRoot: join(repositoryRoot, 'artifacts/cross-review-benchmark'),
    timeoutMS: 300_000,
  };
  const readers = {
    '--binary': (value) => {
      options.binary = resolve(value);
    },
    '--cases-root': (value) => {
      options.casesRoot = resolve(value);
    },
    '--case': (value) => {
      options.caseIDs.push(value);
    },
    '--limit': (value) => {
      options.limit = Number(value);
    },
    '--out-root': (value) => {
      options.outRoot = resolve(value);
    },
    '--timeout-ms': (value) => {
      options.timeoutMS = Number(value);
    },
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    const reader = readers[argument];
    const next = argv[index + 1];
    if (!reader || next === undefined)
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    reader(next);
    index += 1;
  }
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1)) {
    throw new Error('--limit must be a positive integer');
  }
  if (!Number.isInteger(options.timeoutMS) || options.timeoutMS < 1_000) {
    throw new Error('--timeout-ms must be an integer of at least 1000');
  }
  return options;
}

function keywordsFor(type) {
  return typeKeywords[type] ?? [String(type).replaceAll('_', ' ')];
}

function findingText(finding) {
  return `${finding.title ?? ''} ${finding.summary ?? ''} ${finding.suggestion ?? ''}`.toLowerCase();
}

export function matchFinding(finding, label) {
  const findingPath = finding.filePath ?? finding.file_path;
  const findingLine = Number(finding.line);
  if (findingPath !== label.source_file || !Number.isInteger(findingLine) || findingLine < 1) {
    return [];
  }
  const text = findingText(finding);
  return label.ground_truth
    .filter((groundTruth) => {
      const [first, last] = groundTruth.location?.lines ?? [];
      const lineMatches =
        Number.isInteger(first) && Number.isInteger(last)
          ? findingLine >= first - 5 && findingLine <= last + 5
          : false;
      return lineMatches && keywordsFor(groundTruth.type).some((keyword) => text.includes(keyword));
    })
    .map((groundTruth) => groundTruth.id);
}

export function scoreFindings(findings, label) {
  const caught = new Set();
  let falsePositives = 0;
  let redundant = 0;
  for (const finding of findings) {
    const matches = matchFinding(finding, label);
    if (matches.length === 0) {
      falsePositives += 1;
      continue;
    }
    let added = false;
    for (const match of matches) {
      if (!caught.has(match)) {
        caught.add(match);
        added = true;
      }
    }
    if (!added) redundant += 1;
  }
  const expected = label.ground_truth.length;
  return {
    expected,
    caught: caught.size,
    missed: label.ground_truth.map((groundTruth) => groundTruth.id).filter((id) => !caught.has(id)),
    findings: findings.length,
    false_positives: falsePositives,
    redundant,
  };
}

export function aggregateScores(cases, reviewer) {
  const totals = cases.reduce(
    (sum, entry) => {
      const score = entry.reviewers[reviewer];
      for (const key of ['expected', 'caught', 'findings', 'false_positives', 'redundant']) {
        sum[key] += score[key];
      }
      sum.duration_ms += entry.duration_ms[reviewer] ?? 0;
      return sum;
    },
    { expected: 0, caught: 0, findings: 0, false_positives: 0, redundant: 0, duration_ms: 0 }
  );
  const denominator = totals.caught + totals.false_positives + totals.redundant;
  const recall = totals.expected === 0 ? 0 : totals.caught / totals.expected;
  const precision = denominator === 0 ? 0 : totals.caught / denominator;
  return {
    ...totals,
    recall,
    precision,
    f1: recall + precision === 0 ? 0 : (2 * recall * precision) / (recall + precision),
    mean_duration_ms: cases.length === 0 ? 0 : Math.round(totals.duration_ms / cases.length),
  };
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function run(command, arguments_, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
    }, options.timeoutMS ?? 30_000);
    child.on('error', reject);
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      resolvePromise({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

async function git(repo, ...arguments_) {
  const result = await run('git', arguments_, { cwd: repo, timeoutMS: 30_000 });
  if (result.code !== 0) throw new Error(`git ${arguments_.join(' ')} failed`);
}

async function prepareCase(caseDirectory, label, workRoot) {
  const repo = join(workRoot, 'repo');
  mkdirSync(repo, { recursive: true });
  await git(repo, 'init', '--quiet');
  await git(repo, 'config', 'user.name', 'CodeVetter Benchmark');
  await git(repo, 'config', 'user.email', 'benchmark@codevetter.local');
  writeFileSync(join(repo, 'README.md'), '# Synthetic review case\n');
  await git(repo, 'add', 'README.md');
  await git(repo, 'commit', '--quiet', '-m', 'baseline');
  cpSync(join(caseDirectory, label.source_file), join(repo, label.source_file));
  await git(repo, 'add', label.source_file);
  await git(repo, 'commit', '--quiet', '-m', 'candidate');
  return repo;
}

function boundedFailure(result) {
  const summary = result.stderr.trim().split('\n').slice(-8).join('\n');
  return summary.slice(0, 2_000);
}

async function runCase({ binary, caseDirectory, label, outputDirectory, timeoutMS }) {
  const workRoot = mkdtempSync(join(tmpdir(), `codevetter-cross-${label.id}-`));
  try {
    const repo = await prepareCase(caseDirectory, label, workRoot);
    const appData = join(workRoot, 'app-data');
    mkdirSync(appData, { recursive: true });
    const started = Date.now();
    const result = await run(
      binary,
      [
        'check',
        '--range',
        'HEAD^..HEAD',
        '--task',
        genericTask,
        '--agent',
        'cross',
        '--repo',
        repo,
        '--request-id',
        `cross-benchmark-${label.id}-${randomUUID()}`,
        '--json',
      ],
      {
        cwd: repo,
        env: { ...process.env, CODEVETTER_APP_DATA_DIR: appData },
        timeoutMS,
      }
    );
    const wallTimeMS = Date.now() - started;
    let receipt;
    try {
      receipt = JSON.parse(result.stdout);
    } catch {
      throw new Error(
        `case ${label.id} emitted no valid receipt (exit ${result.code}, signal ${result.signal ?? 'none'}): ${boundedFailure(result)}`
      );
    }
    const crossReview = receipt.stages?.review?.evidence?.cross_review;
    if (crossReview?.status !== 'completed') {
      throw new Error(`case ${label.id} did not complete both passes`);
    }
    const passes = Object.fromEntries(crossReview.passes.map((pass) => [pass.reviewer, pass]));
    const reviewers = {
      claude: scoreFindings(passes.claude?.qualified_findings ?? [], label),
      codex: scoreFindings(passes.codex?.qualified_findings ?? [], label),
      cross: scoreFindings(crossReview.findings ?? [], label),
    };
    const entry = {
      case_id: label.id,
      exit_code: result.code,
      verdict: receipt.verdict,
      wall_time_ms: wallTimeMS,
      policy_binding: crossReview.policy_binding,
      unit_plan_identity: crossReview.unit_plan_identity,
      classes: crossReview.counts,
      duration_ms: {
        claude: passes.claude?.duration_ms ?? null,
        codex: passes.codex?.duration_ms ?? null,
        cross: receipt.stages?.review?.duration_ms ?? wallTimeMS,
      },
      usage: {
        claude: passes.claude?.usage ?? null,
        codex: passes.codex?.usage ?? null,
      },
      reviewers,
    };
    writeFileSync(
      join(outputDirectory, 'receipts', `${label.id}.json`),
      `${JSON.stringify(receipt, null, 2)}\n`
    );
    return entry;
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (!existsSync(options.binary))
    throw new Error(`CodeVetter binary not found: ${options.binary}`);
  if (!existsSync(options.casesRoot))
    throw new Error(`Benchmark cases not found: ${options.casesRoot}`);

  const allIDs = readdirSync(options.casesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  let caseIDs = options.caseIDs.length > 0 ? options.caseIDs : allIDs;
  if (options.limit !== undefined) caseIDs = caseIDs.slice(0, options.limit);
  for (const caseID of caseIDs) {
    if (!allIDs.includes(caseID)) throw new Error(`Unknown benchmark case: ${caseID}`);
  }

  const runID = new Date()
    .toISOString()
    .replaceAll(':', '-')
    .replace(/\.\d{3}Z$/, 'Z');
  const outputDirectory = join(options.outRoot, runID);
  mkdirSync(join(outputDirectory, 'receipts'), { recursive: true });
  const cases = [];
  for (const [index, caseID] of caseIDs.entries()) {
    console.log(`[cross-benchmark] ${index + 1}/${caseIDs.length} ${caseID}`);
    const caseDirectory = join(options.casesRoot, caseID);
    const label = JSON.parse(readFileSync(join(caseDirectory, 'label.json'), 'utf8'));
    const entry = await runCase({
      binary: options.binary,
      caseDirectory,
      label,
      outputDirectory,
      timeoutMS: options.timeoutMS,
    });
    cases.push(entry);
    writeFileSync(join(outputDirectory, 'partial.json'), `${JSON.stringify(cases, null, 2)}\n`);
    console.log(
      `[cross-benchmark] ${caseID}: claude ${entry.reviewers.claude.caught}/${entry.reviewers.claude.expected}, codex ${entry.reviewers.codex.caught}/${entry.reviewers.codex.expected}, cross ${entry.reviewers.cross.caught}/${entry.reviewers.cross.expected}`
    );
  }

  const report = {
    schema_version: 'codevetter.cross-review-benchmark/v1',
    recorded_at: new Date().toISOString(),
    source: {
      repository_revision: (
        await run('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, timeoutMS: 30_000 })
      ).stdout.trim(),
      binary_path: options.binary,
      binary_sha256: sha256File(options.binary),
      benchmark: 'benchmarks/public-catch-rate',
      task: genericTask,
    },
    policy: {
      execution: 'Claude then Codex, independent original context',
      mapping: 'same source path, label line within five lines, and narrow defect-type keywords',
      limitations: [
        'Synthetic single-file cases do not represent full repository review.',
        'Ground-truth mapping is deterministic but remains a proposal until human-reviewed.',
        'Provider usage is unavailable when the local executor omits it.',
        'Reviewer agreement is review coverage and never executable proof.',
      ],
    },
    cases,
    reviewers: {
      claude: aggregateScores(cases, 'claude'),
      codex: aggregateScores(cases, 'codex'),
      cross: aggregateScores(cases, 'cross'),
    },
  };
  const reportPath = join(outputDirectory, 'report.json');
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[cross-benchmark] report ${reportPath}`);
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[cross-benchmark] ${error.message}`);
    process.exitCode = 1;
  });
}
