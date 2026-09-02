#!/usr/bin/env node

import { execFile, execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const installedApplication = '/Applications/CodeVetter.app';
const defaultOutputRoot = join(repositoryRoot, 'artifacts/performance');
const numericArgumentKeys = {
  '--runs': 'runs',
  '--settle-ms': 'settleMs',
  '--window-timeout-ms': 'windowTimeoutMs',
};

const expectedApplications = {
  native: {
    bundleIdentifier: 'com.codevetter.desktop.native-preview',
    executable: 'CodeVetterNative',
    performanceMarker: 'Measure what changed.',
    markerStrategy: 'native-tree',
  },
  tauri: {
    bundleIdentifier: 'com.codevetter.desktop',
    executable: 'codevetter-desktop',
    performanceMarker: 'Choose a workload to measure',
    markerStrategy: 'tauri-web-area',
  },
};

export function parseArguments(argv) {
  const options = {
    nativeApp: null,
    tauriApp: null,
    output: null,
    runs: 5,
    settleMs: 5_000,
    windowTimeoutMs: 20_000,
    foregroundApproved: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--native-app') {
      options.nativeApp = resolve(requiredValue(argv, ++index, argument));
    } else if (argument === '--tauri-app') {
      options.tauriApp = resolve(requiredValue(argv, ++index, argument));
    } else if (argument === '--out') {
      options.output = resolve(requiredValue(argv, ++index, argument));
    } else if (numericArgumentKeys[argument]) {
      options[numericArgumentKeys[argument]] = positiveInteger(
        requiredValue(argv, ++index, argument),
        argument
      );
    } else if (argument === '--foreground') {
      options.foregroundApproved = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!options.nativeApp) throw new Error('--native-app is required');
  if (!options.tauriApp) throw new Error('--tauri-app is required');
  if (options.runs < 3) throw new Error('--runs must be at least 3');
  if (!options.foregroundApproved) {
    throw new Error(
      'Matched runtime comparison requires --foreground because it launches and controls visible application windows.'
    );
  }
  return options;
}

export function assertSafeApplicationPath(applicationPath) {
  const resolved = resolve(applicationPath);
  if (resolved === installedApplication || resolved.startsWith('/Applications/')) {
    throw new Error(`Refusing to launch an installed application: ${resolved}`);
  }
  if (!resolved.endsWith('.app')) {
    throw new Error(`Expected a macOS .app bundle: ${resolved}`);
  }
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error(`Application bundle is missing: ${resolved}`);
  }
  const canonical = realpathSync(resolved);
  if (canonical === installedApplication || canonical.startsWith('/Applications/')) {
    throw new Error(`Refusing to follow an application path into /Applications: ${canonical}`);
  }
  return canonical;
}

export function assertBundleInfo(kind, info) {
  const expected = expectedApplications[kind];
  if (!expected) throw new Error(`Unknown application kind: ${kind}`);
  if (info.CFBundleIdentifier !== expected.bundleIdentifier) {
    throw new Error(
      `${kind} bundle identifier must be ${expected.bundleIdentifier}; received ${info.CFBundleIdentifier ?? 'missing'}`
    );
  }
  if (info.CFBundleExecutable !== expected.executable) {
    throw new Error(
      `${kind} executable must be ${expected.executable}; received ${info.CFBundleExecutable ?? 'missing'}`
    );
  }
}

export function parseProcessTable(text) {
  return text
    .split('\n')
    .map((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
      if (!match) return null;
      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        rssKiB: Number(match[3]),
        command: match[4],
      };
    })
    .filter(Boolean);
}

export function processTree(processes, rootPid) {
  const byParent = new Map();
  for (const process of processes) {
    const children = byParent.get(process.ppid) ?? [];
    children.push(process);
    byParent.set(process.ppid, children);
  }

  const root = processes.find((process) => process.pid === rootPid);
  if (!root) return [];
  const result = [];
  const pending = [root];
  const seen = new Set();
  while (pending.length > 0) {
    const process = pending.shift();
    if (seen.has(process.pid)) continue;
    seen.add(process.pid);
    result.push(process);
    pending.push(...(byParent.get(process.pid) ?? []));
  }
  return result;
}

export function summarize(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('Cannot summarize an empty sample set');
  }
  const sorted = [...values].sort((left, right) => left - right);
  const median =
    sorted.length % 2 === 1
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return {
    samples: values,
    minimum: round(sorted[0]),
    median: round(median),
    average: round(values.reduce((sum, value) => sum + value, 0) / values.length),
    p95: round(sorted[p95Index]),
    maximum: round(sorted.at(-1)),
  };
}

export function comparisonOrder(runs) {
  return Array.from({ length: runs }, (_, index) =>
    index % 2 === 0 ? ['native', 'tauri'] : ['tauri', 'native']
  );
}

export async function compareDesktopRuntime(options = parseArguments(process.argv.slice(2))) {
  const applications = {
    native: inspectApplication('native', options.nativeApp),
    tauri: inspectApplication('tauri', options.tauriApp),
  };
  if (applications.native.path === applications.tauri.path) {
    throw new Error('Native and Tauri application paths must be distinct');
  }

  const recordedAt = new Date();
  const runRoot = mkdtempSync(join(ensureDirectory(defaultOutputRoot), 'desktop-runtime-'));
  const samples = { native: [], tauri: [] };
  const order = comparisonOrder(options.runs);

  for (let round = 0; round < order.length; round += 1) {
    for (const kind of order[round]) {
      const stateDirectory = mkdtempSync(join(runRoot, `${round + 1}-${kind}-`));
      process.stderr.write(`Round ${round + 1}/${options.runs}: ${kind}\n`);
      samples[kind].push(
        await measureApplication({
          kind,
          application: applications[kind],
          stateDirectory,
          settleMs: options.settleMs,
          windowTimeoutMs: options.windowTimeoutMs,
          round: round + 1,
        })
      );
    }
  }

  const report = {
    schema_version: 'codevetter.desktop-runtime-comparison/v1',
    recorded_at: recordedAt.toISOString(),
    status: 'measured',
    source: sourceIdentity(),
    machine: machineIdentity(),
    configuration: {
      runs_per_application: options.runs,
      settle_ms: options.settleMs,
      window_timeout_ms: options.windowTimeoutMs,
      foreground_approved: options.foregroundApproved,
      surface: 'Performance',
      order,
      launch: 'exact bundle executable; no LaunchServices open command',
      isolation: 'unique CODEVETTER_APP_DATA_DIR per sample',
    },
    applications,
    samples,
    summary: {
      native: summarizeApplication(samples.native),
      tauri: summarizeApplication(samples.tauri),
    },
    comparison: comparisonSummary(samples),
    claim_boundary:
      'Same-machine Release-bundle comparison of exact-executable launch to first visible window and one settled Performance workspace observation. It is not XCTest first-responsive-frame, scrolling, workload-execution, energy, or long-session evidence.',
    limitations: [
      'The Tauri Performance route is selected through its shipped Command-K palette; the native route is selected by its repository-owned qualification launch argument.',
      'First visible window is observed through macOS accessibility and is not equivalent to XCTest ApplicationFirstFramePresentationResponsive.',
      'RSS is one settled observation of the recursively owned process tree and may miss short-lived descendants between launch and the settled sample.',
      'CODEVETTER_APP_DATA_DIR isolates SQLite and generated artifacts. The incumbent Tauri release still uses its normal WebKit data store and normal release background behavior.',
      'No installed application, updater, deployment, release, or production configuration is touched.',
    ],
  };

  const output =
    options.output ??
    join(runRoot, `native-tauri-comparison-${recordedAt.toISOString().replaceAll(':', '-')}.json`);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${output}\n`);
  return { report, output };
}

function inspectApplication(kind, applicationPath) {
  const path = assertSafeApplicationPath(applicationPath);
  const info = readPlist(join(path, 'Contents/Info.plist'));
  assertBundleInfo(kind, info);
  const executable = realpathSync(join(path, 'Contents/MacOS', info.CFBundleExecutable));
  if (!statSync(executable).isFile())
    throw new Error(`Application executable is missing: ${executable}`);
  return {
    path,
    bundle_identifier: info.CFBundleIdentifier,
    version: info.CFBundleShortVersionString,
    build: info.CFBundleVersion,
    executable,
    executable_bytes: statSync(executable).size,
    bundle_kib: Number(run('du', ['-sk', path]).trim().split(/\s+/)[0]),
  };
}

async function measureApplication({
  kind,
  application,
  stateDirectory,
  settleMs,
  windowTimeoutMs,
  round,
}) {
  const launchArguments = kind === 'native' ? ['--ui-test-section', 'Performance'] : [];
  const startedAt = process.hrtime.bigint();
  const child = spawn(application.executable, launchArguments, {
    cwd: repositoryRoot,
    detached: true,
    env: {
      ...process.env,
      CODEVETTER_APP_DATA_DIR: stateDirectory,
      CODEVETTER_RUNTIME_COMPARISON: '1',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-4_000);
  });

  try {
    await childSpawned(child);
    const firstVisibleWindowMs = await waitForVisibleWindow(child.pid, startedAt, windowTimeoutMs);
    if (kind === 'tauri') await openTauriPerformanceWorkspace(child.pid);
    await waitForWindowText(
      child.pid,
      expectedApplications[kind].performanceMarker,
      expectedApplications[kind].markerStrategy,
      windowTimeoutMs
    );
    await delay(settleMs);

    const table = parseProcessTable(run('ps', ['-axo', 'pid=,ppid=,rss=,command=']));
    const ownedTree = processTree(table, child.pid);
    if (ownedTree.length === 0) {
      throw new Error(`${kind} exited before the settled resource sample`);
    }
    assertExactProcess(ownedTree[0], application.executable);
    return {
      round,
      pid: child.pid,
      first_visible_window_ms: roundNumber(firstVisibleWindowMs),
      surface_confirmed: true,
      surface_marker: expectedApplications[kind].performanceMarker,
      settled_parent_rss_kib: ownedTree[0].rssKiB,
      settled_process_tree_rss_kib: ownedTree.reduce((sum, row) => sum + row.rssKiB, 0),
      settled_process_count: ownedTree.length,
      process_tree: ownedTree.map((row) => ({
        pid: row.pid,
        ppid: row.ppid,
        rss_kib: row.rssKiB,
        executable: row.command.split(/\s+/)[0],
      })),
      state_directory: stateDirectory,
    };
  } catch (error) {
    error.message = `${error.message}${stderr ? `\n${stderr}` : ''}`;
    throw error;
  } finally {
    await terminateOwnedProcess(child, application.executable);
  }
}

async function waitForWindowText(pid, expectedText, strategy, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (childExited(pid)) {
      throw new Error(`Application process ${pid} exited before the Performance surface appeared`);
    }
    const found = await windowTextProbe(pid, expectedText, strategy);
    if (found === '1') return;
    await delay(100);
  }
  throw new Error(
    `Application process ${pid} did not expose the expected Performance marker within ${timeoutMs} ms: ${expectedText}`
  );
}

function windowTextProbe(pid, expectedText, strategy) {
  if (strategy === 'tauri-web-area') {
    return appleScript(
      [
        'on run argv',
        'set targetPid to (item 1 of argv) as integer',
        'set expectedText to item 2 of argv',
        'tell application "System Events"',
        'set targetProcess to first process whose unix id is targetPid',
        'if (count of windows of targetProcess) is 0 then return "0"',
        'try',
        'set rootGroup to first UI element of front window of targetProcess whose role is "AXGroup"',
        'set webArea to first UI element of first UI element of first UI element of rootGroup',
        'if (count of UI elements of webArea) < 2 then return "0"',
        'set contentGroup to UI element 2 of webArea',
        'set matches to every UI element of contentGroup whose name is expectedText',
        'return (count of matches) as text',
        'on error',
        'return "0"',
        'end try',
        'end tell',
        'end run',
      ],
      [String(pid), expectedText]
    );
  }
  return appleScript(
    [
      'on run argv',
      'set targetPid to (item 1 of argv) as integer',
      'set expectedText to item 2 of argv',
      'tell application "System Events"',
      'set targetProcess to first process whose unix id is targetPid',
      'if (count of windows of targetProcess) is 0 then return "0"',
      'set allItems to entire contents of front window of targetProcess',
      'repeat with uiItem in allItems',
      'try',
      'if ((name of uiItem) as text) contains expectedText then return "1"',
      'end try',
      'try',
      'if ((value of uiItem) as text) contains expectedText then return "1"',
      'end try',
      'end repeat',
      'return "0"',
      'end tell',
      'end run',
    ],
    [String(pid), expectedText]
  );
}

async function waitForVisibleWindow(pid, startedAt, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (childExited(pid))
      throw new Error(`Application process ${pid} exited before showing a window`);
    const count = Number(
      await appleScript(
        [
          'on run argv',
          'set targetPid to (item 1 of argv) as integer',
          'tell application "System Events"',
          'set matches to every process whose unix id is targetPid',
          'if (count of matches) is 0 then return "0"',
          'set targetProcess to item 1 of matches',
          'return (count of windows of targetProcess) as text',
          'end tell',
          'end run',
        ],
        [String(pid)]
      )
    );
    if (count > 0) return elapsedMilliseconds(startedAt);
    await delay(25);
  }
  throw new Error(`Application process ${pid} did not show a window within ${timeoutMs} ms`);
}

async function openTauriPerformanceWorkspace(pid) {
  await appleScript(
    [
      'on run argv',
      'set targetPid to (item 1 of argv) as integer',
      'tell application "System Events"',
      'set targetProcess to first process whose unix id is targetPid',
      'set frontmost of targetProcess to true',
      'delay 0.15',
      'keystroke "k" using command down',
      'delay 0.25',
      'keystroke "Performance"',
      'delay 0.15',
      'key code 36',
      'end tell',
      'end run',
    ],
    [String(pid)]
  );
}

async function appleScript(lines, arguments_) {
  const args = lines.flatMap((line) => ['-e', line]);
  args.push('--', ...arguments_);
  const { stdout } = await execFileAsync('osascript', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout: 5_000,
  });
  return stdout.trim();
}

async function terminateOwnedProcess(child, executable) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const command = processCommand(child.pid);
  if (!command) return;
  if (!sameExecutable(command, executable)) {
    throw new Error(
      `Refusing to terminate PID ${child.pid}; executable identity changed to ${command}`
    );
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
    return;
  }
  if (await waitForExit(child, 5_000)) return;
  const current = processCommand(child.pid);
  if (!current || !sameExecutable(current, executable)) return;
  process.kill(-child.pid, 'SIGKILL');
  await waitForExit(child, 2_000);
}

function summarizeApplication(samples) {
  return {
    first_visible_window_ms: summarize(samples.map((sample) => sample.first_visible_window_ms)),
    settled_parent_rss_kib: summarize(samples.map((sample) => sample.settled_parent_rss_kib)),
    settled_process_tree_rss_kib: summarize(
      samples.map((sample) => sample.settled_process_tree_rss_kib)
    ),
    settled_process_count: summarize(samples.map((sample) => sample.settled_process_count)),
  };
}

function comparisonSummary(samples) {
  const native = summarizeApplication(samples.native);
  const tauri = summarizeApplication(samples.tauri);
  return {
    first_visible_window_median_delta_ms: round(
      native.first_visible_window_ms.median - tauri.first_visible_window_ms.median
    ),
    first_visible_window_median_ratio: ratio(
      native.first_visible_window_ms.median,
      tauri.first_visible_window_ms.median
    ),
    settled_process_tree_rss_median_delta_kib: round(
      native.settled_process_tree_rss_kib.median - tauri.settled_process_tree_rss_kib.median
    ),
    settled_process_tree_rss_median_ratio: ratio(
      native.settled_process_tree_rss_kib.median,
      tauri.settled_process_tree_rss_kib.median
    ),
  };
}

function sourceIdentity() {
  return {
    base_sha: run('git', ['rev-parse', 'HEAD']).trim(),
    branch: run('git', ['branch', '--show-current']).trim(),
    working_tree: run('git', ['status', '--porcelain']).trim() ? 'dirty' : 'clean',
    node: process.version,
  };
}

function machineIdentity() {
  return {
    platform: process.platform,
    architecture: process.arch,
    model: safeRun('sysctl', ['-n', 'hw.model']),
    logical_cpu: Number(safeRun('sysctl', ['-n', 'hw.logicalcpu'])),
    memory_bytes: Number(safeRun('sysctl', ['-n', 'hw.memsize'])),
    macos: safeRun('sw_vers', ['-productVersion']),
  };
}

function readPlist(path) {
  return JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', path]));
}

function assertExactProcess(processRow, executable) {
  if (!sameExecutable(processRow.command, executable)) {
    throw new Error(
      `PID ${processRow.pid} does not belong to the expected executable: ${processRow.command}`
    );
  }
}

function sameExecutable(command, executable) {
  return command === executable || command.startsWith(`${executable} `);
}

function processCommand(pid) {
  const value = safeRun('ps', ['-p', String(pid), '-o', 'command=']);
  return value || null;
}

function childExited(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    if (error.code === 'ESRCH') return true;
    throw error;
  }
}

function childSpawned(child) {
  return new Promise((resolve_, reject) => {
    if (child.pid) resolve_();
    else {
      child.once('spawn', resolve_);
      child.once('error', reject);
    }
  });
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve_) => {
    const timeout = setTimeout(() => {
      child.off('exit', onExit);
      resolve_(false);
    }, timeoutMs);
    function onExit() {
      clearTimeout(timeout);
      resolve_(true);
    }
    child.once('exit', onExit);
  });
}

function requiredValue(argv, index, argument) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
  return value;
}

function positiveInteger(value, argument) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${argument} requires a positive integer`);
  }
  return parsed;
}

function ensureDirectory(path) {
  mkdirSync(path, { recursive: true });
  return path;
}

function run(command, args) {
  return execFileSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function safeRun(command, args) {
  try {
    return run(command, args).trim();
  } catch {
    return 'unavailable';
  }
}

function elapsedMilliseconds(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

function roundNumber(value) {
  return Math.round(value * 1_000) / 1_000;
}

function round(value) {
  return Math.round(value * 1_000) / 1_000;
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : round(numerator / denominator);
}

function delay(milliseconds) {
  return new Promise((resolve_) => setTimeout(resolve_, milliseconds));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  compareDesktopRuntime().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
