#!/usr/bin/env node

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const XCODEBUILDMCP = 'xcodebuildmcp@2.7.0';
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nativePerformanceGateTests = [
  'hundredRunLedgerDecodesAndRendersWithinTheNativeGate',
  'largeUnpackProjectionDecodesAndRendersWithinTheNativeGate',
  'largeUsageReportDecodesAndRendersWithinTheNativeGate',
  'hundredRowPerformanceReceiptDecodesAndRendersWithinTheNativeGate',
  'hundredJourneyTestingReceiptDecodesAndRendersWithinTheNativeGate',
];

export function nativeCheckCachePath(root = repositoryRoot) {
  return resolve(root, 'artifacts/native-checks/xcodebuildmcp-npm-cache');
}

export function parseNativeCheckArguments(arguments_) {
  let mode = 'background';
  let foregroundApproved = false;
  let desktopIdleApproved = false;
  for (const argument of arguments_) {
    if (argument === '--') continue;
    if (argument === '--background') mode = 'background';
    else if (argument === '--release') mode = 'release';
    else if (argument === '--ui') mode = 'ui';
    else if (argument === '--full') mode = 'full';
    else if (argument === '--foreground') foregroundApproved = true;
    else if (argument === '--desktop-idle') desktopIdleApproved = true;
    else throw new Error(`Unknown native-check argument: ${argument}`);
  }
  if ((mode === 'ui' || mode === 'full') && (!foregroundApproved || !desktopIdleApproved)) {
    throw new Error(
      'Foreground UI automation requires the just-in-time flags --foreground --desktop-idle because it controls the active macOS desktop.'
    );
  }
  return { mode, foregroundApproved, desktopIdleApproved };
}

export function nativeReleaseBuildSettings(environment = process.env) {
  const settings = [
    'ENABLE_CODE_COVERAGE=NO',
    'CLANG_ENABLE_CODE_COVERAGE=NO',
    'CLANG_COVERAGE_MAPPING=NO',
  ];
  const channel = environment.CODEVETTER_NATIVE_CHANNEL ?? 'preview';
  if (channel === 'preview') {
    return [...settings, 'PRODUCT_BUNDLE_IDENTIFIER=com.codevetter.desktop.native-preview'];
  }
  if (channel !== 'production') {
    throw new Error(`Unsupported native release channel: ${channel}`);
  }

  const bundleIdentifier = environment.CODEVETTER_NATIVE_BUNDLE_IDENTIFIER;
  const feedURL = environment.CODEVETTER_NATIVE_SPARKLE_FEED_URL;
  const publicKey = environment.CODEVETTER_NATIVE_SPARKLE_PUBLIC_KEY;
  if (bundleIdentifier !== 'com.codevetter.desktop') {
    throw new Error('Production native builds require com.codevetter.desktop');
  }
  if (!isHTTPSURL(feedURL)) {
    throw new Error('Production native builds require an HTTPS Sparkle feed URL');
  }
  if (!isCanonicalEdDSAPublicKey(publicKey)) {
    throw new Error(
      'Production native builds require a canonical 32-byte Sparkle EdDSA public key'
    );
  }
  return [
    ...settings,
    'CODE_SIGNING_ALLOWED=NO',
    'CODE_SIGNING_REQUIRED=NO',
    `PRODUCT_BUNDLE_IDENTIFIER=${bundleIdentifier}`,
    `INFOPLIST_KEY_SUFeedURL=${feedURL}`,
    `INFOPLIST_KEY_SUPublicEDKey=${publicKey}`,
  ];
}

export function nativeCheckCommands({ mode }, environment = process.env) {
  const background = [
    {
      label: 'Swift package behavior',
      backgroundSafe: true,
      arguments: [
        'swift-package',
        'test',
        '--json',
        JSON.stringify({
          packagePath: 'apps/macos/CodeVetterPackage',
          parallel: false,
        }),
      ],
    },
    ...nativePerformanceGateTests.map((filter) => ({
      label: `Isolated native performance gate: ${filter}`,
      backgroundSafe: true,
      environment: { CODEVETTER_NATIVE_PERFORMANCE_GATE: '1' },
      arguments: [
        'swift-package',
        'test',
        '--json',
        JSON.stringify({
          packagePath: 'apps/macos/CodeVetterPackage',
          configuration: 'Release',
          parallel: false,
          filter,
        }),
      ],
    })),
    {
      label: 'Native macOS application compile',
      backgroundSafe: true,
      arguments: [
        'macos',
        'build',
        '--workspace-path',
        'apps/macos/CodeVetter.xcworkspace',
        '--scheme',
        'CodeVetter',
        '--configuration',
        'Debug',
      ],
    },
  ];
  const ui = {
    label: 'Foreground macOS interaction tests',
    backgroundSafe: false,
    arguments: [
      'macos',
      'test',
      '--json',
      JSON.stringify({
        workspacePath: 'apps/macos/CodeVetter.xcworkspace',
        scheme: 'CodeVetter',
        configuration: 'Debug',
        extraArgs: ['-only-testing:CodeVetterUITests'],
      }),
    ],
  };
  const release = {
    label: 'Coverage-free native macOS Release compile',
    backgroundSafe: true,
    arguments: [
      'macos',
      'build',
      '--json',
      JSON.stringify({
        workspacePath: 'apps/macos/CodeVetter.xcworkspace',
        scheme: 'CodeVetter',
        configuration: 'Release',
        arch: 'arm64',
        derivedDataPath: 'artifacts/native-build/DerivedData',
        extraArgs: nativeReleaseBuildSettings(environment),
      }),
    ],
  };
  if (mode === 'background') return background;
  if (mode === 'release') return [release];
  if (mode === 'ui') return [ui];
  return [...background, ui];
}

export function nativeCheckEnvironment(environment, cache) {
  const clean = Object.fromEntries(
    Object.entries(environment).filter(([key]) => !key.toLowerCase().startsWith('npm_config_'))
  );
  clean.npm_config_cache = cache;
  clean.npm_config_update_notifier = 'false';
  return clean;
}

export function nativeCheckInvocation(command, environment = process.env) {
  const lowerPriority = command.backgroundSafe && environment.GITHUB_ACTIONS !== 'true';
  return lowerPriority
    ? {
        executable: '/usr/bin/nice',
        arguments: ['-n', '10', 'npx', '-y', XCODEBUILDMCP, ...command.arguments],
      }
    : {
        executable: 'npx',
        arguments: ['-y', XCODEBUILDMCP, ...command.arguments],
      };
}

export function runNativeChecks(options, spawn = spawnSync) {
  if (process.platform !== 'darwin') {
    throw new Error('Native CodeVetter checks require macOS.');
  }
  const cache = nativeCheckCachePath();
  mkdirSync(cache, { recursive: true });
  for (const command of nativeCheckCommands(options, process.env)) {
    process.stdout.write(`\n[native] ${command.label}\n`);
    if (!command.backgroundSafe) {
      process.stdout.write(
        '[native] Foreground lane: CodeVetter and XCUITest may take focus until this command finishes.\n'
      );
    }
    // Keep local checks polite while the operator works. The isolated hosted
    // runner owns its machine and must use normal priority for wall-clock gates.
    const { executable, arguments: arguments_ } = nativeCheckInvocation(command);
    const result = spawn(executable, arguments_, {
      cwd: repositoryRoot,
      env: {
        ...nativeCheckEnvironment(process.env, cache),
        ...command.environment,
      },
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      return result.status ?? 1;
    }
  }
  return 0;
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

function isMainModule() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  try {
    process.exitCode = runNativeChecks(parseNativeCheckArguments(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
