import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';

import { EXCLUDED_PATH_PARTS, LIMITS, repositoryRelative } from './contracts.mjs';
import { detectRuntimeLanes } from './detect.mjs';
import { inspectGitDiff } from './git-diff.mjs';
import { inferDeclaredBrowserServer } from './local-server-qualification.mjs';
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
const DEFAULT_FLOW_ADAPTER_FLOOR = 4;
const PLAYWRIGHT_FLOW_ADAPTER_FLOOR = 16;
const FLOW_ADAPTER_ORDER = ['go-bench', 'node-script', 'node-test', 'vitest', 'jest', 'playwright'];
const SOURCE_EXTENSION = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);
const TEST_FILE_PATTERN =
  /(?:^|\/)(?:__tests__\/.*|[^/]*(?:test|spec|bench|benchmark|performance|perf)[^/]*\.[cm]?[jt]sx?)$/i;
const GO_TEST_PATTERN = /_test\.go$/;
const PERFORMANCE_WORDS = /\b(?:bench(?:mark)?|perf|throughput|latency|allocation|scale|stress)\b/i;
const STRONG_PERFORMANCE_WORDS = /\b(?:bench(?:mark)?|performance|perf)\b/i;
const TEST_LITERAL_PATTERN =
  /\b(?:test|it)(?:\.(?:only|skip|todo|concurrent))?\s*\(\s*(['"`])([^'"`\n]{1,160})\1/g;
const GO_BENCHMARK_PATTERN =
  /\bfunc\s+(Benchmark[A-Za-z0-9_]+)\s*\(\s*[A-Za-z0-9_]+\s+\*testing\.B\s*\)/g;
const EXECUTABLE_TIMING_SOURCE_PATTERN =
  /(?:^|[^\w$.])(?:performance\.now|console\.(?:time|timeEnd)|(?:process\.)?hrtime(?:\.bigint)?)\s*\(/m;
const NETWORK_CALL_PATTERN =
  /\b(?:fetch|axios(?:\.[A-Za-z]+)?|got|ky|https?\.request|new\s+WebSocket)\s*\(\s*(?:(['"`])([^'"`\r\n]{0,500})\1|([^,)\r\n]{1,500}))/gi;
const LOOPBACK_ENDPOINT_PATTERN =
  /^(?:https?|wss?):\/\/(?:localhost(?::|\/|$)|127\.0\.0\.1(?::|\/|$)|\[::1\](?::|\/|$))/i;
const REMOTE_LITERAL_PATTERN =
  /['"`](?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/:][^'"`]*)?['"`]/i;
const PLAYWRIGHT_CONFIG_PATTERN = /(?:^|\/)playwright(?:\.[^/]+)?\.config\.[cm]?[jt]s$/i;
const SERVER_DOCUMENT_ASSERTION_PATTERN =
  /\b(?:page\.title\s*\(|page\.content\s*\(|server[- ]rewritten|locator\s*\(\s*['"`]meta\b)/i;
const MUTATING_STANDALONE_NAME_PATTERN =
  /(?:^|[-_.])(?:build|bundle|compile|deploy|generate|generator|migrate|migration|prepare|publish|release|seed|sync|update)(?:[-_.]|$)/i;
const DIRECT_FILESYSTEM_WRITE_PATTERN =
  /\b(?:[A-Za-z_$][\w$]*\.)?(?:appendFile|appendFileSync|createWriteStream|mkdir|mkdirSync|rename|renameSync|rm|rmSync|truncate|truncateSync|unlink|unlinkSync|writeFile|writeFileSync)\s*\(/;
const LARGE_STATIC_JSON_FIXTURE_BYTES = 1024 * 1024;
const STATIC_JSON_IMPORT_PATTERN =
  /\bimport(?:\s+[^'"\n]*?\s+from\s*)?\s*(['"])(\.{1,2}\/[^'"\n]+\.json)\1/g;
const SECRET_LIKE_IMPORT_PATTERN =
  /(?:^|[-_.])(?:credential|env|password|secret|token)(?:[-_.]|$)/i;

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

  let gitBefore;
  let lanes;
  let scan;
  try {
    [gitBefore, lanes, scan] = await Promise.all([
      inspectGitDiff(root),
      detectRuntimeLanes(root),
      scanQualificationSources(root),
    ]);
  } catch {
    return inaccessibleQualification(
      'Repository metadata could not be inspected with the bounded local qualification contract.'
    );
  }
  let git;
  try {
    git = await inspectGitDiff(root);
  } catch {
    return inaccessibleQualification(
      'Repository source identity could not be rechecked after bounded qualification.'
    );
  }
  if (
    git.repository_revision !== gitBefore.repository_revision ||
    git.source_snapshot_sha256 !== gitBefore.source_snapshot_sha256
  ) {
    return inaccessibleQualification('Repository source changed during bounded qualification.');
  }

  const discoveredFlows = discoverCandidates(scan);
  await flagLargeStaticJsonFixtures(root, scan.sources, discoveredFlows);
  const flows = selectBoundedFlows(discoveredFlows, QUALIFICATION_LIMITS.flows);
  const candidates = rankCandidates(
    discoveredFlows.filter((candidate) => candidate.adapter !== 'playwright')
  ).slice(0, QUALIFICATION_LIMITS.candidates);
  const supportedAdapters = new Set(
    lanes.lanes
      .flatMap((lane) =>
        lane.adapters.flatMap((adapter) => (adapter === 'go-test' ? ['go-bench'] : [adapter]))
      )
      .filter((adapter) => adapter !== 'playwright')
  );
  const result = classifyQualification({
    subject: {
      repository_revision: git.repository_revision,
      source_snapshot_sha256: git.source_snapshot_sha256,
      dirty: git.dirty,
    },
    lanes: lanes.lanes,
    flows,
    candidates,
    supportedAdapters,
    scan: {
      files_considered: scan.filesConsidered,
      source_files_read: scan.sources.length,
      source_bytes_read: scan.sourceBytes,
      candidates_discovered: discoveredFlows.length,
      truncated: scan.truncated || discoveredFlows.length > flows.length,
    },
  });
  return assertQualification(result);
}

async function flagLargeStaticJsonFixtures(root, sources, candidates) {
  const candidatesByTarget = new Map();
  for (const candidate of candidates) {
    const targetCandidates = candidatesByTarget.get(candidate.target) ?? [];
    targetCandidates.push(candidate);
    candidatesByTarget.set(candidate.target, targetCandidates);
  }
  for (const source of sources) {
    const targetCandidates = candidatesByTarget.get(source.path);
    if (!targetCandidates) continue;
    STATIC_JSON_IMPORT_PATTERN.lastIndex = 0;
    const specifiers = [...source.text.matchAll(STATIC_JSON_IMPORT_PATTERN)]
      .map((match) => match[2])
      .filter((specifier) => !SECRET_LIKE_IMPORT_PATTERN.test(specifier))
      .slice(0, QUALIFICATION_LIMITS.flagsPerCandidate);
    for (const specifier of specifiers) {
      let importedPath;
      try {
        importedPath = await realpath(resolve(root, dirname(source.path), specifier));
      } catch {
        continue;
      }
      if (repositoryRelative(root, importedPath) === null) continue;
      let metadata;
      try {
        metadata = await stat(importedPath);
      } catch {
        continue;
      }
      if (!metadata.isFile() || metadata.size <= LARGE_STATIC_JSON_FIXTURE_BYTES) continue;
      for (const candidate of targetCandidates) {
        if (
          candidate.safety_flags.some((flag) => flag.kind === 'large_static_json_fixture_signal')
        ) {
          continue;
        }
        candidate.safety_flags = [
          ...candidate.safety_flags,
          { kind: 'large_static_json_fixture_signal', evidence: source.path },
        ].slice(0, QUALIFICATION_LIMITS.flagsPerCandidate);
      }
    }
  }
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
    subject: { repository_revision: null, source_snapshot_sha256: null, dirty: null },
    lanes: [],
    flows: [],
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

function classifyQualification({ subject, lanes, flows, candidates, supportedAdapters, scan }) {
  const usable = candidates.filter((candidate) => supportedAdapters.has(candidate.adapter));
  const safe = usable.filter((candidate) => candidate.safety_flags.length === 0);
  const automaticallyEligible = safe.filter(hasDirectMeasurementEvidence);
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
      kind: safe.length === 0 ? 'review_safety_and_select' : 'select_representative_workload',
      reason:
        safe.length === 0
          ? 'Every discovered candidate has a possible external-operation or non-product-scope signal.'
          : automaticallyEligible.length === 0
            ? 'Names suggest possible performance relevance, but no candidate contains direct benchmark or timing evidence.'
            : 'Direct measurement evidence is ambiguous or below the automatic qualification threshold.',
    };
    if (safe.length === 0)
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
    flows,
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
    PLAYWRIGHT_CONFIG_PATTERN.test(path) ||
    GO_TEST_PATTERN.test(path) ||
    (SOURCE_EXTENSION.has(extname(name)) && TEST_FILE_PATTERN.test(path))
  );
}

function discoverCandidates(scan) {
  const candidates = [];
  const browserOrigins = discoverStaticBrowserOrigins(scan.sources, scan.packages);
  for (const source of scan.sources) {
    if (PLAYWRIGHT_CONFIG_PATTERN.test(source.path)) continue;
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
          packageManifest: nodePackage.manifest,
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
        ...buildCandidateVariants({
          adapter,
          target: source.path,
          name: null,
          packageScope: nodePackage.scope,
          packageManifest: nodePackage.manifest,
          source,
          index: 0,
          explicitBenchmark: false,
          browserQualification:
            adapter === 'playwright'
              ? nearestStaticBrowserOrigin(source.path, browserOrigins)
              : null,
        })
      );
      continue;
    }
    for (const [matchIndex, match] of names.entries()) {
      candidates.push(
        ...buildCandidateVariants({
          adapter,
          target: source.path,
          name: match[2],
          packageScope: nodePackage.scope,
          packageManifest: nodePackage.manifest,
          source,
          candidateSource: source.text.slice(
            match.index,
            names[matchIndex + 1]?.index ?? source.text.length
          ),
          index: match.index,
          explicitBenchmark: false,
          browserQualification:
            adapter === 'playwright'
              ? nearestStaticBrowserOrigin(source.path, browserOrigins)
              : null,
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
        hasExecutableTimingSource(source.text))) &&
    !hasRunnerDeclaration(source.text, 'vitest') &&
    !hasRunnerDeclaration(source.text, 'jest') &&
    !hasRunnerDeclaration(source.text, 'node-test')
  );
}

function hasRunnerDeclaration(source, adapter) {
  if (adapter === 'playwright') {
    return /(?:from|require\s*\()\s*['"]@playwright\/test['"]/m.test(source);
  }
  if (adapter === 'vitest') {
    return /(?:from|require\s*\()\s*['"]vitest['"]/m.test(source);
  }
  if (adapter === 'jest') {
    return /(?:from|require\s*\()\s*['"]@jest\/globals['"]/m.test(source);
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
  if (/(?:from|require\s*\()\s*['"]vitest['"]/m.test(source)) {
    return 'vitest';
  }
  if (/(?:from|require\s*\()\s*['"]@jest\/globals['"]/m.test(source)) {
    return 'jest';
  }
  if (/['"]node:test(?:\/[^'"]+)?['"]/.test(source)) return 'node-test';
  if (dependencies.has('@playwright/test') && hasRunnerDeclaration(source, 'playwright')) {
    return 'playwright';
  }
  const hasVitest = dependencies.has('vitest');
  const hasJest = dependencies.has('jest');
  if (hasVitest !== hasJest) return hasVitest ? 'vitest' : 'jest';
  const scripts = Object.values(manifest?.scripts ?? {}).join(' ');
  if (/['"]node:test(?:\/[^'"]+)?['"]/.test(source) || /\bnode\s+--test\b/.test(scripts)) {
    return 'node-test';
  }
  return null;
}

function buildCandidate({
  adapter,
  target,
  name,
  packageScope,
  packageManifest = null,
  source,
  candidateSource = source.text,
  index,
  explicitBenchmark,
  browserQualification = null,
  browserProfile = null,
}) {
  const signals = [];
  if (explicitBenchmark) signals.push(signal('explicit_go_benchmark', 90, name));
  const fileLabel = target.split('/').at(-1);
  if (/bench(?:mark)?/i.test(fileLabel)) signals.push(signal('benchmark_file_name', 55, fileLabel));
  else if (/(?:performance|perf)/i.test(fileLabel)) {
    signals.push(signal('performance_file_name', 45, fileLabel));
  }
  if (name && /\bbench(?:mark)?\b/i.test(name))
    signals.push(signal('benchmark_workload_name', 50, name));
  else if (name && /\b(?:perf|throughput|latency)\b/i.test(name)) {
    signals.push(signal('performance_workload_name', 40, name));
  } else if (name && PERFORMANCE_WORDS.test(name)) {
    signals.push(signal('scale_workload_name', 25, name));
  }
  if (hasExecutableTimingSource(candidateSource)) {
    signals.push(signal('timing_measurement_source', 25, target));
  }
  if (adapter === 'playwright' && /\bpage\.route\s*\(/.test(candidateSource)) {
    signals.push(signal('browser_request_fixture', 10, target));
  }
  if (adapter === 'playwright') {
    const warmupPath = staticBrowserWarmupPath(candidateSource);
    if (warmupPath) {
      signals.push(signal('declared_browser_warmup_path', 0, warmupPath));
    }
    for (const expected of staticExpectedHttpStatuses(candidateSource)) {
      signals.push(
        signal(
          'declared_expected_http_status',
          0,
          `${expected.method} ${expected.route} ${expected.status}`
        )
      );
    }
  }
  if (adapter === 'playwright' && browserQualification?.base_url) {
    signals.push(signal('loopback_browser_base_url', 0, browserQualification.base_url));
    if (browserQualification.origin_provenance === 'synthesized_local_vite') {
      signals.push(signal('synthesized_loopback_vite_origin', 0, browserQualification.base_url));
    }
    if (browserProfile) {
      signals.push(signal('declared_playwright_project', 0, browserProfile.project_name));
      if (browserProfile.device_name) {
        signals.push(signal('declared_playwright_device', 0, browserProfile.device_name));
      }
    }
    if (browserQualification.server) {
      signals.push(
        signal('declared_browser_server_family', 0, browserQualification.server.family),
        signal(
          'declared_browser_server_command_sha256',
          0,
          browserQualification.server.command_sha256
        )
      );
    }
  }
  if (signals.length === 0) signals.push(signal('generic_test_scope', 5, target));

  const safetyFlags = safetyFlagsFor({ target, packageScope, source: candidateSource });
  if (
    adapter === 'playwright' &&
    (REMOTE_LITERAL_PATTERN.test(candidateSource) ||
      /\b(?:deployed|production|live|remote)\s+(?:api|service|server)\b/i.test(name ?? ''))
  ) {
    safetyFlags.push({ kind: 'remote_service_signal', evidence: target });
  }
  if (
    adapter === 'playwright' &&
    browserQualification?.origin_provenance === 'synthesized_local_vite' &&
    SERVER_DOCUMENT_ASSERTION_PATTERN.test(candidateSource)
  ) {
    safetyFlags.push({ kind: 'server_document_semantics_signal', evidence: target });
  }
  if (
    adapter === 'playwright' &&
    browserQualification?.project_declaration_state === 'unsupported'
  ) {
    safetyFlags.push({ kind: 'browser_project_unresolved_signal', evidence: target });
  }
  if (name?.includes('${')) {
    safetyFlags.push({ kind: 'dynamic_test_name_signal', evidence: target });
  }
  if (
    adapter === 'node-test' &&
    /\.(?:cts|mts|ts|tsx)$/.test(target) &&
    !declaresNodeDependency(packageManifest, 'tsx')
  ) {
    safetyFlags.push({ kind: 'typescript_node_loader_unresolved_signal', evidence: target });
  }
  if (adapter === 'node-script') {
    if (MUTATING_STANDALONE_NAME_PATTERN.test(target.split('/').at(-1))) {
      safetyFlags.push({ kind: 'standalone_generator_script_signal', evidence: target });
    }
    if (DIRECT_FILESYSTEM_WRITE_PATTERN.test(candidateSource)) {
      safetyFlags.push({ kind: 'standalone_filesystem_write_signal', evidence: target });
    }
  }
  const score = Math.min(
    100,
    signals.reduce((total, entry) => total + entry.weight, 0)
  );
  const identity = `${adapter}\0${target}\0${name ?? ''}\0${browserProfile?.project_name ?? ''}`;
  return {
    id: createHash('sha256').update(identity).digest('hex').slice(0, 16),
    adapter,
    target,
    name,
    package_scope: packageScope,
    score,
    signals,
    safety_flags: safetyFlags,
    ...(browserProfile ? { browser_profile: browserProfile } : {}),
    evidence: [
      {
        kind: explicitBenchmark ? 'benchmark_declaration' : 'literal_test_declaration',
        file: target,
        line: lineNumber(source.text, index),
      },
    ],
  };
}

function declaresNodeDependency(manifest, name) {
  return ['dependencies', 'devDependencies', 'optionalDependencies'].some(
    (field) => typeof manifest?.[field]?.[name] === 'string'
  );
}

function staticBrowserWarmupPath(source) {
  const matches = [
    ...source.matchAll(
      /\b(?:page\.goto|(?:page\.)?request\.get)\s*\(\s*(['"])(\/(?!\/)[^?'"#\r\n]{0,500})\1/g
    ),
  ].sort((left, right) => left.index - right.index);
  return matches[0]?.[2] ?? null;
}

function staticExpectedHttpStatuses(source) {
  const expected = [];
  for (const match of source.matchAll(
    /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+page\.request\.(get|post|put|patch|delete|head)\s*\(\s*(['"])(\/[^'"\r\n]{0,500})\3/gi
  )) {
    const variable = match[1];
    const remainder = source.slice(match.index + match[0].length, match.index + 2_000);
    const assertion = new RegExp(
      `\\bexpect\\s*\\(\\s*${escapeRegExp(variable)}\\.status\\s*\\(\\s*\\)\\s*\\)\\.toBe\\s*\\(\\s*(\\d{3})\\s*\\)`
    ).exec(remainder);
    const status = assertion ? Number(assertion[1]) : null;
    if (status !== null && status >= 100 && status <= 599) {
      expected.push({ method: match[2].toUpperCase(), route: match[4], status });
    }
  }
  return expected.slice(0, 8);
}

function buildCandidateVariants(input) {
  const profiles = input.browserQualification?.project_profiles ?? [];
  if (input.adapter !== 'playwright' || profiles.length === 0) {
    return [buildCandidate(input)];
  }
  return profiles
    .filter((entry) => !entry.test_ignore_patterns.some((pattern) => pattern.test(input.target)))
    .map((entry) => buildCandidate({ ...input, browserProfile: entry.profile }));
}

function discoverStaticBrowserOrigins(sources, packages) {
  const origins = [];
  for (const source of sources) {
    if (!PLAYWRIGHT_CONFIG_PATTERN.test(source.path)) continue;
    const values = staticBaseUrlLiterals(source.text).map(normalizeLoopbackBaseUrl).filter(Boolean);
    const scope = normalizeScope(dirname(source.path));
    const nodePackage = nearestPackage(source.path, packages, 'node');
    const projectProfiles = staticPlaywrightProjectProfiles(source.text);
    const hasProjectDeclaration = /\bprojects\s*(?::|[,}])/.test(source.text);
    const unique = [...new Set(values)];
    let synthesizedLocalVite = false;
    if (unique.length === 0 && hasStaticBaseUrlEnvironmentFallback(source.text)) {
      const localVite = 'http://127.0.0.1:5173';
      const server = inferDeclaredBrowserServer({
        configSource: source.text,
        baseUrl: localVite,
        manifest: nodePackage?.manifest ?? null,
      });
      if (server?.family === 'vite') {
        unique.push(localVite);
        synthesizedLocalVite = true;
      }
    }
    const candidates = unique.map((baseUrl) => ({
      scope,
      base_url: baseUrl,
      origin_provenance:
        synthesizedLocalVite && baseUrl === 'http://127.0.0.1:5173'
          ? 'synthesized_local_vite'
          : 'declared_loopback_literal',
      server: inferDeclaredBrowserServer({
        configSource: source.text,
        baseUrl,
        manifest: nodePackage?.manifest ?? null,
      }),
    }));
    const declared = candidates.filter((candidate) => candidate.server);
    const selected =
      candidates.length === 1 ? candidates[0] : declared.length === 1 ? declared[0] : null;
    if (selected) {
      origins.push({
        ...selected,
        project_profiles: projectProfiles,
        project_declaration_state: hasProjectDeclaration
          ? projectProfiles.length > 0
            ? 'qualified'
            : 'unsupported'
          : 'none',
        excluded_target_patterns: staticAlternateProjectPatterns(source.text, selected.base_url),
      });
    }
  }
  return origins.toSorted(
    (left, right) => right.scope.length - left.scope.length || left.scope.localeCompare(right.scope)
  );
}

function staticPlaywrightProjectProfiles(source) {
  const arrays = staticPropertyArrayObjectSources(source, 'projects');
  if (arrays.length === 0 && /\bprojects\s*(?:,|\})/.test(source)) {
    const named = staticConstArrayObjectSources(source, 'projects');
    if (named) arrays.push(named);
  }
  if (arrays.length !== 1) return [];
  const profiles = [];
  const names = new Set();
  const regexConstants = staticRegexConstants(source);
  for (const project of arrays[0]) {
    if (/\btestMatch\s*:/.test(project)) continue;
    const name = staticQuotedProperty(project, 'name');
    if (!name || names.has(name)) continue;
    const device = project.match(/\.\.\.\s*devices\s*\[\s*(['"])([^'"\r\n]{1,100})\1\s*\]/)?.[2];
    const viewportSource = staticObjectProperty(project, 'viewport');
    const viewport = viewportSource
      ? {
          width: staticIntegerProperty(viewportSource, 'width', 200, 4_096),
          height: staticIntegerProperty(viewportSource, 'height', 200, 4_096),
        }
      : null;
    if (!device && (!viewport || !viewport.width || !viewport.height)) continue;
    names.add(name);
    profiles.push({
      profile: {
        project_name: name,
        device_name: device ?? null,
        viewport: viewport?.width && viewport?.height ? viewport : null,
        device_scale_factor:
          staticNumberProperty(project, 'deviceScaleFactor', 0.25, 8) ?? (device ? null : 1),
        is_mobile: staticBooleanProperty(project, 'isMobile') ?? (device ? null : false),
        has_touch: staticBooleanProperty(project, 'hasTouch') ?? (device ? null : false),
        provenance: device ? 'static_playwright_device' : 'static_playwright_viewport',
      },
      test_ignore_patterns: staticProjectPatterns(project, 'testIgnore', regexConstants),
    });
  }
  return profiles;
}

function staticConstArrayObjectSources(source, name) {
  const matches = [];
  const declaration = new RegExp(`\\bconst\\s+${name}\\b`, 'g');
  for (const match of source.matchAll(declaration)) {
    let cursor = skipTrivia(source, match.index + match[0].length);
    if (source[cursor] === ':') {
      cursor += 1;
      while (cursor < source.length && source[cursor] !== '=' && source[cursor] !== ';') {
        const character = source[cursor];
        if (character === "'" || character === '"' || character === '`') {
          cursor = skipQuotedSource(source, cursor, character);
          continue;
        }
        cursor += 1;
      }
    }
    cursor = skipTrivia(source, cursor);
    if (source[cursor] !== '=') continue;
    cursor = skipTrivia(source, cursor + 1);
    if (source[cursor] !== '[') continue;
    const array = readBalancedSource(source, cursor, '[', ']');
    if (array) matches.push(topLevelObjectSources(source.slice(cursor + 1, array.end - 1)));
  }
  return matches.length === 1 ? matches[0] : null;
}

function staticRegexConstants(source) {
  const patterns = new Map();
  for (const match of source.matchAll(
    /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*\/((?:\\.|[^/\r\n])+)\/([imsuy]*)\s*;/g
  )) {
    try {
      patterns.set(match[1], new RegExp(match[2], match[3]));
    } catch {
      // Invalid regular expressions cannot filter an exact project flow.
    }
  }
  return patterns;
}

function staticProjectPatterns(project, property, constants) {
  const propertyPattern = new RegExp(`\\b${property}\\s*:\\s*`);
  const match = propertyPattern.exec(project);
  if (!match) return [];
  const cursor = skipTrivia(project, match.index + match[0].length);
  if (project[cursor] === '/') {
    const parsed = readStaticRegex(project, cursor);
    return parsed ? [parsed] : [];
  }
  const identifier = readIdentifier(project, cursor);
  return identifier && constants.has(identifier.value) ? [constants.get(identifier.value)] : [];
}

function readStaticRegex(source, start) {
  let body = '';
  let escaped = false;
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (!escaped && character === '/') {
      const flags = source.slice(index + 1).match(/^([imsuy]*)/)?.[1] ?? '';
      try {
        return new RegExp(body, flags);
      } catch {
        return null;
      }
    }
    body += character;
    escaped = !escaped && character === '\\';
    if (character !== '\\') escaped = false;
  }
  return null;
}

function staticPropertyArrayObjectSources(source, property) {
  const arrays = [];
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "'" || character === '"' || character === '`') {
      index = skipQuotedSource(source, index, character) - 1;
      continue;
    }
    if (character === '/' && source[index + 1] === '/') {
      index = skipLineComment(source, index + 2) - 1;
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      index = skipBlockComment(source, index + 2) - 1;
      continue;
    }
    if (
      !source.startsWith(property, index) ||
      isIdentifierCharacter(source[index - 1]) ||
      isIdentifierCharacter(source[index + property.length])
    ) {
      continue;
    }
    let cursor = skipTrivia(source, index + property.length);
    if (source[cursor] !== ':') continue;
    cursor = skipTrivia(source, cursor + 1);
    if (source[cursor] !== '[') continue;
    const array = readBalancedSource(source, cursor, '[', ']');
    if (!array) continue;
    arrays.push(topLevelObjectSources(source.slice(cursor + 1, array.end - 1)));
    index = array.end - 1;
  }
  return arrays;
}

function topLevelObjectSources(source) {
  const objects = [];
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "'" || character === '"' || character === '`') {
      index = skipQuotedSource(source, index, character) - 1;
      continue;
    }
    if (character === '/' && source[index + 1] === '/') {
      index = skipLineComment(source, index + 2) - 1;
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      index = skipBlockComment(source, index + 2) - 1;
      continue;
    }
    if (character !== '{') continue;
    const object = readBalancedSource(source, index, '{', '}');
    if (!object) return [];
    objects.push(source.slice(index, object.end));
    index = object.end - 1;
  }
  return objects;
}

function readBalancedSource(source, start, open, close) {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (character === "'" || character === '"' || character === '`') {
      index = skipQuotedSource(source, index, character) - 1;
      continue;
    }
    if (character === '/' && source[index + 1] === '/') {
      index = skipLineComment(source, index + 2) - 1;
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      index = skipBlockComment(source, index + 2) - 1;
      continue;
    }
    if (character === open) depth += 1;
    if (character === close) {
      depth -= 1;
      if (depth === 0) return { end: index + 1 };
    }
  }
  return null;
}

function staticQuotedProperty(source, property) {
  const match = source.match(new RegExp(`\\b${property}\\s*:\\s*(['"])([^'"\\r\\n]{1,100})\\1`));
  return match?.[2] ?? null;
}

function staticObjectProperty(source, property) {
  const match = new RegExp(`\\b${property}\\s*:`).exec(source);
  if (!match) return null;
  const start = skipTrivia(source, match.index + match[0].length);
  if (source[start] !== '{') return null;
  const object = readBalancedSource(source, start, '{', '}');
  return object ? source.slice(start, object.end) : null;
}

function staticIntegerProperty(source, property, minimum, maximum) {
  const value = staticNumberProperty(source, property, minimum, maximum);
  return Number.isInteger(value) ? value : null;
}

function staticNumberProperty(source, property, minimum, maximum) {
  const match = source.match(new RegExp(`\\b${property}\\s*:\\s*(\\d+(?:\\.\\d+)?)`));
  const value = Number(match?.[1]);
  return Number.isFinite(value) && value >= minimum && value <= maximum ? value : null;
}

function staticBooleanProperty(source, property) {
  const match = source.match(new RegExp(`\\b${property}\\s*:\\s*(true|false)\\b`));
  return match ? match[1] === 'true' : null;
}

function hasStaticBaseUrlEnvironmentFallback(source) {
  return /\bbaseURL\s*:\s*process\.env\.[A-Z][A-Z0-9_]*\s*(?:\|\||\?\?)\s*['"][^'"\r\n]+['"]/.test(
    source
  );
}

function staticBaseUrlLiterals(source) {
  const values = [];
  const constants = staticStringConstants(source);
  let index = 0;
  let depth = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === "'" || character === '"' || character === '`') {
      index = skipQuotedSource(source, index, character);
      continue;
    }
    if (character === '/' && source[index + 1] === '/') {
      index = skipLineComment(source, index + 2);
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      index = skipBlockComment(source, index + 2);
      continue;
    }
    if (character === '{' || character === '[') {
      depth += 1;
      index += 1;
      continue;
    }
    if (character === '}' || character === ']') {
      depth = Math.max(0, depth - 1);
      index += 1;
      continue;
    }
    if (
      source.startsWith('baseURL', index) &&
      !isIdentifierCharacter(source[index - 1]) &&
      !isIdentifierCharacter(source[index + 7])
    ) {
      let cursor = skipTrivia(source, index + 7);
      if (source[cursor] !== ':') {
        if ((source[cursor] === ',' || source[cursor] === '}') && constants.has('baseURL')) {
          values.push({ value: constants.get('baseURL'), depth });
        }
        index += 7;
        continue;
      }
      cursor = skipTrivia(source, cursor + 1);
      const quote = source[cursor];
      if (quote === "'" || quote === '"') {
        const parsed = readStaticQuotedValue(source, cursor, quote);
        if (parsed) values.push({ value: parsed.value, depth });
        index = parsed?.end ?? cursor + 1;
        continue;
      }
      const identifier = readIdentifier(source, cursor);
      if (identifier && constants.has(identifier.value)) {
        values.push({ value: constants.get(identifier.value), depth });
      }
      index = identifier?.end ?? index + 7;
      continue;
    }
    index += 1;
  }
  const minimumDepth = Math.min(...values.map((entry) => entry.depth));
  return values.filter((entry) => entry.depth === minimumDepth).map((entry) => entry.value);
}

function staticAlternateProjectPatterns(source, selectedBaseUrl) {
  const strings = staticStringConstants(source);
  const patterns = new Map();
  for (const match of source.matchAll(
    /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*\/((?:\\.|[^/\r\n])+)\/([imsuy]*)\s*;/g
  )) {
    try {
      patterns.set(match[1], new RegExp(match[2], match[3]));
    } catch {
      // An invalid static pattern cannot qualify or exclude a flow.
    }
  }
  const excluded = [];
  for (const match of source.matchAll(
    /\btestMatch\s*:\s*([A-Za-z_$][\w$]*)[\s\S]{0,512}?\bbaseURL\s*:\s*([A-Za-z_$][\w$]*)/g
  )) {
    const pattern = patterns.get(match[1]);
    const baseUrl = normalizeLoopbackBaseUrl(strings.get(match[2]));
    if (pattern && baseUrl && baseUrl !== selectedBaseUrl) excluded.push(pattern);
  }
  return excluded;
}

function staticStringConstants(source) {
  const values = new Map();
  const ambiguous = new Set();
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === "'" || character === '"' || character === '`') {
      index = skipQuotedSource(source, index, character);
      continue;
    }
    if (character === '/' && source[index + 1] === '/') {
      index = skipLineComment(source, index + 2);
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      index = skipBlockComment(source, index + 2);
      continue;
    }
    if (
      source.startsWith('const', index) &&
      !isIdentifierCharacter(source[index - 1]) &&
      !isIdentifierCharacter(source[index + 5])
    ) {
      const name = readIdentifier(source, skipTrivia(source, index + 5));
      let cursor = name ? skipTrivia(source, name.end) : index + 5;
      if (name && source[cursor] === '=') {
        cursor = skipTrivia(source, cursor + 1);
        const quote = source[cursor];
        const parsed =
          quote === "'" || quote === '"'
            ? readStaticTerminalQuotedValue(source, cursor, quote)
            : quote === '`'
              ? readStaticTemplateValue(source, cursor, values)
              : readStaticEnvironmentFallback(source, cursor);
        if (parsed) {
          if (values.has(name.value) && values.get(name.value) !== parsed.value) {
            ambiguous.add(name.value);
            values.delete(name.value);
          } else if (!ambiguous.has(name.value)) {
            values.set(name.value, parsed.value);
          }
          index = parsed.end;
          continue;
        }
      }
    }
    index += 1;
  }
  for (const name of ambiguous) values.delete(name);
  return values;
}

function readStaticTerminalQuotedValue(source, start, quote) {
  const value = readStaticQuotedValue(source, start, quote);
  return value && source[skipTrivia(source, value.end)] === ';' ? value : null;
}

function readStaticEnvironmentFallback(source, start) {
  const prefix = 'process.env.';
  if (!source.startsWith(prefix, start)) return null;
  const environmentName = readIdentifier(source, start + prefix.length);
  if (!environmentName || !/^[A-Z][A-Z0-9_]*$/.test(environmentName.value)) return null;
  let cursor = skipTrivia(source, environmentName.end);
  const operator = source.slice(cursor, cursor + 2);
  if (operator !== '??' && operator !== '||') return null;
  cursor = skipTrivia(source, cursor + 2);
  const quote = source[cursor];
  if (quote !== "'" && quote !== '"') return null;
  const fallback = readStaticQuotedValue(source, cursor, quote);
  if (!fallback || fallback.value.length === 0 || fallback.value.length > 100) return null;
  if (source[skipTrivia(source, fallback.end)] !== ';') return null;
  return fallback;
}

function readStaticTemplateValue(source, start, constants) {
  let value = '';
  let interpolationCount = 0;
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === '\\' || character === '\n' || character === '\r') return null;
    if (character === '`') {
      if (interpolationCount !== 1 || source[skipTrivia(source, index + 1)] !== ';') return null;
      return { value, end: index + 1 };
    }
    if (character === '$' && source[index + 1] === '{') {
      const identifier = readIdentifier(source, skipTrivia(source, index + 2));
      if (!identifier || source[skipTrivia(source, identifier.end)] !== '}') return null;
      const resolved = constants.get(identifier.value);
      if (!validStaticPort(resolved)) return null;
      interpolationCount += 1;
      if (interpolationCount > 1) return null;
      value += resolved;
      index = skipTrivia(source, identifier.end);
      continue;
    }
    value += character;
  }
  return null;
}

function validStaticPort(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,4}$/.test(value)) return false;
  const port = Number(value);
  return port >= 1 && port <= 65_535;
}

function readIdentifier(source, start) {
  if (!/[A-Za-z_$]/.test(source[start] ?? '')) return null;
  let end = start + 1;
  while (isIdentifierCharacter(source[end])) end += 1;
  return { value: source.slice(start, end), end };
}

function skipTrivia(source, start) {
  let index = start;
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index += 1;
      continue;
    }
    if (source[index] === '/' && source[index + 1] === '/') {
      index = skipLineComment(source, index + 2);
      continue;
    }
    if (source[index] === '/' && source[index + 1] === '*') {
      index = skipBlockComment(source, index + 2);
      continue;
    }
    break;
  }
  return index;
}

function readStaticQuotedValue(source, start, quote) {
  let value = '';
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === '\\' || character === '\n' || character === '\r') return null;
    if (character === quote) return { value, end: index + 1 };
    value += character;
  }
  return null;
}

function skipQuotedSource(source, start, quote) {
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === '\\') {
      index += 1;
      continue;
    }
    if (source[index] === quote) return index + 1;
  }
  return source.length;
}

function skipLineComment(source, start) {
  const end = source.indexOf('\n', start);
  return end === -1 ? source.length : end + 1;
}

function skipBlockComment(source, start) {
  const end = source.indexOf('*/', start);
  return end === -1 ? source.length : end + 2;
}

function isIdentifierCharacter(value) {
  return typeof value === 'string' && /[A-Za-z0-9_$]/.test(value);
}

function nearestStaticBrowserOrigin(target, origins) {
  return (
    origins.find(
      (origin) =>
        (origin.scope === '.' ||
          target === origin.scope ||
          target.startsWith(`${origin.scope}/`)) &&
        !origin.excluded_target_patterns.some((pattern) => pattern.test(target))
    ) ?? null
  );
}

function normalizeLoopbackBaseUrl(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'http:' ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.port && (Number(url.port) < 1 || Number(url.port) > 65_535))
    ) {
      return null;
    }
    return url.href.replace(/\/$/, '');
  } catch {
    return null;
  }
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

export function selectBoundedFlows(candidates, limit = QUALIFICATION_LIMITS.flows) {
  const ranked = rankCandidates(candidates);
  const selected = new Set();
  const preferredByAdapter = new Map();
  for (const adapter of FLOW_ADAPTER_ORDER) {
    const adapterCandidates = ranked.filter((entry) => entry.adapter === adapter);
    const preferred =
      adapter === 'playwright'
        ? diversifyPlaywrightProjects([
            ...adapterCandidates.filter(playwrightHasDeclaredRuntime),
            ...adapterCandidates.filter((candidate) => !playwrightHasDeclaredRuntime(candidate)),
          ])
        : adapterCandidates;
    const floor =
      adapter === 'playwright' ? PLAYWRIGHT_FLOW_ADAPTER_FLOOR : DEFAULT_FLOW_ADAPTER_FLOOR;
    preferredByAdapter.set(adapter, preferred.slice(0, floor));
  }
  for (let index = 0; selected.size < limit; index += 1) {
    let added = false;
    for (const adapter of FLOW_ADAPTER_ORDER) {
      const candidate = preferredByAdapter.get(adapter)?.[index];
      if (!candidate) continue;
      selected.add(candidate.id);
      added = true;
      if (selected.size >= limit) break;
    }
    if (!added) break;
  }
  for (const candidate of ranked) {
    if (selected.size >= limit) break;
    selected.add(candidate.id);
  }
  return ranked.filter((candidate) => selected.has(candidate.id)).slice(0, limit);
}

function diversifyPlaywrightProjects(candidates) {
  const groups = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.target}\0${candidate.name ?? ''}`;
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }
  const diverse = [];
  for (let projectIndex = 0; ; projectIndex += 1) {
    let added = false;
    for (const group of groups.values()) {
      if (!group[projectIndex]) continue;
      diverse.push(group[projectIndex]);
      added = true;
    }
    if (!added) return diverse;
  }
}

function playwrightHasDeclaredRuntime(candidate) {
  const signals = candidate.signals ?? [];
  return (
    signals.some((entry) => entry.kind === 'loopback_browser_base_url') &&
    signals.some((entry) => entry.kind === 'declared_browser_server_family')
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

function hasExecutableTimingSource(source) {
  return EXECUTABLE_TIMING_SOURCE_PATTERN.test(maskJavaScriptNonCode(source));
}

function maskJavaScriptNonCode(source) {
  let masked = '';
  let state = 'code';
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (state === 'code') {
      if (char === '/' && next === '/') {
        masked += '  ';
        index += 1;
        state = 'line-comment';
      } else if (char === '/' && next === '*') {
        masked += '  ';
        index += 1;
        state = 'block-comment';
      } else if (char === "'") {
        masked += ' ';
        state = 'single-quote';
      } else if (char === '"') {
        masked += ' ';
        state = 'double-quote';
      } else if (char === '`') {
        masked += ' ';
        state = 'template';
      } else {
        masked += char;
      }
      continue;
    }
    if (char === '\n' && state === 'line-comment') {
      masked += '\n';
      state = 'code';
      continue;
    }
    if (char === '*' && next === '/' && state === 'block-comment') {
      masked += '  ';
      index += 1;
      state = 'code';
      continue;
    }
    if (
      char === '\\' &&
      (state === 'single-quote' || state === 'double-quote' || state === 'template')
    ) {
      masked += next === '\n' ? ' \n' : '  ';
      index += 1;
      continue;
    }
    if (
      (state === 'single-quote' && char === "'") ||
      (state === 'double-quote' && char === '"') ||
      (state === 'template' && char === '`')
    ) {
      masked += ' ';
      state = 'code';
      continue;
    }
    masked += char === '\n' ? '\n' : ' ';
  }
  return masked;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
