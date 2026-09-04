#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultBuild = join(
  repositoryRoot,
  'artifacts/native-build/DerivedData/Build/Products/Release/CodeVetter.app'
);
const defaultOutputRoot = join(repositoryRoot, 'artifacts/native-package');
const releaseEntitlements = join(
  repositoryRoot,
  'apps/macos/Config/CodeVetter.Release.entitlements'
);

export function runtimeFiles(sourceDirectory) {
  return readdirSync(sourceDirectory)
    .filter((name) => name.endsWith('.mjs') && !name.endsWith('.test.mjs'))
    .sort();
}

export function assertPreviewBundle(info) {
  if (info.CFBundleIdentifier !== 'com.codevetter.desktop.native-preview') {
    throw new Error(
      `Refusing to qualify non-preview bundle identifier: ${info.CFBundleIdentifier ?? 'missing'}`
    );
  }
  if (info.CFBundleExecutable !== 'CodeVetterNative') {
    throw new Error(
      `The app executable must remain distinct from the codevetter CLI; received ${info.CFBundleExecutable ?? 'missing'}`
    );
  }
  if (info.SUFeedURL || info.SUPublicEDKey) {
    throw new Error('Preview packages must not contain a Sparkle feed or EdDSA public key');
  }
}

export function assertProductionBundle(info) {
  if (info.CFBundleIdentifier !== 'com.codevetter.desktop') {
    throw new Error(
      `Production packages require com.codevetter.desktop; received ${info.CFBundleIdentifier ?? 'missing'}`
    );
  }
  if (info.CFBundleExecutable !== 'CodeVetterNative') {
    throw new Error(
      `The app executable must remain distinct from the codevetter CLI; received ${info.CFBundleExecutable ?? 'missing'}`
    );
  }
  if (!isHTTPSURL(info.SUFeedURL)) {
    throw new Error('Production packages require an HTTPS Sparkle feed URL');
  }
  if (!isCanonicalEdDSAPublicKey(info.SUPublicEDKey)) {
    throw new Error('Production packages require a canonical 32-byte Sparkle EdDSA public key');
  }
}

export function hostTarget(rustVersionText) {
  const target = rustVersionText
    .split('\n')
    .find((line) => line.startsWith('host: '))
    ?.slice('host: '.length);
  if (!target) throw new Error('Could not determine the Rust host target');
  return target;
}

export function architectureForTarget(target) {
  if (target === 'aarch64-apple-darwin') return 'arm64';
  if (target === 'x86_64-apple-darwin') return 'x86_64';
  throw new Error(`Unsupported native package target: ${target}`);
}

export function assertFrameworkRPath(loadCommands) {
  if (!loadCommands.includes('@executable_path/../Frameworks')) {
    throw new Error('The native executable cannot resolve bundled frameworks through @rpath');
  }
}

export function assertNoCoverageInstrumentation(loadCommands) {
  const forbidden = ['segname __LLVM_COV', 'sectname __llvm_prf', 'sectname __llvm_cov'];
  const present = forbidden.filter((marker) => loadCommands.includes(marker));
  if (present.length > 0) {
    throw new Error(
      `The native Release executable contains test coverage instrumentation: ${present.join(', ')}`
    );
  }
}

export function assertPackagedCliCapabilities(help) {
  const required = [
    'list|inspect|scan|compare|export|query|query-worker',
    '--query-domain <name>',
    '--query-mode <name>',
    '--query-target <value>',
    '--query-direction <name>',
    '--query-depth <n>',
    '--history-selector <name>',
  ];
  const missing = required.filter((capability) => !help.includes(capability));
  if (missing.length > 0) {
    throw new Error(`The packaged CLI is missing repository-query parity: ${missing.join(', ')}`);
  }
}

export function parseArguments(argv) {
  const options = {
    app: defaultBuild,
    outputRoot: defaultOutputRoot,
    identity: '-',
    channel: 'preview',
    prepareSidecars: true,
    target: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--app') options.app = resolve(requiredValue(argv, ++index, argument));
    else if (argument === '--out-root') {
      options.outputRoot = resolve(requiredValue(argv, ++index, argument));
    } else if (argument === '--identity') {
      options.identity = requiredValue(argv, ++index, argument);
    } else if (argument === '--channel') {
      options.channel = requiredValue(argv, ++index, argument);
    } else if (argument === '--target') {
      options.target = requiredValue(argv, ++index, argument);
    } else if (argument === '--skip-sidecar-build') options.prepareSidecars = false;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

export function qualifyNativePackage(options = parseArguments(process.argv.slice(2))) {
  const sourceApp = resolve(options.app);
  if (!existsSync(sourceApp) || !statSync(sourceApp).isDirectory()) {
    throw new Error(`Release application is missing: ${sourceApp}`);
  }

  const sourceInfo = readPlist(join(sourceApp, 'Contents/Info.plist'));
  assertPackageBundle(sourceInfo, options.channel, options.identity);
  assertFile(join(sourceApp, 'Contents/Frameworks/Sparkle.framework/Versions/Current/Sparkle'));
  const hostLoadCommands = run('otool', [
    '-l',
    join(sourceApp, 'Contents/MacOS', sourceInfo.CFBundleExecutable),
  ]);
  assertFrameworkRPath(hostLoadCommands);
  assertNoCoverageInstrumentation(hostLoadCommands);

  const target = options.target ?? hostTarget(run('rustc', ['-vV']));
  const architecture = architectureForTarget(target);
  const appArchitectures = run('lipo', [
    '-archs',
    join(sourceApp, 'Contents/MacOS', sourceInfo.CFBundleExecutable),
  ]).split(/\s+/);
  if (!appArchitectures.includes(architecture)) {
    throw new Error(`Native application does not contain the requested ${architecture} target`);
  }
  if (options.prepareSidecars) prepareSidecars(target);
  const runDirectory = mkdtempSync(join(ensureDirectory(options.outputRoot), 'qualification-'));
  const stagedApp = join(runDirectory, 'CodeVetter.app');
  // `ditto` preserves relative framework symlinks and extended attributes.
  // Node's recursive copy rewrites Sparkle symlinks to absolute source paths,
  // which invalidates the framework seal as soon as the source build moves.
  run('ditto', [sourceApp, stagedApp]);

  const executableDirectory = join(stagedApp, 'Contents/MacOS');
  const executableSidecars = [
    ['codevetter', join('binaries', `codevetter-${target}`)],
    ['codevetter-mcp', join('binaries', `codevetter-mcp-${target}`)],
    ['ccusage', join('binaries', `ccusage-${target}`)],
  ].map(([destinationName, preparedPath]) => {
    const source = join(repositoryRoot, 'apps/desktop/src-tauri', preparedPath);
    const destination = join(executableDirectory, destinationName);
    assertFile(source);
    copyFileSync(source, destination);
    chmodSync(destination, 0o755);
    return destination;
  });
  const collectorDirectory = join(stagedApp, 'Contents/Resources/collectors');
  mkdirSync(collectorDirectory, { recursive: true });
  const collectorSidecars = ['gitleaks', 'cargo-audit', 'cargo-llvm-cov'].map((name) => {
    const source = join(repositoryRoot, 'apps/desktop/src-tauri/resources/collectors', name);
    const destination = join(collectorDirectory, name);
    assertFile(source);
    copyFileSync(source, destination);
    chmodSync(destination, 0o755);
    return destination;
  });
  const sidecars = [...executableSidecars, ...collectorSidecars];

  const runtimeSource = join(repositoryRoot, 'scripts/runtime-failure-capsule');
  const runtimeDestination = join(stagedApp, 'Contents/Resources/runtime-failure-capsule');
  mkdirSync(runtimeDestination, { recursive: true });
  const packagedRuntimeFiles = runtimeFiles(runtimeSource);
  for (const name of packagedRuntimeFiles) {
    copyFileSync(join(runtimeSource, name), join(runtimeDestination, name));
  }
  const advisoryDatabaseSource = join(
    repositoryRoot,
    'apps/desktop/src-tauri/resources/rustsec-advisory-db/snapshot'
  );
  const advisoryDatabaseDestination = join(
    stagedApp,
    'Contents/Resources/rustsec-advisory-db/snapshot'
  );
  cpSync(advisoryDatabaseSource, advisoryDatabaseDestination, { recursive: true });

  signSparkle(stagedApp, options.identity);
  for (const executable of executableSidecars) sign(executable, options.identity);
  for (const executable of collectorSidecars) {
    // macOS rejects ad-hoc hardened third-party Go collectors on current hosts.
    // Developer ID production packages retain hardened runtime for every binary.
    sign(executable, options.identity, undefined, options.identity !== '-');
  }
  const appEntitlements =
    options.identity === '-' ? writeLocalPreviewEntitlements(runDirectory) : releaseEntitlements;
  sign(stagedApp, options.identity, appEntitlements);
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', stagedApp]);

  const stagedInfo = readPlist(join(stagedApp, 'Contents/Info.plist'));
  assertPackageBundle(stagedInfo, options.channel, options.identity);
  const cliHelp = run(sidecars[0], ['--help'], { stdio: ['ignore', 'pipe', 'pipe'] });
  assertPackagedCliCapabilities(cliHelp);
  const smoke = {
    cli: { exit_code: 0, output: cliHelp.trim().slice(0, 500) },
    mcp: capture(sidecars[1], ['--help']),
    ccusage: capture(sidecars[2], ['--version']),
    gitleaks: capture(sidecars[3], ['version']),
    cargo_audit: capture(sidecars[4], ['--version']),
    cargo_llvm_cov: capture(sidecars[5], ['llvm-cov', '--version']),
    runtime: capture(process.execPath, [join(runtimeDestination, 'cli.mjs'), '--help']),
  };
  if (!smoke.ccusage.output.includes('20.0.20')) {
    throw new Error(`Unexpected bundled ccusage version: ${smoke.ccusage.output}`);
  }
  if (!smoke.gitleaks.output.includes('8.30.1')) {
    throw new Error(`Unexpected bundled gitleaks version: ${smoke.gitleaks.output}`);
  }
  if (!smoke.cargo_audit.output.includes('0.22.2')) {
    throw new Error(`Unexpected bundled cargo-audit version: ${smoke.cargo_audit.output}`);
  }
  if (!smoke.cargo_llvm_cov.output.includes('0.9.0')) {
    throw new Error(`Unexpected bundled cargo-llvm-cov version: ${smoke.cargo_llvm_cov.output}`);
  }

  const version = stagedInfo.CFBundleShortVersionString;
  const archiveStem = `CodeVetter-${version}-${architecture}`;
  const zipPath = join(runDirectory, `${archiveStem}.zip`);
  const dmgPath = join(runDirectory, `${archiveStem}.dmg`);
  run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', stagedApp, zipPath]);
  run('hdiutil', [
    'create',
    '-quiet',
    '-volname',
    'CodeVetter',
    '-srcfolder',
    stagedApp,
    '-format',
    'UDZO',
    dmgPath,
  ]);

  const receipt = {
    schema_version: 'codevetter.native-package-qualification/v1',
    recorded_at: new Date().toISOString(),
    status: 'local_package_qualified',
    shipping_ready: false,
    application: {
      path: stagedApp,
      bundle_identifier: stagedInfo.CFBundleIdentifier,
      executable: stagedInfo.CFBundleExecutable,
      version,
      build: stagedInfo.CFBundleVersion,
      architecture,
      hardened_runtime: true,
      app_sandbox: false,
      coverage_instrumentation: false,
      library_validation: options.identity !== '-',
      signing: options.identity === '-' ? 'ad_hoc_local' : 'operator_supplied_identity',
    },
    updater: {
      framework: 'Sparkle',
      version: sparkleVersion(stagedApp),
      feed_configured: isHTTPSURL(stagedInfo.SUFeedURL),
      eddsa_public_key_configured: isCanonicalEdDSAPublicKey(stagedInfo.SUPublicEDKey),
      enabled:
        options.channel === 'production' &&
        isHTTPSURL(stagedInfo.SUFeedURL) &&
        isCanonicalEdDSAPublicKey(stagedInfo.SUPublicEDKey),
    },
    sidecars: sidecars.map((path) => ({
      ...artifact(path),
      relative_path: relative(stagedApp, path),
    })),
    runtime_files: packagedRuntimeFiles,
    smoke,
    archives: [artifact(zipPath), artifact(dmgPath)],
    blockers: [
      ...(options.channel === 'preview'
        ? ['Production bundle identifier transfer requires owner approval.']
        : []),
      ...(options.identity === '-'
        ? ['Developer ID signing and Apple notarization have not been performed.']
        : ['Apple notarization has not been performed.']),
      ...(options.identity === '-'
        ? [
            'The ad-hoc preview disables Library Validation because ad-hoc components have no shared Team ID; production must prove it enabled after Developer ID signing.',
          ]
        : []),
      ...(options.channel === 'preview'
        ? ['A production HTTPS Sparkle appcast and real EdDSA public key are not configured.']
        : []),
      'Installed upgrade and rollback proof has not been completed.',
    ],
  };
  const receiptPath = join(runDirectory, 'qualification.json');
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(`${receiptPath}\n`);
  return { receipt, receiptPath, stagedApp, zipPath, dmgPath };
}

function assertPackageBundle(info, channel, identity) {
  if (channel === 'preview') return assertPreviewBundle(info);
  if (channel !== 'production') throw new Error(`Unsupported native package channel: ${channel}`);
  if (!identity || identity === '-') {
    throw new Error('Production native packages require a Developer ID signing identity');
  }
  assertProductionBundle(info);
}

function isHTTPSURL(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function isCanonicalEdDSAPublicKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) return false;
  const decoded = Buffer.from(value, 'base64');
  return decoded.length === 32 && decoded.toString('base64') === value;
}

function prepareSidecars(target) {
  for (const [script, args] of [
    ['apps/desktop/scripts/prepare-cli-sidecar.mjs', ['--release']],
    ['apps/desktop/scripts/prepare-mcp-sidecar.mjs', ['--release']],
    ['apps/desktop/scripts/prepare-ccusage-sidecar.mjs', []],
    ['apps/desktop/scripts/prepare-collector-sidecars.mjs', []],
  ]) {
    run(process.execPath, [join(repositoryRoot, script), ...args], {
      stdio: 'inherit',
      env: { ...process.env, TAURI_ENV_TARGET_TRIPLE: target },
    });
  }
}

export function codesignArguments(path, identity, entitlements, hardenedRuntime = true) {
  const args = ['--force', '--sign', identity];
  if (hardenedRuntime) args.push('--options', 'runtime');
  if (identity === '-') args.push('--timestamp=none');
  if (entitlements) args.push('--entitlements', entitlements);
  args.push(path);
  return args;
}

function sign(path, identity, entitlements, hardenedRuntime = true) {
  const args = codesignArguments(path, identity, entitlements, hardenedRuntime);
  run('codesign', args, { stdio: 'inherit' });
}

function signSparkle(app, identity) {
  const framework = join(app, 'Contents/Frameworks/Sparkle.framework');
  const current = join(framework, 'Versions/Current');
  const components = [
    join(current, 'XPCServices/Installer.xpc'),
    join(current, 'XPCServices/Downloader.xpc'),
    join(current, 'Updater.app'),
    join(current, 'Autoupdate'),
    framework,
  ];
  for (const component of components) {
    const args = [
      '--force',
      '--sign',
      identity,
      '--options',
      'runtime',
      '--preserve-metadata=entitlements,flags',
    ];
    if (identity === '-') args.push('--timestamp=none');
    args.push(component);
    run('codesign', args, { stdio: 'inherit' });
  }
}

function writeLocalPreviewEntitlements(runDirectory) {
  const path = join(runDirectory, 'CodeVetter.LocalPreview.entitlements');
  writeFileSync(
    path,
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      '<dict>',
      '  <key>com.apple.security.cs.disable-library-validation</key>',
      '  <true/>',
      '</dict>',
      '</plist>',
      '',
    ].join('\n')
  );
  return path;
}

function sparkleVersion(app) {
  const info = readPlist(
    join(app, 'Contents/Frameworks/Sparkle.framework/Versions/Current/Resources/Info.plist')
  );
  return info.CFBundleShortVersionString ?? info.CFBundleVersion ?? 'unknown';
}

function artifact(path) {
  const bytes = readFileSync(path);
  return {
    name: basename(path),
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function capture(command, args) {
  try {
    const output = run(command, args, { stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    return { exit_code: 0, output: output.slice(0, 500) };
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
    const exitCode = Number.isInteger(error.status) ? error.status : 1;
    if (exitCode > 2) throw error;
    return { exit_code: exitCode, output: output.slice(0, 500) };
  }
}

function readPlist(path) {
  return JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', path]));
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    env: options.env ?? process.env,
  });
}

function requiredValue(argv, index, argument) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
  return value;
}

function ensureDirectory(path) {
  mkdirSync(path, { recursive: true });
  return path.endsWith('/') ? path : `${path}/`;
}

function assertFile(path) {
  if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size === 0) {
    throw new Error(`Required file is missing or empty: ${path}`);
  }
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) qualifyNativePackage();
