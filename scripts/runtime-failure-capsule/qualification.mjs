import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';

import { EXCLUDED_PATH_PARTS, LIMITS } from './contracts.mjs';
import { detectRuntimeLanes } from './detect.mjs';
import { inspectGitDiff } from './git-diff.mjs';
import {
  PORTFOLIO_REPORT_SCHEMA_VERSION,
  QUALIFICATION_LIMITS,
  QUALIFICATION_SCHEMA_VERSION,
  assertPortfolioManifest,
  assertPortfolioReport,
  assertQualification,
} from './qualification-contracts.mjs';

const READY_SCORE = 70;
const READY_LEAD = 10;
const SOURCE_EXTENSION = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);
const TEST_FILE_PATTERN =
  /(?:^|\/)(?:__tests__\/.*|[^/]*(?:test|spec|bench|benchmark|performance|perf)[^/]*\.[cm]?[jt]sx?)$/i;
const GO_TEST_PATTERN = /_test\.go$/;
const PERFORMANCE_WORDS =
  /\b(?:bench(?:mark)?|performance|perf|throughput|latency|allocation|scale|stress)\b/i;
const STRONG_PERFORMANCE_WORDS = /\b(?:bench(?:mark)?|performance|perf)\b/i;
const TEST_LITERAL_PATTERN =
  /\b(?:test|it)(?:\.(?:only|skip|todo|concurrent))?\s*\(\s*(['"`])([^'"`\n]{1,160})\1/g;
const GO_BENCHMARK_PATTERN =
  /\bfunc\s+(Benchmark[A-Za-z0-9_]+)\s*\(\s*[A-Za-z0-9_]+\s+\*testing\.B\s*\)/g;
const TIMING_SOURCE_PATTERN =
  /\b(?:performance\.now|console\.time|hrtime|ReportMetric|ns\/op|allocs\/op)\b/;
const NETWORK_CALL_PATTERN =
  /\b(?:fetch|axios(?:\.[A-Za-z]+)?|got|ky|https?\.request|new\s+WebSocket)\s*\(\s*(?:(['"`])([^'"`\r\n]{0,500})\1|([^,)\r\n]{1,500}))/gi;
const LOOPBACK_ENDPOINT_PATTERN =
  /^(?:https?|wss?):\/\/(?:localhost(?::|\/|$)|127\.0\.0\.1(?::|\/|$)|\[::1\](?::|\/|$))/i;

const SAFETY_PATTERNS = Object.freeze([
  {
    kind: 'database_signal',
    pattern:
      /\b(?:duckdb|prisma|postgres(?:ql)?|mysql|mongodb|mongoose|redis|drizzle|sequelize|sqlite|supabase)\b/i,
  },
  {
    kind: 'browser_signal',
    pattern: /\b(?:playwright|puppeteer|chromium|firefox|webkit|page\.goto)\b/i,
  },
  {
    kind: 'required_arguments_signal',
    pattern: /\b(?:process\.argv|parseArgs?\s*\()/,
  },
]);

export async function qualifyRepository(repositoryRoot) {
  let root;
  try {
    root = await realpath(resolve(repositoryRoot));
    const metadata = await stat(root);
    if (!metadata.isDirectory()) throw new Error('not a directory');
  } catch {
    return inaccessibleQualification('Repository could not be accessed as a local directory.');
  }

  let git;
  let lanes;
  let scan;
  try {
    [git, lanes, scan] = await Promise.all([
      inspectGitDiff(root),
      detectRuntimeLanes(root),
      scanQualificationSources(root),
    ]);
  } catch {
    return inaccessibleQualification(
      'Repository metadata could not be inspected with the bounded local qualification contract.'
    );
  }

  const discoveredCandidates = discoverCandidates(scan);
  const candidates = rankCandidates(discoveredCandidates).slice(0, QUALIFICATION_LIMITS.candidates);
  const supportedAdapters = new Set(
    lanes.lanes.flatMap((lane) =>
      lane.adapters.flatMap((adapter) => (adapter === 'go-test' ? ['go-bench'] : [adapter]))
    )
  );
  const result = classifyQualification({
    subject: {
      repository_revision: git.repository_revision,
      dirty: git.dirty,
    },
    lanes: lanes.lanes,
    candidates,
    supportedAdapters,
    scan: {
      files_considered: scan.filesConsidered,
      source_files_read: scan.sources.length,
      source_bytes_read: scan.sourceBytes,
      candidates_discovered: discoveredCandidates.length,
      truncated: scan.truncated || discoveredCandidates.length > candidates.length,
    },
  });
  return assertQualification(result);
}

export async function qualifyPortfolioManifest(manifestPath) {
  const absoluteManifest = resolve(manifestPath);
  const metadata = await stat(absoluteManifest);
  if (!metadata.isFile() || metadata.size > QUALIFICATION_LIMITS.manifestBytes) {
    throw new Error('qualification manifest must be a bounded regular file');
  }
  const source = await readFile(absoluteManifest, 'utf8');
  const manifest = assertPortfolioManifest(JSON.parse(source));
  const repositories = [];
  for (const entry of manifest.repositories) {
    const qualification = await qualifyRepository(resolve(dirname(absoluteManifest), entry.path));
    repositories.push({ repository_id: entry.id, ...qualification });
  }
  const summary = Object.fromEntries(
    [
      'total',
      'ready',
      'needs_selection',
      'no_representative_workload',
      'unsupported',
      'inaccessible',
    ].map((status) => [
      status,
      status === 'total'
        ? repositories.length
        : repositories.filter((entry) => entry.status === status).length,
    ])
  );
  return assertPortfolioReport({
    schema_version: PORTFOLIO_REPORT_SCHEMA_VERSION,
    manifest_digest: createHash('sha256').update(source).digest('hex'),
    repositories,
    summary,
    limitations: [
      'Qualification inspected bounded local metadata and source text only; it did not execute project code.',
      'A ready workload is a profiling candidate, not proof that it represents production traffic.',
    ],
  });
}

function inaccessibleQualification(reason) {
  return assertQualification({
    schema_version: QUALIFICATION_SCHEMA_VERSION,
    status: 'inaccessible',
    subject: { repository_revision: null, dirty: null },
    lanes: [],
    candidates: [],
    recommended: null,
    next_action: {
      kind: 'repair_repository_access',
      reason,
    },
    limitations: [reason],
    scan: {
      files_considered: 0,
      source_files_read: 0,
      source_bytes_read: 0,
      candidates_discovered: 0,
      truncated: false,
    },
  });
}

function classifyQualification({ subject, lanes, candidates, supportedAdapters, scan }) {
  const usable = candidates.filter((candidate) => supportedAdapters.has(candidate.adapter));
  const safe = usable.filter((candidate) => candidate.safety_flags.length === 0);
  const selectableBrowser = usable.filter(
    (candidate) =>
      candidate.adapter === 'playwright' &&
      candidate.safety_flags.every((flag) => flag.kind === 'browser_signal')
  );
  const automaticallyEligible = safe.filter(
    (candidate) => candidate.adapter !== 'playwright' && hasDirectMeasurementEvidence(candidate)
  );
  const top = automaticallyEligible[0] ?? null;
  const runnerUp = automaticallyEligible[1] ?? null;
  const unambiguous =
    top && top.score >= READY_SCORE && (!runnerUp || top.score - runnerUp.score >= READY_LEAD);
  let status;
  let recommended = null;
  let nextAction;
  const limitations = [];

  if (unambiguous) {
    status = 'ready';
    recommended = {
      adapter: top.adapter,
      target: top.target,
      name: top.name,
      samples: LIMITS.defaultSamples,
      warmups: LIMITS.defaultWarmups,
      timeout_ms: LIMITS.timeoutMs,
    };
    nextAction = {
      kind: 'profile_exact_workload',
      reason: `Candidate ${top.id} crossed the qualification threshold with no safety flags.`,
    };
  } else if (usable.length > 0) {
    status = 'needs_selection';
    nextAction = {
      kind:
        selectableBrowser.length > 0
          ? 'select_representative_browser_flow'
          : safe.length === 0
            ? 'review_safety_and_select'
            : 'select_representative_workload',
      reason:
        selectableBrowser.length > 0
          ? 'Playwright flows were discovered, but only the caller can declare which exact flow is representative.'
          : safe.length === 0
            ? 'Every discovered candidate has a possible external-operation or non-product-scope signal.'
            : automaticallyEligible.length === 0
              ? 'Names suggest possible performance relevance, but no candidate contains direct benchmark or timing evidence.'
              : 'Direct measurement evidence is ambiguous or below the automatic qualification threshold.',
    };
    if (safe.length === 0 && selectableBrowser.length === 0)
      limitations.push('No candidate was safe enough for automatic profiling.');
  } else if (supportedAdapters.size > 0) {
    status = 'no_representative_workload';
    nextAction = {
      kind: 'add_or_identify_representative_workload',
      reason:
        'A supported runtime exists, but bounded source evidence found no exact performance workload.',
    };
  } else {
    status = 'unsupported';
    nextAction = {
      kind: 'use_project_owned_verifier',
      reason: 'No supported local Node, Vitest, or Go performance adapter was established.',
    };
  }

  if (scan.truncated) limitations.push('Qualification scan reached a configured evidence bound.');
  if (subject.dirty) {
    limitations.push(
      'The repository is dirty; any later profile must retain this snapshot qualification.'
    );
  }
  limitations.push(
    'Qualification did not execute the workload or prove production representativeness.'
  );

  return {
    schema_version: QUALIFICATION_SCHEMA_VERSION,
    status,
    subject,
    lanes,
    candidates: usable,
    recommended,
    next_action: nextAction,
    limitations,
    scan,
  };
}

async function scanQualificationSources(root) {
  const queue = [{ directory: root, depth: 0 }];
  const filePaths = [];
  let truncated = false;
  while (queue.length > 0) {
    const current = queue.shift();
    let entries;
    try {
      entries = await readdir(current.directory, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (EXCLUDED_PATH_PARTS.includes(entry.name)) continue;
      const absolute = join(current.directory, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < QUALIFICATION_LIMITS.sourceDepth) {
          queue.push({ directory: absolute, depth: current.depth + 1 });
        }
        continue;
      }
      if (!entry.isFile() || !isQualificationFile(entry.name, absolute, root)) continue;
      if (filePaths.length >= QUALIFICATION_LIMITS.sourceFiles) {
        truncated = true;
        break;
      }
      filePaths.push(relative(root, absolute).split(sep).join('/'));
    }
    if (truncated) break;
  }

  const packages = [];
  const sources = [];
  let sourceBytes = 0;
  for (const path of filePaths) {
    const absolute = join(root, path);
    let metadata;
    try {
      metadata = await stat(absolute);
    } catch {
      continue;
    }
    if (!metadata.isFile() || metadata.size > QUALIFICATION_LIMITS.sourceFileBytes) continue;
    if (sourceBytes + metadata.size > QUALIFICATION_LIMITS.sourceBytes) {
      truncated = true;
      break;
    }
    let text;
    try {
      text = await readFile(absolute, 'utf8');
    } catch {
      continue;
    }
    sourceBytes += metadata.size;
    if (path.endsWith('package.json')) {
      try {
        packages.push({
          kind: 'node',
          scope: normalizeScope(dirname(path)),
          path,
          manifest: JSON.parse(text),
        });
      } catch {
        // Invalid package metadata remains detection evidence but cannot select an adapter.
      }
    } else if (path.endsWith('go.mod')) {
      packages.push({ kind: 'go', scope: normalizeScope(dirname(path)), path, manifest: null });
    } else {
      sources.push({ path, text });
    }
  }
  packages.sort(
    (left, right) => right.scope.length - left.scope.length || left.path.localeCompare(right.path)
  );
  return { filesConsidered: filePaths.length, packages, sources, sourceBytes, truncated };
}

function isQualificationFile(name, absolute, root) {
  const path = relative(root, absolute).split(sep).join('/');
  return (
    name === 'package.json' ||
    name === 'go.mod' ||
    GO_TEST_PATTERN.test(path) ||
    (SOURCE_EXTENSION.has(extname(name)) && TEST_FILE_PATTERN.test(path))
  );
}

function discoverCandidates(scan) {
  const candidates = [];
  for (const source of scan.sources) {
    if (source.path.endsWith('_test.go')) {
      const goPackage = nearestPackage(source.path, scan.packages, 'go');
      if (!goPackage) continue;
      for (const match of source.text.matchAll(GO_BENCHMARK_PATTERN)) {
        candidates.push(
          buildCandidate({
            adapter: 'go-bench',
            target: source.path,
            name: match[1],
            packageScope: goPackage.scope,
            source,
            index: match.index,
            explicitBenchmark: true,
          })
        );
      }
      continue;
    }

    const nodePackage = nearestPackage(source.path, scan.packages, 'node');
    if (!nodePackage) continue;
    const names = [...source.text.matchAll(TEST_LITERAL_PATTERN)];
    if (names.length === 0 && isStandaloneNodeBenchmark(source)) {
      candidates.push(
        buildCandidate({
          adapter: 'node-script',
          target: source.path,
          name: null,
          packageScope: nodePackage.scope,
          source,
          index: 0,
          explicitBenchmark: false,
        })
      );
      continue;
    }
    const adapter = nodeAdapter(source.text, nodePackage.manifest);
    if (!adapter) continue;
    if (names.length === 0) {
      if (!hasRunnerDeclaration(source.text, adapter)) continue;
      candidates.push(
        buildCandidate({
          adapter,
          target: source.path,
          name: null,
          packageScope: nodePackage.scope,
          source,
          index: 0,
          explicitBenchmark: false,
        })
      );
      continue;
    }
    for (const match of names) {
      candidates.push(
        buildCandidate({
          adapter,
          target: source.path,
          name: match[2],
          packageScope: nodePackage.scope,
          source,
          index: match.index,
          explicitBenchmark: false,
        })
      );
    }
  }
  return deduplicateCandidates(candidates);
}

function isStandaloneNodeBenchmark(source) {
  return (
    /\.(?:cjs|js|mjs)$/.test(source.path) &&
    /(?:bench(?:mark)?|performance|perf)/i.test(source.path.split('/').at(-1)) &&
    (/^#!.*\bnode\b/m.test(source.text) ||
      (/\bconsole\.(?:log|error)\s*\(/.test(source.text) &&
        TIMING_SOURCE_PATTERN.test(source.text))) &&
    !hasRunnerDeclaration(source.text, 'vitest') &&
    !hasRunnerDeclaration(source.text, 'node-test')
  );
}

function hasRunnerDeclaration(source, adapter) {
  if (adapter === 'vitest') {
    return /(?:from|require\s*\()\s*['"]vitest['"]/m.test(source);
  }
  if (adapter === 'playwright') {
    return /(?:from|require\s*\()\s*['"]@playwright\/test['"]/m.test(source);
  }
  return /['"]node:test(?:\/[^'"]+)?['"]/.test(source);
}

function nodeAdapter(source, manifest) {
  const dependencies = new Set([
    ...Object.keys(manifest?.dependencies ?? {}),
    ...Object.keys(manifest?.devDependencies ?? {}),
    ...Object.keys(manifest?.optionalDependencies ?? {}),
  ]);
  if (/(?:from|require\s*\()\s*['"]@playwright\/test['"]/m.test(source)) {
    return 'playwright';
  }
  if (dependencies.has('vitest') || /(?:from|require\s*\()\s*['"]vitest['"]/m.test(source)) {
    return 'vitest';
  }
  const scripts = Object.values(manifest?.scripts ?? {}).join(' ');
  if (/['"]node:test(?:\/[^'"]+)?['"]/.test(source) || /\bnode\s+--test\b/.test(scripts)) {
    return 'node-test';
  }
  return null;
}

function buildCandidate({ adapter, target, name, packageScope, source, index, explicitBenchmark }) {
  const signals = [];
  if (explicitBenchmark) signals.push(signal('explicit_go_benchmark', 90, name));
  const fileLabel = target.split('/').at(-1);
  if (/bench(?:mark)?/i.test(fileLabel)) signals.push(signal('benchmark_file_name', 55, fileLabel));
  else if (/(?:performance|perf)/i.test(fileLabel)) {
    signals.push(signal('performance_file_name', 45, fileLabel));
  }
  if (name && /\bbench(?:mark)?\b/i.test(name))
    signals.push(signal('benchmark_workload_name', 50, name));
  else if (name && /\b(?:performance|perf|throughput|latency)\b/i.test(name)) {
    signals.push(signal('performance_workload_name', 40, name));
  } else if (name && PERFORMANCE_WORDS.test(name)) {
    signals.push(signal('scale_workload_name', 25, name));
  }
  if (TIMING_SOURCE_PATTERN.test(source.text)) {
    signals.push(signal('timing_measurement_source', 25, target));
  }
  if (signals.length === 0) signals.push(signal('generic_test_scope', 5, target));

  const safetyFlags = safetyFlagsFor({ target, packageScope, source: source.text });
  const score = Math.min(
    100,
    signals.reduce((total, entry) => total + entry.weight, 0)
  );
  const identity = `${adapter}\0${target}\0${name ?? ''}`;
  return {
    id: createHash('sha256').update(identity).digest('hex').slice(0, 16),
    adapter,
    target,
    name,
    package_scope: packageScope,
    score,
    signals,
    safety_flags: safetyFlags,
    evidence: [
      {
        kind: explicitBenchmark ? 'benchmark_declaration' : 'literal_test_declaration',
        file: target,
        line: lineNumber(source.text, index),
      },
    ],
  };
}

function safetyFlagsFor({ target, packageScope, source }) {
  const flags = [];
  const networkKind = networkSafetyKind(source);
  if (networkKind) flags.push({ kind: networkKind, evidence: target });
  for (const candidate of SAFETY_PATTERNS) {
    if (candidate.pattern.test(source)) flags.push({ kind: candidate.kind, evidence: target });
  }
  if (/(?:^|\/)(?:e2e|integration)(?:\/|\.|-)/i.test(target)) {
    flags.push({ kind: 'integration_scope', evidence: target });
  }
  if (/(?:^|\/)(?:docs?|examples?|fixtures?)(?:\/|$)/i.test(`${packageScope}/${target}`)) {
    flags.push({ kind: 'non_product_scope', evidence: packageScope });
  }
  return flags.slice(0, QUALIFICATION_LIMITS.flagsPerCandidate);
}

function networkSafetyKind(source) {
  NETWORK_CALL_PATTERN.lastIndex = 0;
  for (const match of source.matchAll(NETWORK_CALL_PATTERN)) {
    const argument = (match[2] ?? match[3] ?? '').trim();
    if (!LOOPBACK_ENDPOINT_PATTERN.test(argument)) return 'remote_network_signal';
  }
  NETWORK_CALL_PATTERN.lastIndex = 0;
  return [...source.matchAll(NETWORK_CALL_PATTERN)].length > 0 ? 'local_service_signal' : null;
}

function rankCandidates(candidates) {
  return [...candidates].sort(
    (left, right) =>
      right.score - left.score ||
      left.safety_flags.length - right.safety_flags.length ||
      left.target.localeCompare(right.target) ||
      String(left.name).localeCompare(String(right.name))
  );
}

function deduplicateCandidates(candidates) {
  const found = new Map();
  for (const candidate of candidates) {
    if (!found.has(candidate.id)) found.set(candidate.id, candidate);
  }
  return [...found.values()];
}

function nearestPackage(path, packages, kind) {
  return packages.find(
    (entry) =>
      entry.kind === kind &&
      (entry.scope === '.' || path === entry.scope || path.startsWith(`${entry.scope}/`))
  );
}

function normalizeScope(path) {
  return path === '.' || path === '' ? '.' : path.split(sep).join('/');
}

function signal(kind, weight, evidence) {
  return { kind, weight, evidence };
}

function lineNumber(source, index = 0) {
  return source.slice(0, index ?? 0).split('\n').length;
}

export function candidateLooksPerformanceRelated(candidate) {
  return candidate.signals.some(
    (entry) => entry.kind !== 'generic_test_scope' || STRONG_PERFORMANCE_WORDS.test(entry.evidence)
  );
}

function hasDirectMeasurementEvidence(candidate) {
  return candidate.signals.some((entry) =>
    ['explicit_go_benchmark', 'timing_measurement_source'].includes(entry.kind)
  );
}
