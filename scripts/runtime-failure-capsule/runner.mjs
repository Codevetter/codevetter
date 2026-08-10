import { spawn } from 'node:child_process';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { LIMITS, boundedTimeout, repositoryRelative } from './contracts.mjs';

export async function runClosedAdapter({
  repositoryRoot,
  adapter,
  target,
  name,
  timeoutMs,
  profileDirectory,
  flowDirectory,
  coverageDirectory,
  benchmarkCount = 1,
  vitestReporter,
}) {
  const root = await realpath(resolve(repositoryRoot));
  const scope = await resolveTarget(root, target);
  const timeout = boundedTimeout(timeoutMs);
  let command;
  try {
    command = await buildCommand({
      root,
      adapter,
      scope,
      name,
      profileDirectory,
      coverageDirectory,
      benchmarkCount,
      vitestReporter,
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
    profileDirectory:
      profileDirectory && ['node-test', 'node-script'].includes(adapter) ? profileDirectory : null,
    flowDirectory:
      flowDirectory && ['node-test', 'vitest'].includes(adapter) ? flowDirectory : null,
    coverageDirectory: coverageDirectory && adapter === 'node-test' ? coverageDirectory : null,
  });
  const execution = await runOwnedProcess({
    program: command.program,
    args: command.args,
    cwd: command.cwd,
    environment,
    timeoutMs: timeout,
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

export async function inspectGoProfile({ profileDirectory, profileName, kind }) {
  if (!['cpu', 'alloc_space'].includes(kind)) throw new Error('unsupported Go profile kind');
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
    `-unit=${kind === 'cpu' ? 'ms' : 'bytes'}`,
  ];
  if (kind === 'alloc_space') args.push('-alloc_space');
  args.push(binary, profile);
  return runOwnedProcess({
    program: 'go',
    args,
    cwd: profileDirectory,
    environment: minimalEnvironment(),
    timeoutMs: 10_000,
  });
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
  adapter,
  scope,
  name,
  profileDirectory,
  coverageDirectory,
  benchmarkCount,
  vitestReporter,
}) {
  const exactPattern = name ? `^${escapeRegExp(name)}$` : null;
  const exactGoPattern = name
    ? name
        .split('/')
        .map((part) => `^${escapeRegExp(part)}$`)
        .join('/')
    : null;
  if (adapter === 'node-test') {
    const args = ['--test', '--test-reporter=tap'];
    if (exactPattern) args.push(`--test-name-pattern=${exactPattern}`);
    args.push(scope.relative);
    return command(root, process.execPath, args, `node:${process.version}`, args);
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
      root,
      dirname(scope.absolute),
      'node_modules/vitest/vitest.mjs'
    );
    const runnerArguments = [
      'run',
      scope.relative,
      `--reporter=${vitestReporter ?? (profileDirectory ? 'verbose' : 'json')}`,
    ];
    if (exactPattern) {
      runnerArguments.push('--testNamePattern', `(?:^| )${escapeRegExp(name)}$`);
    }
    const publicArguments = [...runnerArguments];
    if (profileDirectory) {
      runnerArguments.push('--pool=forks', '--maxWorkers=1', '--no-file-parallelism');
      publicArguments.push('--pool=forks', '--maxWorkers=1', '--no-file-parallelism');
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
    const nodeArguments = profileDirectory
      ? ['--cpu-prof', `--cpu-prof-dir=${profileDirectory}`]
      : [];
    const args = [...nodeArguments, executable, ...runnerArguments];
    return command(root, process.execPath, args, 'local:vitest', publicArguments);
  }
  if (adapter === 'playwright') {
    const executable = await localExecutable(
      root,
      dirname(scope.absolute),
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
    const args = [
      'test',
      '-run',
      '^$',
      '-bench',
      exactGoPattern,
      '-benchmem',
      '-benchtime=250ms',
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

async function pnpmExecutable(root, directory, relativePath) {
  const descriptor =
    relativePath === 'node_modules/vitest/vitest.mjs'
      ? { prefix: 'vitest@', suffix: 'node_modules/vitest/vitest.mjs' }
      : relativePath === 'node_modules/@playwright/test/cli.js'
        ? { prefix: '@playwright+test@', suffix: 'node_modules/@playwright/test/cli.js' }
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

function minimalEnvironment({
  profileDirectory = null,
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
  if (flowDirectory) {
    const preload = fileURLToPath(new URL('./node-flow-preload.mjs', import.meta.url));
    nodeOptions.push(`--import=${pathToFileURL(preload).href}`);
    environment.CODEVETTER_FLOW_DIRECTORY = flowDirectory;
  }
  if (coverageDirectory) environment.NODE_V8_COVERAGE = coverageDirectory;
  if (nodeOptions.length > 0) environment.NODE_OPTIONS = nodeOptions.join(' ');
  return environment;
}

function runOwnedProcess({ program, args, cwd, environment, timeoutMs }) {
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
    child.stdout.on('data', stdout.push);
    child.stderr.on('data', stderr.push);
    child.once('error', (error) => (spawnError = error));
    const timer = setTimeout(() => {
      timedOut = true;
      terminate(child, 'SIGTERM');
      setTimeout(() => terminate(child, 'SIGKILL'), 500).unref();
    }, timeoutMs);
    timer.unref();
    child.once('close', (code, signal) => {
      clearTimeout(timer);
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
      });
    });
  });
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
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
