import { spawn } from 'node:child_process';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { LIMITS, boundedTimeout, repositoryRelative } from './contracts.mjs';

const NODE_HEAP_PROFILE_PRELOAD = pathToFileURL(
  fileURLToPath(new URL('./node-heap-profile-preload.mjs', import.meta.url))
).href;

export async function runClosedAdapter({
  repositoryRoot,
  dependencyRepositoryRoot = repositoryRoot,
  adapter,
  target,
  name,
  timeoutMs,
  profileDirectory,
  heapProfileDirectory,
  flowDirectory,
  coverageDirectory,
  benchmarkCount = 1,
  goBenchmarkIterations = null,
  vitestReporter,
  measureMemory = false,
  goBenchmarkBinary = null,
}) {
  const root = await realpath(resolve(repositoryRoot));
  const dependencyRoot = await realpath(resolve(dependencyRepositoryRoot));
  const scope = await resolveTarget(root, target);
  const timeout = boundedTimeout(timeoutMs);
  let command;
  try {
    command = await buildCommand({
      root,
      dependencyRoot,
      adapter,
      scope,
      name,
      profileDirectory,
      heapProfileDirectory,
      coverageDirectory,
      benchmarkCount,
      goBenchmarkIterations,
      vitestReporter,
      goBenchmarkBinary,
    });
  } catch (error) {
    return {
      status: 'operational_failure',
      exitCode: null,
      signal: null,
      durationMs: 0,
      stdout: '',
      stderr: '',
      stdoutBytes: 0,
      stderrBytes: 0,
      truncated: false,
      operationalError: error.message,
      scope: { target: scope.relative, name: name ?? null },
      command: {
        executable_identity: `${adapter}:unavailable`,
        arguments: [],
        working_directory: '.',
      },
      environmentValues: [],
    };
  }
  const environment = minimalEnvironment({
    repositoryRoot: flowDirectory ? root : null,
    profileDirectory:
      profileDirectory && ['node-test', 'node-script'].includes(adapter) ? profileDirectory : null,
    heapProfileDirectory:
      heapProfileDirectory && ['node-test', 'node-script', 'vitest', 'jest'].includes(adapter)
        ? heapProfileDirectory
        : null,
    importHeapProfilePreload:
      Boolean(heapProfileDirectory) && ['node-test', 'node-script'].includes(adapter),
    flowDirectory:
      flowDirectory && ['node-test', 'vitest', 'jest'].includes(adapter) ? flowDirectory : null,
    coverageDirectory:
      coverageDirectory && ['node-test', 'jest'].includes(adapter) ? coverageDirectory : null,
  });
  const execution = await runOwnedProcess({
    program: command.program,
    args: command.args,
    cwd: command.cwd,
    environment,
    timeoutMs: timeout,
    measureMemory,
  });
  return {
    ...execution,
    scope: { target: scope.relative, name: name ?? null },
    command: {
      executable_identity: command.executableIdentity,
      arguments: command.publicArguments,
      working_directory: command.workingDirectory,
    },
    environmentValues: Object.values(environment),
  };
}

const GO_BENCHMARK_BINARY = Symbol('codevetter-go-benchmark-binary');

export async function compileGoBenchmarkBinary({
  repositoryRoot,
  target,
  timeoutMs,
  outputDirectory,
}) {
  const root = await realpath(resolve(repositoryRoot));
  const scope = await resolveTarget(root, target);
  if (!scope.relative.endsWith('_test.go')) {
    throw new Error('go-bench target must end in _test.go');
  }
  const ownedOutputDirectory = await realpath(resolve(outputDirectory));
  const binaryPath = join(ownedOutputDirectory, 'go.test');
  const packageDirectory = dirname(scope.absolute);
  const execution = await runOwnedProcess({
    program: 'go',
    args: ['test', '-c', '-o', binaryPath, '.'],
    cwd: packageDirectory,
    environment: minimalEnvironment(),
    timeoutMs: boundedTimeout(timeoutMs),
  });
  return {
    ...execution,
    prepared_binary:
      execution.status === 'exited' && execution.exitCode === 0
        ? { [GO_BENCHMARK_BINARY]: true, path: binaryPath }
        : null,
  };
}

export async function inspectGoProfile({ profileDirectory, profileName, kind }) {
  if (!['cpu', 'alloc_space', 'alloc_objects'].includes(kind)) {
    throw new Error('unsupported Go profile kind');
  }
  const binary = join(profileDirectory, 'go.test');
  const profile = join(profileDirectory, profileName);
  const args = [
    'tool',
    'pprof',
    '-top',
    '-cum',
    `-nodecount=${LIMITS.hotspots * 8}`,
    '-nodefraction=0',
    '-lines',
    `-unit=${kind === 'cpu' ? 'ms' : kind === 'alloc_objects' ? 'count' : 'bytes'}`,
  ];
  if (kind === 'alloc_space') args.push('-alloc_space');
  if (kind === 'alloc_objects') args.push('-alloc_objects');
  args.push(binary, profile);
  return runOwnedProcess({
    program: 'go',
    args,
    cwd: profileDirectory,
    environment: minimalEnvironment(),
    timeoutMs: 10_000,
  });
}

export async function inspectGoRuntimeVersion(repositoryRoot) {
  const execution = await runOwnedProcess({
    program: 'go',
    args: ['env', 'GOVERSION'],
    cwd: await realpath(resolve(repositoryRoot)),
    environment: minimalEnvironment(),
    timeoutMs: 5_000,
  });
  if (execution.status !== 'exited' || execution.exitCode !== 0) return null;
  const version = execution.stdout.trim();
  return /^go\d+(?:\.\d+){1,2}(?:[a-z0-9.-]+)?$/.test(version) ? version : null;
}

async function resolveTarget(root, target) {
  if (typeof target !== 'string' || target.length === 0 || isAbsolute(target)) {
    throw new Error('target must be a non-empty repository-relative file');
  }
  const lexical = resolve(root, target);
  if (repositoryRelative(root, lexical) === null) throw new Error('target escapes repository');
  let metadata;
  let resolved;
  try {
    metadata = await lstat(lexical);
    resolved = await realpath(lexical);
  } catch {
    throw new Error(`target is not a readable regular file: ${target}`);
  }
  if (!metadata.isFile() && !metadata.isSymbolicLink())
    throw new Error('target is not a regular file');
  const contained = repositoryRelative(root, resolved);
  if (contained === null) throw new Error('target symlink escapes repository');
  const resolvedMetadata = await lstat(resolved);
  if (!resolvedMetadata.isFile()) throw new Error('target does not resolve to a regular file');
  return { absolute: resolved, relative: contained };
}

async function buildCommand({
  root,
  dependencyRoot,
  adapter,
  scope,
  name,
  profileDirectory,
  heapProfileDirectory,
  coverageDirectory,
  benchmarkCount,
  goBenchmarkIterations,
  vitestReporter,
  goBenchmarkBinary,
}) {
  const exactPattern = name ? `^${escapeRegExp(name)}$` : null;
  const exactGoPattern = name
    ? name
        .split('/')
        .map((part) => `^${escapeRegExp(part)}$`)
        .join('/')
    : null;
  if (adapter === 'node-test') {
    const packageDirectory = await nearestNodePackageDirectory(root, dirname(scope.absolute));
    const workingDirectory = relative(root, packageDirectory).split(sep).join('/') || '.';
    const packageTarget = relative(packageDirectory, scope.absolute).split(sep).join('/');
    const args = ['--test', '--test-reporter=tap'];
    const publicArguments = [...args];
    let executableIdentity = `node:${process.version}`;
    if (/\.(?:cts|mts|ts|tsx)$/.test(scope.relative)) {
      const tsxLoader = await localExecutable(
        dependencyRoot,
        dependencyStartDirectory(root, dependencyRoot, dirname(scope.absolute)),
        'node_modules/tsx/dist/loader.mjs'
      );
      args.unshift(`--import=${pathToFileURL(tsxLoader).href}`);
      publicArguments.unshift('--import=<local:tsx>');
      executableIdentity = 'local:node-test+tsx';
    }
    if (exactPattern) args.push(`--test-name-pattern=${exactPattern}`);
    if (exactPattern) publicArguments.push(`--test-name-pattern=${exactPattern}`);
    args.push(packageTarget);
    publicArguments.push(packageTarget);
    return command(
      packageDirectory,
      process.execPath,
      args,
      executableIdentity,
      publicArguments,
      workingDirectory
    );
  }
  if (adapter === 'node-script') {
    if (!/\.(?:cjs|js|mjs)$/.test(scope.relative)) {
      throw new Error('node-script target must be a JavaScript file');
    }
    const args = [scope.relative];
    return command(root, process.execPath, args, `node:${process.version}`, args);
  }
  if (adapter === 'vitest') {
    const executable = await localExecutable(
      dependencyRoot,
      dependencyStartDirectory(root, dependencyRoot, dirname(scope.absolute)),
      'node_modules/vitest/vitest.mjs'
    );
    const reporters = vitestReporter
      ? [vitestReporter]
      : profileDirectory || heapProfileDirectory
        ? ['verbose']
        : ['json', 'verbose'];
    const runnerArguments = [
      'run',
      scope.relative,
      ...reporters.map((reporter) => `--reporter=${reporter}`),
    ];
    if (exactPattern) {
      runnerArguments.push('--testNamePattern', `(?:^| )${escapeRegExp(name)}$`);
    }
    const publicArguments = [...runnerArguments];
    runnerArguments.push('--pool=forks', '--maxWorkers=1', '--no-file-parallelism');
    publicArguments.push('--pool=forks', '--maxWorkers=1', '--no-file-parallelism');
    if (heapProfileDirectory) {
      runnerArguments.push(`--execArgv=--import=${NODE_HEAP_PROFILE_PRELOAD}`);
      publicArguments.push('--execArgv=<codevetter-heap-preload>');
    }
    if (coverageDirectory) {
      runnerArguments.push(
        '--coverage.enabled=true',
        '--coverage.provider=v8',
        '--coverage.reporter=json',
        `--coverage.reportsDirectory=${coverageDirectory}`,
        '--coverage.thresholds.lines=0',
        '--coverage.thresholds.functions=0',
        '--coverage.thresholds.statements=0',
        '--coverage.thresholds.branches=0'
      );
      publicArguments.push(
        '--coverage.enabled=true',
        '--coverage.provider=v8',
        '--coverage.reporter=json',
        '--coverage.reportsDirectory=<owned-temp>',
        '--coverage.thresholds.lines=0',
        '--coverage.thresholds.functions=0',
        '--coverage.thresholds.statements=0',
        '--coverage.thresholds.branches=0'
      );
    }
    const nodeArguments = nodeProfileArguments(profileDirectory, null);
    const args = [...nodeArguments, executable, ...runnerArguments];
    return command(root, process.execPath, args, 'local:vitest', publicArguments);
  }
  if (adapter === 'jest') {
    const executable = await localExecutable(
      dependencyRoot,
      dependencyStartDirectory(root, dependencyRoot, dirname(scope.absolute)),
      'node_modules/jest/bin/jest.js'
    );
    const runnerArguments = ['--runInBand', '--runTestsByPath', scope.relative, '--json'];
    if (exactPattern) {
      runnerArguments.push(`--testNamePattern=(?:^| )${escapeRegExp(name)}$`);
    }
    const nodeArguments = nodeProfileArguments(profileDirectory, heapProfileDirectory);
    return command(
      root,
      process.execPath,
      [...nodeArguments, executable, ...runnerArguments],
      'local:jest',
      runnerArguments
    );
  }
  if (adapter === 'playwright') {
    const executable = await localExecutable(
      dependencyRoot,
      dependencyStartDirectory(root, dependencyRoot, dirname(scope.absolute)),
      'node_modules/@playwright/test/cli.js'
    );
    const runnerArguments = ['test', scope.relative, '--reporter=json'];
    if (exactPattern) runnerArguments.push('--grep', exactPattern);
    const args = [executable, ...runnerArguments];
    return command(root, process.execPath, args, 'local:playwright', runnerArguments);
  }
  if (adapter === 'go-test') {
    if (!scope.relative.endsWith('_test.go'))
      throw new Error('go-test target must end in _test.go');
    const packageDirectory = dirname(scope.absolute);
    const workingDirectory = relative(root, packageDirectory).split(sep).join('/') || '.';
    const args = ['test', '-json'];
    if (exactGoPattern) args.push('-run', exactGoPattern);
    args.push('.');
    return command(packageDirectory, 'go', args, 'path:go', args, workingDirectory);
  }
  if (adapter === 'go-bench') {
    if (!scope.relative.endsWith('_test.go'))
      throw new Error('go-bench target must end in _test.go');
    if (!exactGoPattern) throw new Error('go-bench requires an exact benchmark name');
    const packageDirectory = dirname(scope.absolute);
    const workingDirectory = relative(root, packageDirectory).split(sep).join('/') || '.';
    if (
      goBenchmarkIterations !== null &&
      (!Number.isInteger(goBenchmarkIterations) || goBenchmarkIterations < 1)
    ) {
      throw new Error('Go benchmark profile iterations must be a positive integer');
    }
    const benchtime =
      profileDirectory && goBenchmarkIterations !== null ? `${goBenchmarkIterations}x` : '250ms';
    if (goBenchmarkBinary?.[GO_BENCHMARK_BINARY] === true) {
      const binary = await realpath(goBenchmarkBinary.path);
      const args = [
        '-test.run=^$',
        `-test.bench=${exactGoPattern}`,
        '-test.benchmem=true',
        `-test.benchtime=${benchtime}`,
        `-test.count=${benchmarkCount}`,
      ];
      return command(
        packageDirectory,
        binary,
        args,
        'owned:go-test-binary',
        args,
        workingDirectory
      );
    }
    const args = [
      'test',
      '-run',
      '^$',
      '-bench',
      exactGoPattern,
      '-benchmem',
      `-benchtime=${benchtime}`,
      `-count=${benchmarkCount}`,
    ];
    const publicArguments = [...args];
    if (profileDirectory) {
      args.push(
        `-outputdir=${profileDirectory}`,
        '-cpuprofile=go-cpu.pprof',
        '-memprofile=go-mem.pprof',
        '-memprofilerate=1',
        '-o',
        join(profileDirectory, 'go.test')
      );
      publicArguments.push(
        '-outputdir=<owned-temp>',
        '-cpuprofile=go-cpu.pprof',
        '-memprofile=go-mem.pprof',
        '-memprofilerate=1',
        '-o',
        '<owned-temp>/go.test'
      );
    }
    args.push('.');
    publicArguments.push('.');
    return command(packageDirectory, 'go', args, 'path:go', publicArguments, workingDirectory);
  }
  throw new Error(`unsupported adapter: ${adapter}`);
}

function dependencyStartDirectory(root, dependencyRoot, sourceDirectory) {
  if (resolve(root) === resolve(sourceDirectory)) return dependencyRoot;
  const relativeDirectory = repositoryRelative(root, sourceDirectory);
  if (relativeDirectory === null) {
    throw new Error('dependency lookup source escapes repository');
  }
  return resolve(dependencyRoot, relativeDirectory);
}

function command(cwd, program, args, executableIdentity, publicArguments, workingDirectory = '.') {
  return { program, args, cwd, executableIdentity, publicArguments, workingDirectory };
}

async function localExecutable(root, startDirectory, relativePath) {
  let directory = startDirectory;
  while (true) {
    const candidate = join(directory, relativePath);
    const conventional = await containedRegularFile(root, candidate);
    if (conventional) return conventional;
    const pnpm = await pnpmExecutable(root, directory, relativePath);
    if (pnpm) return pnpm;
    if (directory === root) break;
    const parent = dirname(directory);
    if (parent === directory || (parent !== root && repositoryRelative(root, parent) === null))
      break;
    directory = parent;
  }
  throw new Error(`required local executable is unavailable: ${relativePath}`);
}

async function nearestNodePackageDirectory(root, startDirectory) {
  let directory = startDirectory;
  while (true) {
    if (await containedRegularFile(root, join(directory, 'package.json'))) return directory;
    if (directory === root) return root;
    const parent = dirname(directory);
    if (parent === directory || repositoryRelative(root, parent) === null) return root;
    directory = parent;
  }
}

async function pnpmExecutable(root, directory, relativePath) {
  const descriptor =
    relativePath === 'node_modules/vitest/vitest.mjs'
      ? { prefix: 'vitest@', suffix: 'node_modules/vitest/vitest.mjs' }
      : relativePath === 'node_modules/jest/bin/jest.js'
        ? { prefix: 'jest@', suffix: 'node_modules/jest/bin/jest.js' }
        : relativePath === 'node_modules/@playwright/test/cli.js'
          ? { prefix: '@playwright+test@', suffix: 'node_modules/@playwright/test/cli.js' }
          : relativePath === 'node_modules/vite/dist/node/index.js'
            ? { prefix: 'vite@', suffix: 'node_modules/vite/dist/node/index.js' }
            : relativePath === 'node_modules/next/dist/server/next.js'
              ? { prefix: 'next@', suffix: 'node_modules/next/dist/server/next.js' }
              : null;
  if (!descriptor) return null;
  const store = join(directory, 'node_modules/.pnpm');
  let entries;
  try {
    entries = await readdir(store);
  } catch {
    return null;
  }
  const matches = entries
    .filter((entry) => entry.startsWith(descriptor.prefix))
    .sort()
    .slice(0, 8);
  for (const entry of matches) {
    const resolved = await containedRegularFile(root, join(store, entry, descriptor.suffix));
    if (resolved) return resolved;
  }
  return null;
}

async function containedRegularFile(root, candidate) {
  try {
    const resolved = await realpath(candidate);
    const metadata = await lstat(resolved);
    return metadata.isFile() && repositoryRelative(root, resolved) !== null ? resolved : null;
  } catch {
    return null;
  }
}

export function minimalEnvironment({
  repositoryRoot = null,
  profileDirectory = null,
  heapProfileDirectory = null,
  importHeapProfilePreload = true,
  flowDirectory = null,
  coverageDirectory = null,
} = {}) {
  const allowed = ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'SYSTEMROOT', 'COMSPEC', 'PATHEXT'];
  const environment = { CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' };
  for (const name of allowed) {
    if (typeof process.env[name] === 'string') environment[name] = process.env[name];
  }
  const nodeOptions = [];
  if (profileDirectory) nodeOptions.push('--cpu-prof', `--cpu-prof-dir=${profileDirectory}`);
  if (heapProfileDirectory) {
    if (importHeapProfilePreload) nodeOptions.push(`--import=${NODE_HEAP_PROFILE_PRELOAD}`);
    environment.CODEVETTER_HEAP_PROFILE_DIRECTORY = heapProfileDirectory;
  }
  if (flowDirectory) {
    const preload = fileURLToPath(new URL('./node-flow-preload.mjs', import.meta.url));
    nodeOptions.push(`--import=${pathToFileURL(preload).href}`);
    environment.CODEVETTER_FLOW_DIRECTORY = flowDirectory;
    environment.CODEVETTER_REPOSITORY_ROOT = repositoryRoot;
  }
  if (coverageDirectory) environment.NODE_V8_COVERAGE = coverageDirectory;
  if (nodeOptions.length > 0) environment.NODE_OPTIONS = nodeOptions.join(' ');
  return environment;
}

function nodeProfileArguments(profileDirectory, heapProfileDirectory) {
  if (profileDirectory) return ['--cpu-prof', `--cpu-prof-dir=${profileDirectory}`];
  if (heapProfileDirectory) return [`--import=${NODE_HEAP_PROFILE_PRELOAD}`];
  return [];
}

export function runOwnedProcess({
  program,
  args,
  cwd,
  environment,
  timeoutMs,
  measureMemory = false,
}) {
  return new Promise((resolvePromise) => {
    const startedAt = Date.now();
    let child;
    try {
      child = spawn(program, args, {
        cwd,
        env: environment,
        shell: false,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolvePromise(operationalFailure(error, startedAt));
      return;
    }
    const stdout = createBoundedCollector();
    const stderr = createBoundedCollector();
    let timedOut = false;
    let spawnError = null;
    let memorySampling = false;
    let memorySamples = 0;
    let peakRssBytes = 0;
    child.stdout.on('data', stdout.push);
    child.stderr.on('data', stderr.push);
    child.once('error', (error) => (spawnError = error));
    const sampleMemory = async () => {
      if (!measureMemory || memorySampling || !child.pid) return;
      memorySampling = true;
      try {
        const rss = await processTreeRssBytes(child.pid);
        if (rss !== null) {
          memorySamples += 1;
          peakRssBytes = Math.max(peakRssBytes, rss);
        }
      } finally {
        memorySampling = false;
      }
    };
    void sampleMemory();
    const memoryTimer = measureMemory ? setInterval(sampleMemory, 50) : null;
    memoryTimer?.unref();
    const timer = setTimeout(() => {
      timedOut = true;
      terminate(child, 'SIGTERM');
      setTimeout(() => terminate(child, 'SIGKILL'), 500).unref();
    }, timeoutMs);
    timer.unref();
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (memoryTimer) clearInterval(memoryTimer);
      resolvePromise({
        status: spawnError ? 'operational_failure' : timedOut ? 'timeout' : 'exited',
        exitCode: code,
        signal: signal ?? null,
        durationMs: Date.now() - startedAt,
        stdout: stdout.value(),
        stderr: stderr.value(),
        stdoutBytes: stdout.totalBytes(),
        stderrBytes: stderr.totalBytes(),
        truncated: stdout.truncated() || stderr.truncated(),
        operationalError: spawnError?.message ?? null,
        memory:
          memorySamples > 0
            ? {
                peak_rss_bytes: peakRssBytes,
                samples: memorySamples,
                interval_ms: 50,
                provenance: 'local_process_tree_rss_sampling',
              }
            : null,
      });
    });
  });
}

async function processTreeRssBytes(rootPid) {
  return new Promise((resolvePromise) => {
    let child;
    try {
      child = spawn('ps', ['-axo', 'pid=,ppid=,rss='], {
        shell: false,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      resolvePromise(null);
      return;
    }
    const output = createBoundedCollector();
    child.stdout.on('data', output.push);
    child.once('error', () => resolvePromise(null));
    child.once('close', (code) => {
      if (code !== 0 || output.truncated()) {
        resolvePromise(null);
        return;
      }
      const rows = output
        .value()
        .split(/\r?\n/)
        .map((line) => line.trim().split(/\s+/).map(Number))
        .filter(([pid, parent, rss]) =>
          [pid, parent, rss].every((value) => Number.isInteger(value) && value >= 0)
        );
      const descendants = new Set([rootPid]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const [pid, parent] of rows) {
          if (descendants.has(parent) && !descendants.has(pid)) {
            descendants.add(pid);
            changed = true;
          }
        }
      }
      const rssKiB = rows.reduce(
        (total, [pid, _parent, rss]) => total + (descendants.has(pid) ? rss : 0),
        0
      );
      resolvePromise(rssKiB > 0 ? rssKiB * 1024 : null);
    });
  });
}

export async function resolveLocalPlaywrightCli(repositoryRoot, target) {
  const root = await realpath(resolve(repositoryRoot));
  const scope = await resolveTarget(root, target);
  return localExecutable(root, dirname(scope.absolute), 'node_modules/@playwright/test/cli.js');
}

export async function resolveLocalViteModule(repositoryRoot, target) {
  const root = await realpath(resolve(repositoryRoot));
  const scope = await resolveTarget(root, target);
  return localExecutable(root, dirname(scope.absolute), 'node_modules/vite/dist/node/index.js');
}

export async function resolveLocalNextModule(repositoryRoot, target) {
  const root = await realpath(resolve(repositoryRoot));
  const scope = await resolveTarget(root, target);
  return localExecutable(root, dirname(scope.absolute), 'node_modules/next/dist/server/next.js');
}

function createBoundedCollector() {
  const chunks = [];
  let retained = 0;
  let total = 0;
  let wasTruncated = false;
  return {
    push(chunk) {
      const value = Buffer.from(chunk);
      total += value.length;
      const remaining = LIMITS.outputBytes - retained;
      if (remaining > 0) {
        const kept = value.subarray(0, remaining);
        chunks.push(kept);
        retained += kept.length;
      }
      if (value.length > remaining) wasTruncated = true;
    },
    value: () => Buffer.concat(chunks).toString('utf8'),
    totalBytes: () => total,
    truncated: () => wasTruncated,
  };
}

function terminate(child, signal) {
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    // The process already exited.
  }
}

function operationalFailure(error, startedAt) {
  return {
    status: 'operational_failure',
    exitCode: null,
    signal: null,
    durationMs: Date.now() - startedAt,
    stdout: '',
    stderr: '',
    stdoutBytes: 0,
    stderrBytes: 0,
    truncated: false,
    operationalError: error.message,
    memory: null,
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
