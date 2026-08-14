import { createHash } from 'node:crypto';
import { lstat, mkdtemp, open, readFile, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { inspectGitDiff } from './git-diff.mjs';
import { minimalEnvironment, runOwnedProcess } from './runner.mjs';

export const STATIC_REDUNDANCY_SCHEMA_VERSION = 'codevetter-static-redundancy/v2';
export const STATIC_REDUNDANCY_LIMITS = Object.freeze({
  analyzerCandidates: 128,
  candidates: 256,
  reportBytes: 4 * 1024 * 1024,
  sourceBytes: 2 * 1024 * 1024,
  timeoutMs: 60_000,
});

const KNIP_ISSUE_TYPES = Object.freeze([
  'files',
  'dependencies',
  'devDependencies',
  'optionalPeerDependencies',
  'exports',
  'nsExports',
  'types',
  'nsTypes',
  'enumMembers',
  'namespaceMembers',
  'duplicates',
]);

const KNIP_ARGUMENTS = Object.freeze([
  '--reporter',
  'json',
  '--no-exit-code',
  '--no-progress',
  '--no-config-hints',
  '--no-tag-hints',
  '--include',
  KNIP_ISSUE_TYPES.join(','),
]);

const JSCPD_ARGUMENTS = Object.freeze([
  '.',
  '--format',
  'javascript,jsx,typescript,tsx',
  '--min-lines',
  '8',
  '--min-tokens',
  '60',
  '--mode',
  'strict',
  '--ignore',
  '**/*.test.*,**/*.spec.*,**/node_modules/**,**/coverage/**,**/dist/**,**/build/**,**/.next/**,**/.codevetter/**',
  '--reporters',
  'json',
  '--silent',
  '--no-tips',
  '--workers',
  '1',
]);

export async function inspectStaticRedundancy(repositoryRoot, options = {}) {
  const root = await realpath(resolve(repositoryRoot));
  let before;
  try {
    before = await inspectGitDiff(root);
  } catch (error) {
    if (error?.code !== 'SOURCE_SNAPSHOT_CHANGED_FILE_INVENTORY_EXCEEDED') throw error;
    return snapshotInventoryFailureReport(error, {
      knip: notRunAnalyzer('knip', KNIP_ARGUMENTS),
      jscpd: notRunAnalyzer('jscpd', JSCPD_ARGUMENTS),
    });
  }
  const timeoutMs = boundedTimeout(options.timeoutMs);
  const knip = await runKnipAnalysis(root, timeoutMs);
  const jscpd = await runJscpdAnalysis(root, timeoutMs);
  let after;
  try {
    after = await inspectGitDiff(root);
  } catch (error) {
    if (error?.code !== 'SOURCE_SNAPSHOT_CHANGED_FILE_INVENTORY_EXCEEDED') throw error;
    return snapshotInventoryFailureReport(error, {
      knip: { ...knip.analyzer, status: 'no_confidence' },
      jscpd: { ...jscpd.analysis.analyzer, status: 'no_confidence' },
    });
  }
  if (!sameSnapshot(before, after)) {
    return report({
      subject: after,
      analyzer: { ...knip.analyzer, status: 'no_confidence' },
      cloneAnalysis: {
        ...jscpd.analysis,
        analyzer: { ...jscpd.analysis.analyzer, status: 'no_confidence' },
      },
      candidates: [],
      status: 'no_confidence',
      reason: 'repository_changed_during_analysis',
      limitations: ['The repository snapshot changed while static analyzers were running.'],
    });
  }
  const failed = [knip, jscpd].find((result) => result.reason && result.status === 'no_confidence');
  if (failed) {
    return report({
      subject: after,
      analyzer: knip.analyzer,
      cloneAnalysis: jscpd.analysis,
      candidates: [],
      status: 'no_confidence',
      reason: failed.reason,
      limitations: [...knip.limitations, ...jscpd.limitations],
    });
  }
  const screened = await screenPackageScriptDependencies(root, knip.candidates);
  const candidates = rankCandidatesForDiff([...screened.candidates, ...jscpd.candidates], after);
  const screenedOut = [...screened.screenedOut, ...jscpd.screenedOut];
  if (candidates.length > STATIC_REDUNDANCY_LIMITS.candidates) {
    return report({
      subject: after,
      analyzer: knip.analyzer,
      cloneAnalysis: jscpd.analysis,
      candidates: [],
      status: 'no_confidence',
      reason: 'candidate_inventory_exceeded_bound',
      limitations: [
        `Static analyzers returned more than ${STATIC_REDUNDANCY_LIMITS.candidates} candidates; CodeVetter did not truncate them into a misleading partial report.`,
      ],
    });
  }
  const bothUnavailable = knip.status === 'unavailable' && jscpd.status === 'unavailable';
  return report({
    subject: after,
    analyzer: knip.analyzer,
    cloneAnalysis: jscpd.analysis,
    candidates,
    screenedOut,
    status: bothUnavailable
      ? 'unavailable'
      : candidates.length > 0
        ? 'candidates'
        : 'no_candidates',
    reason: bothUnavailable
      ? 'project_owned_static_analyzers_unavailable'
      : candidates.length > 0
        ? 'static_candidates_observed'
        : 'no_static_candidates_observed',
    limitations: [...knip.limitations, ...jscpd.limitations],
  });
}

async function runKnipAnalysis(root, timeoutMs) {
  const authority = await resolvePackageAuthority(root, 'knip');
  if (authority.state !== 'ready') {
    return {
      analyzer: unavailableAnalyzer('knip', KNIP_ARGUMENTS, authority),
      candidates: [],
      status: 'unavailable',
      reason: null,
      limitations: [unavailableAnalyzerLimitation('Knip', authority)],
    };
  }
  const execution = await runOwnedProcess({
    program: process.execPath,
    args: [authority.entry, ...KNIP_ARGUMENTS],
    cwd: root,
    environment: minimalEnvironment(),
    timeoutMs,
  });
  const analyzer = {
    kind: 'knip',
    status: 'ran',
    version: authority.version,
    executable: authority.executable,
    availability: analyzerAvailability(authority),
    configuration: await discoverKnipConfiguration(root, authority.rootPackageJson),
    invocation: {
      shell: false,
      read_only: true,
      arguments: [...KNIP_ARGUMENTS],
    },
    elapsed_ms: execution.durationMs,
  };

  if (execution.status === 'timeout') {
    return {
      analyzer: { ...analyzer, status: 'no_confidence' },
      candidates: [],
      status: 'no_confidence',
      reason: 'analyzer_timeout',
      limitations: [`Knip exceeded the ${timeoutMs} ms local execution budget.`],
    };
  }
  if (
    execution.status !== 'exited' ||
    execution.exitCode !== 0 ||
    execution.truncated ||
    execution.stdoutBytes === 0
  ) {
    return {
      analyzer: { ...analyzer, status: 'no_confidence' },
      candidates: [],
      status: 'no_confidence',
      reason: execution.truncated ? 'analyzer_output_exceeded_bound' : 'analyzer_execution_failed',
      limitations: ['Knip did not return one complete bounded JSON report.'],
    };
  }

  let candidates;
  try {
    candidates = normalizeKnipReport(JSON.parse(execution.stdout));
  } catch {
    return {
      analyzer: { ...analyzer, status: 'no_confidence' },
      candidates: [],
      status: 'no_confidence',
      reason: 'analyzer_output_invalid',
      limitations: ['Knip output did not match the bounded static-redundancy contract.'],
    };
  }
  if (candidates.length > STATIC_REDUNDANCY_LIMITS.analyzerCandidates) {
    return {
      analyzer: { ...analyzer, status: 'no_confidence' },
      candidates: [],
      status: 'no_confidence',
      reason: 'candidate_inventory_exceeded_bound',
      limitations: [
        `Knip returned more than ${STATIC_REDUNDANCY_LIMITS.analyzerCandidates} candidates; CodeVetter did not truncate them into a misleading partial report.`,
      ],
    };
  }
  return {
    analyzer,
    candidates,
    status: 'ran',
    reason: null,
    limitations: [
      'Static reachability does not prove semantic equivalence, runtime cost, or safe deletion.',
      'Knip duplicate groups describe duplicate export paths, not duplicate implementation bodies.',
      'Candidates ignored by the repository Knip configuration are outside this report.',
    ],
  };
}

async function runJscpdAnalysis(root, timeoutMs) {
  const authority = await resolvePackageAuthority(root, 'jscpd');
  if (authority.state !== 'ready') {
    return {
      analysis: {
        analyzer: unavailableAnalyzer('jscpd', JSCPD_ARGUMENTS, authority),
        coverage: null,
      },
      candidates: [],
      screenedOut: [],
      status: 'unavailable',
      reason: null,
      limitations: [unavailableAnalyzerLimitation('jscpd', authority)],
    };
  }
  const outputDirectory = await mkdtemp(join(tmpdir(), 'codevetter-jscpd-'));
  const generatedWranglerRoot = await isGeneratedWranglerDeclaration(
    root,
    'worker-configuration.d.ts'
  );
  const analyzerArguments = generatedWranglerRoot
    ? addJscpdIgnore(JSCPD_ARGUMENTS, 'worker-configuration.d.ts')
    : [...JSCPD_ARGUMENTS];
  const argumentsWithOutput = [...analyzerArguments, '--output', outputDirectory];
  let execution;
  let normalized;
  let failure = null;
  try {
    execution = await runOwnedProcess({
      program: process.execPath,
      args: [authority.entry, ...argumentsWithOutput],
      cwd: root,
      environment: minimalEnvironment(),
      timeoutMs,
    });
    if (execution.status === 'timeout') {
      failure = {
        reason: 'clone_analyzer_timeout',
        limitation: `jscpd exceeded the ${timeoutMs} ms local execution budget.`,
      };
    } else if (execution.status !== 'exited' || execution.exitCode !== 0 || execution.truncated) {
      failure = {
        reason: execution.truncated
          ? 'clone_analyzer_output_exceeded_bound'
          : 'clone_analyzer_execution_failed',
        limitation: 'jscpd did not produce one complete bounded JSON report.',
      };
    } else {
      const reportPath = join(outputDirectory, 'jscpd-report.json');
      const reportStat = await stat(reportPath);
      if (!reportStat.isFile() || reportStat.size > STATIC_REDUNDANCY_LIMITS.reportBytes) {
        failure = {
          reason: 'clone_analyzer_output_exceeded_bound',
          limitation: 'The jscpd JSON report exceeded the bounded report contract.',
        };
      } else {
        normalized = normalizeJscpdReport(JSON.parse(await readFile(reportPath, 'utf8')));
      }
    }
  } catch {
    failure = {
      reason: 'clone_analyzer_output_invalid',
      limitation: 'jscpd output did not match the bounded duplicate-implementation contract.',
    };
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
  const analyzer = {
    kind: 'jscpd',
    status: failure ? 'no_confidence' : 'ran',
    version: authority.version,
    executable: authority.executable,
    availability: analyzerAvailability(authority),
    configuration: { kind: 'codevetter_fixed_policy', path: null, sha256: null },
    invocation: {
      shell: false,
      read_only: true,
      arguments: [...analyzerArguments, '--output', '<owned-temporary-directory>'],
    },
    elapsed_ms: execution?.durationMs ?? 0,
  };
  if (failure) {
    return {
      analysis: { analyzer, coverage: null },
      candidates: [],
      screenedOut: [],
      status: 'no_confidence',
      reason: failure.reason,
      limitations: [failure.limitation],
    };
  }
  const screened = await screenNonActionableCloneCandidates(root, normalized.candidates);
  if (screened.candidates.length > STATIC_REDUNDANCY_LIMITS.analyzerCandidates) {
    return {
      analysis: { analyzer: { ...analyzer, status: 'no_confidence' }, coverage: null },
      candidates: [],
      screenedOut: [],
      status: 'no_confidence',
      reason: 'candidate_inventory_exceeded_bound',
      limitations: [
        `jscpd returned more than ${STATIC_REDUNDANCY_LIMITS.analyzerCandidates} clone groups; CodeVetter did not truncate them into a misleading partial report.`,
      ],
    };
  }
  return {
    analysis: { analyzer, coverage: normalized.coverage },
    candidates: screened.candidates,
    screenedOut: screened.screenedOut,
    status: 'ran',
    reason: null,
    limitations: [
      'Token-clone similarity does not prove semantic equivalence, runtime cost, or a safe consolidation.',
      'jscpd source fragments are deliberately not retained in CodeVetter evidence.',
      'Duplication percentage describes analyzed source, not application performance.',
      ...(screened.screenedOut.length > 0
        ? [
            'Generated Wrangler declarations and import-preamble-only clones were screened out before candidate ranking.',
          ]
        : []),
    ],
  };
}

function addJscpdIgnore(arguments_, pattern) {
  const result = [...arguments_];
  const index = result.indexOf('--ignore');
  if (index === -1 || typeof result[index + 1] !== 'string') {
    throw new Error('jscpd ignore policy is invalid');
  }
  result[index + 1] = `${result[index + 1]},${pattern}`;
  return result;
}

async function screenNonActionableCloneCandidates(root, candidates) {
  const files = [
    ...new Set(
      candidates.flatMap((candidate) => candidate.duplicate_locations.map((entry) => entry.file))
    ),
  ].sort();
  const generated = new Set();
  for (const file of files) {
    if (await isGeneratedWranglerDeclaration(root, file)) generated.add(file);
  }
  const kept = [];
  const screenedOut = [];
  for (const candidate of candidates) {
    const generatedLocations = candidate.duplicate_locations
      .map((entry) => entry.file)
      .filter((file) => generated.has(file));
    if (generatedLocations.length === 0) {
      if (await isImportPreambleClone(root, candidate)) {
        screenedOut.push({
          ...candidate,
          claim: 'screened_out',
          screening: {
            reason: 'import_preamble_clone',
            references: candidate.duplicate_locations.map(
              (entry) => `${entry.file}:${entry.start_line}-${entry.end_line}`
            ),
          },
        });
      } else {
        kept.push(candidate);
      }
      continue;
    }
    screenedOut.push({
      ...candidate,
      claim: 'screened_out',
      screening: {
        reason: 'generated_wrangler_declaration',
        references: [...new Set(generatedLocations)].sort(),
      },
    });
  }
  return { candidates: kept, screenedOut };
}

async function isImportPreambleClone(root, candidate) {
  for (const location of candidate.duplicate_locations) {
    const lines = await readBoundedSourceLines(root, location.file);
    if (!lines) return false;
    const preambleEnd = importPreambleEnd(lines);
    if (
      preambleEnd === 0 ||
      location.start_line > preambleEnd ||
      location.end_line > preambleEnd + 1
    ) {
      return false;
    }
  }
  return true;
}

function importPreambleEnd(lines) {
  let end = 0;
  let insideImport = false;
  let sawImport = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (insideImport) {
      end = index + 1;
      if (line.includes(';')) insideImport = false;
      continue;
    }
    if (line === '' || line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) {
      if (sawImport) end = index + 1;
      continue;
    }
    if (!/^import(?:\s|\{)/.test(line)) break;
    sawImport = true;
    end = index + 1;
    insideImport = !line.includes(';');
  }
  return end;
}

async function readBoundedSourceLines(root, file) {
  const lexical = resolve(root, file);
  if (repositoryPath(root, lexical) === null) return null;
  let path;
  try {
    const metadata = await lstat(lexical);
    if (!metadata.isFile() && !metadata.isSymbolicLink()) return null;
    path = await realpath(lexical);
    const resolved = await stat(path);
    if (
      repositoryPath(root, path) === null ||
      !resolved.isFile() ||
      resolved.size > STATIC_REDUNDANCY_LIMITS.sourceBytes
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return (await readFile(path, 'utf8')).split(/\r?\n/);
}

async function isGeneratedWranglerDeclaration(root, file) {
  const lexical = resolve(root, file);
  if (repositoryPath(root, lexical) === null) return false;
  let path;
  try {
    const metadata = await lstat(lexical);
    if (!metadata.isFile() && !metadata.isSymbolicLink()) return false;
    path = await realpath(lexical);
    if (repositoryPath(root, path) === null || !(await stat(path)).isFile()) return false;
  } catch {
    return false;
  }
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(1_024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const header = buffer.subarray(0, bytesRead).toString('utf8');
    return /Generated by Wrangler by running `wrangler types`/.test(header);
  } finally {
    await handle.close();
  }
}

export function normalizeJscpdReport(value) {
  if (!plain(value) || !Array.isArray(value.duplicates) || !plain(value.statistics?.total)) {
    throw new Error('jscpd report is invalid');
  }
  if (value.duplicates.length > 512) throw new Error('jscpd clone inventory is invalid');
  const total = value.statistics.total;
  const coverage = {
    sources: boundedCount(total.sources),
    lines: boundedCount(total.lines),
    tokens: boundedCount(total.tokens),
    clone_groups: boundedCount(total.clones),
    duplicated_lines: boundedCount(total.duplicatedLines),
    duplicated_tokens: boundedCount(total.duplicatedTokens),
    duplication_percentage: boundedPercentage(total.percentage),
  };
  if (coverage.clone_groups !== value.duplicates.length) {
    throw new Error('jscpd clone count is inconsistent');
  }
  const candidates = value.duplicates.map((duplicate) => cloneCandidate(duplicate));
  const unique = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  return { coverage, candidates: [...unique.values()].sort(compareCandidates) };
}

export function normalizeKnipReport(value) {
  if (!plain(value) || !Array.isArray(value.issues) || value.issues.length > 512) {
    throw new Error('Knip report is invalid');
  }
  const candidates = [];
  for (const issue of value.issues) {
    if (!plain(issue)) throw new Error('Knip issue is invalid');
    const issueFile = safePath(issue.file);
    for (const type of KNIP_ISSUE_TYPES) {
      const items = issue[type];
      if (items === undefined) continue;
      if (!Array.isArray(items) || items.length > 512)
        throw new Error('Knip issue list is invalid');
      if (type === 'duplicates') {
        for (const group of items) candidates.push(duplicateCandidate(issueFile, group));
        continue;
      }
      for (const item of items) candidates.push(itemCandidate(type, issueFile, item));
    }
  }
  const unique = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  return [...unique.values()].sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.kind.localeCompare(right.kind) ||
      (left.line ?? 0) - (right.line ?? 0) ||
      String(left.symbol).localeCompare(String(right.symbol))
  );
}

function cloneCandidate(value) {
  if (
    !plain(value) ||
    typeof value.format !== 'string' ||
    value.format.length === 0 ||
    value.format.length > 100
  ) {
    throw new Error('jscpd clone is invalid');
  }
  const locations = [cloneLocation(value.firstFile), cloneLocation(value.secondFile)].sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.start_line - right.start_line ||
      left.end_line - right.end_line
  );
  const payload = {
    kind: 'duplicate_implementation_fragment',
    file: locations[0].file,
    symbol: null,
    line: locations[0].start_line,
    duplicate_locations: locations,
    observed: {
      format: value.format,
      lines: boundedPositiveCount(value.lines),
      tokens: boundedPositiveCount(value.tokens),
    },
    authority: 'jscpd_token_clone',
    claim: 'static_candidate',
    verification: verificationFor('duplicate_implementation_fragment'),
  };
  return { id: candidateId(payload), ...payload };
}

function cloneLocation(value) {
  if (!plain(value)) throw new Error('jscpd clone location is invalid');
  const startLine = boundedLine(value.start);
  const endLine = boundedLine(value.end);
  if (startLine === null || endLine === null || endLine < startLine) {
    throw new Error('jscpd clone line range is invalid');
  }
  return { file: safePath(value.name), start_line: startLine, end_line: endLine };
}

function itemCandidate(type, issueFile, item) {
  if (
    !plain(item) ||
    typeof item.name !== 'string' ||
    item.name.length === 0 ||
    item.name.length > 500
  ) {
    throw new Error('Knip item is invalid');
  }
  const kind =
    type === 'files'
      ? 'unused_file'
      : ['dependencies', 'devDependencies', 'optionalPeerDependencies'].includes(type)
        ? 'unused_dependency'
        : ['types', 'nsTypes'].includes(type)
          ? 'unused_type_export'
          : type === 'enumMembers'
            ? 'unused_enum_member'
            : type === 'namespaceMembers'
              ? 'unused_namespace_member'
              : 'unused_export_surface';
  const file = kind === 'unused_file' ? safePath(item.name) : issueFile;
  const payload = {
    kind,
    file,
    symbol: kind === 'unused_file' ? null : item.name,
    line: boundedLine(item.line),
    authority: 'knip_static_reachability',
    claim: 'static_candidate',
    verification: verificationFor(kind),
  };
  return { id: candidateId(payload), ...payload };
}

function duplicateCandidate(file, group) {
  if (!Array.isArray(group) || group.length < 2 || group.length > 64) {
    throw new Error('Knip duplicate group is invalid');
  }
  const symbols = group.map((item) => {
    if (
      !plain(item) ||
      typeof item.name !== 'string' ||
      item.name.length === 0 ||
      item.name.length > 500
    ) {
      throw new Error('Knip duplicate item is invalid');
    }
    return { name: item.name, line: boundedLine(item.line) };
  });
  const payload = {
    kind: 'duplicate_export_group',
    file,
    symbol: symbols.map((item) => item.name).join(', '),
    line: symbols.find((item) => item.line !== null)?.line ?? null,
    duplicate_symbols: symbols,
    authority: 'knip_static_reachability',
    claim: 'static_candidate',
    verification: verificationFor('duplicate_export_group'),
  };
  return { id: candidateId(payload), ...payload };
}

function verificationFor(kind) {
  return {
    required_observation:
      kind === 'unused_dependency'
        ? 'Remove only the candidate dependency, then pass the repository install/lockfile check, build, and exact affected flows.'
        : kind === 'duplicate_implementation_fragment'
          ? 'Compare the two implementations for semantic and lifecycle differences, consolidate only the proven common behavior, then pass the repository build, exact correctness tests, affected application flows, and paired performance verification.'
          : ['unused_export_surface', 'unused_type_export', 'duplicate_export_group'].includes(kind)
            ? 'Narrow only the candidate public export surface, then pass the repository build, exact correctness tests, and affected application flows; do not delete the implementation without separate evidence.'
            : 'Remove only the candidate code, then pass the repository build, exact correctness tests, and affected application flows.',
    rejection_condition:
      'Reject the removal if build, types, tests, flow behavior, or paired performance evidence regresses.',
  };
}

async function resolvePackageAuthority(root, packageName) {
  const rootPackageJson = join(root, 'package.json');
  let manifest;
  try {
    manifest = JSON.parse(await readFile(rootPackageJson, 'utf8'));
  } catch {
    return { state: 'root_manifest_unavailable', declaration: null };
  }
  const declarationField = ['dependencies', 'devDependencies', 'optionalDependencies'].find(
    (field) => plain(manifest[field]) && typeof manifest[field][packageName] === 'string'
  );
  if (!declarationField) return { state: 'not_declared', declaration: null };
  const declaration = `package.json#${declarationField}.${packageName}`;
  const installedPackageJson = join(root, 'node_modules', packageName, 'package.json');
  let installed;
  let installedPackageReal;
  try {
    installedPackageReal = await realpath(installedPackageJson);
    installed = JSON.parse(await readFile(installedPackageReal, 'utf8'));
  } catch {
    return { state: 'declared_not_installed', declaration };
  }
  const bin = typeof installed.bin === 'string' ? installed.bin : installed.bin?.[packageName];
  if (
    typeof installed.version !== 'string' ||
    !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(installed.version)
  ) {
    return { state: 'installed_package_invalid', declaration };
  }
  if (
    typeof bin !== 'string' ||
    bin.length === 0 ||
    isAbsolute(bin) ||
    bin.split(/[\\/]/).includes('..')
  ) {
    return { state: 'installed_package_invalid', declaration };
  }
  let entry;
  try {
    entry = await realpath(join(resolve(installedPackageReal, '..'), bin));
    if (repositoryPath(root, entry) === null || !(await lstat(entry)).isFile()) {
      return { state: 'installed_package_invalid', declaration };
    }
  } catch {
    return { state: 'installed_package_invalid', declaration };
  }
  return {
    state: 'ready',
    declaration,
    entry,
    executable: repositoryPath(root, entry),
    version: installed.version,
    rootPackageJson,
  };
}

async function discoverKnipConfiguration(root, packageJson) {
  for (const name of [
    'knip.json',
    '.knip.json',
    'knip.jsonc',
    'knip.js',
    'knip.ts',
    'knip.config.js',
    'knip.config.ts',
  ]) {
    try {
      const content = await readFile(join(root, name));
      return { kind: 'repository_file', path: name, sha256: sha256(content) };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  const content = await readFile(packageJson);
  const manifest = JSON.parse(content.toString('utf8'));
  if (plain(manifest.knip)) {
    return { kind: 'package_json_field', path: 'package.json', sha256: sha256(content) };
  }
  return { kind: 'implicit', path: null, sha256: null };
}

async function screenPackageScriptDependencies(root, candidates) {
  let scripts = {};
  try {
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    if (plain(manifest.scripts)) scripts = manifest.scripts;
  } catch {
    return { candidates, screenedOut: [] };
  }
  const kept = [];
  const screenedOut = [];
  for (const candidate of candidates) {
    if (candidate.kind !== 'unused_dependency') {
      kept.push(candidate);
      continue;
    }
    const references = Object.entries(scripts)
      .filter(
        ([name, command]) => typeof command === 'string' && commandToken(command, candidate.symbol)
      )
      .map(([name]) => `package.json#scripts.${name}`)
      .sort();
    if (references.length === 0) {
      kept.push(candidate);
      continue;
    }
    screenedOut.push({
      ...candidate,
      claim: 'screened_out',
      screening: {
        reason: 'declared_package_script_usage',
        references,
      },
    });
  }
  return { candidates: kept, screenedOut };
}

function commandToken(command, symbol) {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[\\s;&|()])${escaped}(?=$|[\\s;&|()])`, 'u').test(command);
}

function report({
  subject,
  analyzer,
  cloneAnalysis,
  candidates,
  screenedOut = [],
  status,
  reason,
  limitations,
}) {
  const counts = Object.fromEntries(
    [...new Set(candidates.map((candidate) => candidate.kind))]
      .sort()
      .map((kind) => [kind, candidates.filter((candidate) => candidate.kind === kind).length])
  );
  return {
    schema_version: STATIC_REDUNDANCY_SCHEMA_VERSION,
    subject: {
      repository_revision: subject.repository_revision,
      source_snapshot_sha256: subject.source_snapshot_sha256 ?? null,
      dirty: subject.dirty,
      changed_files: subject.changed_files ?? [],
      ...(Number.isInteger(subject.changed_file_count)
        ? {
            changed_file_count: subject.changed_file_count,
            changed_file_limit: subject.changed_file_limit,
            changed_files_truncated: true,
          }
        : {}),
    },
    analyzer,
    clone_analysis: cloneAnalysis,
    candidates,
    screened_out: screenedOut,
    summary: {
      total: candidates.length,
      diff_relevant: candidates.filter((candidate) => candidate.relevance?.status !== 'unchanged')
        .length,
      screened_out: screenedOut.length,
      by_kind: counts,
    },
    limitations,
    verdict: { status, reason, safe_to_remove: false, repository_mutation_performed: false },
  };
}

function snapshotInventoryFailureReport(error, analyzers) {
  const subject = error.snapshot;
  return report({
    subject,
    analyzer: analyzers.knip,
    cloneAnalysis: { analyzer: analyzers.jscpd, coverage: null },
    candidates: [],
    status: 'no_confidence',
    reason: 'source_snapshot_changed_file_inventory_exceeded_bound',
    limitations: [
      `The repository has ${subject.changed_file_count} changed files, above the fixed ${subject.changed_file_limit}-file source-snapshot limit; CodeVetter did not run or retain static analyzer candidates.`,
    ],
  });
}

function notRunAnalyzer(kind, arguments_) {
  return {
    kind,
    status: 'not_run',
    version: null,
    executable: null,
    availability: {
      declared: null,
      installed: null,
      reason: 'source_snapshot_unavailable',
      declaration: null,
    },
    configuration: null,
    invocation: { shell: false, read_only: true, arguments: [...arguments_] },
    elapsed_ms: 0,
  };
}

function unavailableAnalyzer(kind, arguments_, authority) {
  return {
    kind,
    status: 'unavailable',
    version: null,
    executable: null,
    availability: analyzerAvailability(authority),
    configuration: null,
    invocation: { shell: false, read_only: true, arguments: [...arguments_] },
    elapsed_ms: 0,
  };
}

function analyzerAvailability(authority) {
  return {
    declared: authority.declaration !== null,
    installed: authority.state === 'ready',
    reason: authority.state,
    declaration: authority.declaration,
  };
}

function unavailableAnalyzerLimitation(label, authority) {
  if (authority.state === 'declared_not_installed') {
    return `${label} is declared by the repository but its repository-local executable is not installed; CodeVetter did not install or download it.`;
  }
  if (authority.state === 'installed_package_invalid') {
    return `${label} is declared and has a repository-local package, but it does not expose one valid contained executable; CodeVetter did not fall back or download another copy.`;
  }
  if (authority.state === 'root_manifest_unavailable') {
    return `The repository package manifest could not authorize ${label}; CodeVetter did not install, download, or fall back to another copy.`;
  }
  return `No repository-declared ${label} analyzer was found; CodeVetter did not install or download one.`;
}

function compareCandidates(left, right) {
  return (
    left.file.localeCompare(right.file) ||
    left.kind.localeCompare(right.kind) ||
    (left.line ?? 0) - (right.line ?? 0) ||
    String(left.symbol).localeCompare(String(right.symbol))
  );
}

function rankCandidatesForDiff(candidates, subject) {
  const changedFiles = new Set(subject.changed_files);
  return candidates
    .map((candidate) => ({
      ...candidate,
      relevance: candidateRelevance(candidate, changedFiles, subject.changed_lines),
    }))
    .sort(
      (left, right) =>
        relevanceRank(left.relevance.status) - relevanceRank(right.relevance.status) ||
        candidateKindRank(left.kind) - candidateKindRank(right.kind) ||
        (right.observed?.lines ?? 0) - (left.observed?.lines ?? 0) ||
        compareCandidates(left, right)
    );
}

function candidateRelevance(candidate, changedFiles, changedLines) {
  const sourceLocations = Array.isArray(candidate.duplicate_locations)
    ? candidate.duplicate_locations
    : [{ file: candidate.file, start_line: candidate.line, end_line: candidate.line }];
  const locations = [];
  for (const location of sourceLocations) {
    if (!changedFiles.has(location.file)) continue;
    const lines = changedLines.get(location.file);
    const exact =
      lines && Number.isInteger(location.start_line) && Number.isInteger(location.end_line)
        ? [...lines]
            .filter((line) => line >= location.start_line && line <= location.end_line)
            .sort((left, right) => left - right)
        : [];
    locations.push({
      file: location.file,
      match: exact.length > 0 ? 'changed_line_intersection' : 'changed_file',
      changed_lines: exact.slice(0, 32),
      changed_lines_truncated: exact.length > 32,
    });
  }
  return {
    status: locations.some((location) => location.match === 'changed_line_intersection')
      ? 'changed_line_intersection'
      : locations.length > 0
        ? 'changed_file'
        : 'unchanged',
    locations,
    claim: 'snapshot_correlation_only',
  };
}

function relevanceRank(status) {
  return status === 'changed_line_intersection' ? 0 : status === 'changed_file' ? 1 : 2;
}

function candidateKindRank(kind) {
  return kind === 'duplicate_implementation_fragment' ? 0 : 1;
}

function sameSnapshot(left, right) {
  return (
    left.repository_revision === right.repository_revision &&
    left.source_snapshot_sha256 === right.source_snapshot_sha256 &&
    JSON.stringify(left.changed_files) === JSON.stringify(right.changed_files)
  );
}

function boundedTimeout(value) {
  if (value === undefined) return STATIC_REDUNDANCY_LIMITS.timeoutMs;
  if (!Number.isInteger(value) || value < 100 || value > 120_000) {
    throw new Error('static redundancy timeout must be an integer between 100 and 120000');
  }
  return value;
}

function safePath(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 1_000 ||
    isAbsolute(value) ||
    value.includes('\\') ||
    value.split('/').includes('..')
  ) {
    throw new Error('Knip path is invalid');
  }
  return value;
}

function boundedLine(value) {
  if (value === undefined) return null;
  if (!Number.isInteger(value) || value < 1 || value > 10_000_000) {
    throw new Error('Knip line is invalid');
  }
  return value;
}

function boundedCount(value) {
  if (!Number.isInteger(value) || value < 0 || value > 1_000_000_000) {
    throw new Error('static analyzer count is invalid');
  }
  return value;
}

function boundedPositiveCount(value) {
  const count = boundedCount(value);
  if (count === 0) throw new Error('static analyzer positive count is invalid');
  return count;
}

function boundedPercentage(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error('static analyzer percentage is invalid');
  }
  return value;
}

function repositoryPath(root, absolute) {
  const value = relative(root, absolute);
  if (value === '' || value === '..' || value.startsWith(`..${sep}`) || isAbsolute(value))
    return null;
  return value.split(sep).join('/');
}

function candidateId(value) {
  return sha256(JSON.stringify(value)).slice(0, 24);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
