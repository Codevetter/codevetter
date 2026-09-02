#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { captureDataSnapshot, compareDataSnapshots } from './qualify-native-data-continuity.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const productionBundleIdentifier = 'com.codevetter.desktop';
const proofSchema = 'codevetter.native-installed-upgrade-proof/v1';
const qualificationSchema = 'codevetter.native-package-qualification/v1';

export function parseArguments(argv) {
  const options = { foregroundApproved: false, hostedEphemeral: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--incumbent-app') {
      options.incumbentApp = resolve(requiredValue(argv, ++index, argument));
    } else if (argument === '--native-app') {
      options.nativeApp = resolve(requiredValue(argv, ++index, argument));
    } else if (argument === '--qualification') {
      options.qualification = resolve(requiredValue(argv, ++index, argument));
    } else if (argument === '--run-root') {
      options.runRoot = resolve(requiredValue(argv, ++index, argument));
    } else if (argument === '--out') {
      options.out = resolve(requiredValue(argv, ++index, argument));
    } else if (argument === '--foreground') options.foregroundApproved = true;
    else if (argument === '--hosted-ephemeral') options.hostedEphemeral = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  for (const required of ['incumbentApp', 'nativeApp', 'qualification', 'runRoot', 'out']) {
    if (!options[required]) throw new Error(`--${camelToKebab(required)} is required`);
  }
  return options;
}

export function assertHostedUpgradeContext(options, environment = process.env) {
  if (!options.foregroundApproved || !options.hostedEphemeral) {
    throw new Error('Installed-upgrade qualification requires --foreground --hosted-ephemeral');
  }
  if (environment.GITHUB_ACTIONS !== 'true' || !environment.RUNNER_TEMP) {
    throw new Error('Installed-upgrade qualification runs only on an isolated GitHub-hosted Mac');
  }
  const runnerTemp = resolve(environment.RUNNER_TEMP);
  const runRoot = resolve(options.runRoot);
  const relation = relative(runnerTemp, runRoot);
  if (!relation || relation.startsWith('..') || resolve(runRoot).startsWith('/Applications/')) {
    throw new Error('The upgrade run root must be a dedicated child of RUNNER_TEMP');
  }
  for (const app of [options.incumbentApp, options.nativeApp]) {
    if (resolve(app).startsWith('/Applications/')) {
      throw new Error('Installed applications are outside hosted qualification authority');
    }
  }
  return { runnerTemp, runRoot };
}

export function buildInstalledUpgradeProof({
  qualification,
  nativeInfo,
  continuity,
  launches,
  rubricPreserved,
  recordedAt = new Date().toISOString(),
}) {
  if (qualification.schema_version !== qualificationSchema) {
    throw new Error('Unsupported native package qualification schema');
  }
  const archive = (qualification.archives ?? []).find((item) => item.name.endsWith('.zip'));
  if (!archive?.sha256) throw new Error('The native qualification has no ZIP archive identity');
  const requiredLaunches = ['tauri_before', 'native_upgrade', 'native_relaunch', 'tauri_rollback'];
  const launchPassed = requiredLaunches.every((kind) =>
    launches.some((item) => item.kind === kind && item.visible_window === true)
  );
  const passed =
    nativeInfo.CFBundleIdentifier === productionBundleIdentifier &&
    launchPassed &&
    rubricPreserved === true &&
    continuity.before_sha256 === continuity.after_upgrade_sha256 &&
    continuity.before_sha256 === continuity.after_rollback_sha256;
  return {
    schema_version: proofSchema,
    authority: 'isolated_hosted_installation',
    recorded_at: recordedAt,
    status: passed ? 'passed' : 'failed',
    bundle_identifier: nativeInfo.CFBundleIdentifier,
    version: nativeInfo.CFBundleShortVersionString,
    build: nativeInfo.CFBundleVersion,
    archive_sha256: archive.sha256,
    upgrade: passed,
    relaunch: passed,
    rollback: passed,
    custom_rubric_preserved: rubricPreserved,
    launches,
    data_continuity: continuity,
    limitations: [
      'The install, relaunch, and rollback occurred only inside RUNNER_TEMP on an isolated hosted Mac.',
      'No application under /Applications and no operator data or credentials were read or changed.',
      'Public release and replacement of the retained Tauri application remain separately authorized actions.',
    ],
  };
}

export async function qualifyInstalledUpgrade(
  options = parseArguments(process.argv.slice(2)),
  environment = process.env
) {
  if (process.platform !== 'darwin')
    throw new Error('Installed-upgrade qualification requires macOS');
  const { runRoot } = assertHostedUpgradeContext(options, environment);
  const incumbentApp = verifiedApplication(options.incumbentApp, {
    bundle: productionBundleIdentifier,
    executable: 'codevetter-desktop',
  });
  const nativeApp = verifiedApplication(options.nativeApp, {
    bundle: productionBundleIdentifier,
    executable: 'CodeVetterNative',
  });
  const qualification = readJSON(options.qualification);
  const installRoot = join(runRoot, 'installation');
  const installedApp = join(installRoot, 'CodeVetter.app');
  const appData = join(runRoot, 'Application Support', productionBundleIdentifier);
  const database = join(appData, 'codevetter.db');
  mkdirSync(appData, { recursive: true });
  const launches = [];

  try {
    replaceApplication(incumbentApp.path, installedApp, installRoot);
    const incumbentCLI = join(installedApp, 'Contents/MacOS/codevetter');
    runCLI(incumbentCLI, appData, [
      'rubrics',
      '--id',
      'hosted-migration-proof',
      '--name',
      'Hosted migration proof',
      '--focus',
      'Preserve exact verification evidence during shell migration.',
      '--check',
      'Keep the custom rubric available after upgrade and rollback.',
      '--json',
    ]);
    launches.push(await launchAndObserve(installedApp, appData, 'tauri_before'));
    const before = captureDataSnapshot({ databasePath: database, phase: 'before' });

    replaceApplication(nativeApp.path, installedApp, installRoot);
    launches.push(await launchAndObserve(installedApp, appData, 'native_upgrade'));
    launches.push(await launchAndObserve(installedApp, appData, 'native_relaunch'));
    const nativeCLI = join(installedApp, 'Contents/MacOS/codevetter');
    const afterNativeRubrics = runCLI(nativeCLI, appData, ['rubrics', '--json']);
    const afterUpgrade = captureDataSnapshot({
      databasePath: database,
      phase: 'after_upgrade',
      baseline: before,
    });

    replaceApplication(incumbentApp.path, installedApp, installRoot);
    launches.push(await launchAndObserve(installedApp, appData, 'tauri_rollback'));
    const rollbackCLI = join(installedApp, 'Contents/MacOS/codevetter');
    const afterRollbackRubrics = runCLI(rollbackCLI, appData, ['rubrics', '--json']);
    const afterRollback = captureDataSnapshot({
      databasePath: database,
      phase: 'after_rollback',
      baseline: before,
    });
    const continuity = compareDataSnapshots(before, afterUpgrade, afterRollback);
    const rubricPreserved = [afterNativeRubrics, afterRollbackRubrics].every((receipt) =>
      receipt.packs?.some((pack) => pack.id === 'hosted-migration-proof' && pack.active === true)
    );
    const proof = buildInstalledUpgradeProof({
      qualification,
      nativeInfo: nativeApp.info,
      continuity,
      launches,
      rubricPreserved,
    });
    writeFileSync(options.out, `${JSON.stringify(proof, null, 2)}\n`);
    process.stdout.write(`${options.out}\n`);
    if (proof.status !== 'passed') process.exitCode = 1;
    return proof;
  } finally {
    rmSync(runRoot, { recursive: true, force: true });
  }
}

function verifiedApplication(path, expected) {
  const canonical = realpathSync(path);
  if (canonical.startsWith('/Applications/') || !statSync(canonical).isDirectory()) {
    throw new Error(`Unsafe application path: ${canonical}`);
  }
  const info = readPlist(join(canonical, 'Contents/Info.plist'));
  if (
    info.CFBundleIdentifier !== expected.bundle ||
    info.CFBundleExecutable !== expected.executable
  ) {
    throw new Error(`Unexpected application identity: ${canonical}`);
  }
  return { path: canonical, info };
}

function replaceApplication(source, destination, installRoot) {
  if (!destination.startsWith(`${installRoot}/`))
    throw new Error('Unsafe hosted install destination');
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(installRoot, { recursive: true });
  execFileSync('ditto', [source, destination], { cwd: repositoryRoot, stdio: 'ignore' });
}

function runCLI(command, appData, arguments_) {
  const output = execFileSync(command, arguments_, {
    cwd: repositoryRoot,
    env: { ...process.env, CODEVETTER_APP_DATA_DIR: appData },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(output);
}

async function launchAndObserve(app, appData, kind) {
  const info = readPlist(join(app, 'Contents/Info.plist'));
  const executable = join(app, 'Contents/MacOS', info.CFBundleExecutable);
  const arguments_ =
    info.CFBundleExecutable === 'CodeVetterNative' ? ['--ui-test-section', 'Runs'] : [];
  const child = spawn(executable, arguments_, {
    cwd: repositoryRoot,
    detached: true,
    env: { ...process.env, CODEVETTER_APP_DATA_DIR: appData },
    stdio: 'ignore',
  });
  try {
    await waitForVisibleWindow(child, 25_000);
    return { kind, visible_window: true, bundle_identifier: info.CFBundleIdentifier };
  } finally {
    await terminateOwnedProcess(child);
  }
}

async function waitForVisibleWindow(child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Application exited before showing a window`);
    const script = `tell application "System Events" to count windows of first process whose unix id is ${child.pid}`;
    try {
      const count = Number(execFileSync('osascript', ['-e', script], { encoding: 'utf8' }).trim());
      if (count > 0) return;
    } catch {
      // The process may not have registered with System Events yet.
    }
    await delay(250);
  }
  throw new Error(`Application ${child.pid} did not show a visible window within ${timeoutMs} ms`);
}

async function terminateOwnedProcess(child) {
  if (child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    return;
  }
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline && child.exitCode === null) await delay(100);
  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // The owned process group already exited.
    }
  }
}

function readPlist(path) {
  return JSON.parse(
    execFileSync('plutil', ['-convert', 'json', '-o', '-', path], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    })
  );
}

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function camelToKebab(value) {
  return value.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
}

function requiredValue(argv, index, argument) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
  return value;
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  qualifyInstalledUpgrade().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
