import assert from 'node:assert/strict';
import test from 'node:test';

import {
  nativeCheckCommands,
  nativeCheckCachePath,
  nativeCheckEnvironment,
  nativeCheckInvocation,
  nativeReleaseBuildSettings,
  parseNativeCheckArguments,
} from './run-native-checks.mjs';

test('native automation defaults to the non-activating background lane', () => {
  const parsed = parseNativeCheckArguments([]);
  assert.deepEqual(parsed, {
    mode: 'background',
    foregroundApproved: false,
    desktopIdleApproved: false,
  });
  const commands = nativeCheckCommands(parsed);
  assert.equal(commands.length, 7);
  assert.ok(commands.every((command) => command.backgroundSafe));
  assert.ok(
    commands.every(
      (command) => !command.arguments.includes('test') || command.arguments[0] === 'swift-package'
    )
  );
  assert.deepEqual(JSON.parse(commands[0].arguments[3]), {
    packagePath: 'apps/macos/CodeVetterPackage',
    parallel: false,
  });
  const performanceCommands = commands.slice(1, 6);
  assert.ok(
    performanceCommands.every(
      (command) => JSON.parse(command.arguments[3]).configuration === 'Release'
    )
  );
  assert.deepEqual(
    performanceCommands.map((command) => JSON.parse(command.arguments[3]).filter),
    [
      'hundredRunLedgerDecodesAndRendersWithinTheNativeGate',
      'largeUnpackProjectionDecodesAndRendersWithinTheNativeGate',
      'largeUsageReportDecodesAndRendersWithinTheNativeGate',
      'hundredRowPerformanceReceiptDecodesAndRendersWithinTheNativeGate',
      'hundredJourneyTestingReceiptDecodesAndRendersWithinTheNativeGate',
    ]
  );
  assert.ok(
    performanceCommands.every(
      (command) => command.environment.CODEVETTER_NATIVE_PERFORMANCE_GATE === '1'
    )
  );
});

test('UI automation fails closed without explicit foreground approval', () => {
  assert.throws(() => parseNativeCheckArguments(['--ui']), /requires the just-in-time flags/);
  assert.throws(() => parseNativeCheckArguments(['--full']), /requires the just-in-time flags/);
  assert.throws(() => parseNativeCheckArguments(['--ui', '--foreground']), /--desktop-idle/);
  assert.throws(() => parseNativeCheckArguments(['--ui', '--desktop-idle']), /--foreground/);
});

test('release automation disables coverage at the workspace command boundary', () => {
  const parsed = parseNativeCheckArguments(['--release']);
  assert.deepEqual(parsed, {
    mode: 'release',
    foregroundApproved: false,
    desktopIdleApproved: false,
  });
  const [command] = nativeCheckCommands(parsed);
  assert.equal(command.backgroundSafe, true);
  assert.deepEqual(command.arguments.slice(0, 3), ['macos', 'build', '--json']);
  const settings = JSON.parse(command.arguments[3]);
  assert.equal(settings.configuration, 'Release');
  assert.equal(settings.arch, 'arm64');
  assert.equal(settings.derivedDataPath, 'artifacts/native-build/DerivedData');
  assert.deepEqual(settings.extraArgs, [
    'ENABLE_CODE_COVERAGE=NO',
    'CLANG_ENABLE_CODE_COVERAGE=NO',
    'CLANG_COVERAGE_MAPPING=NO',
  ]);
});

test('production release builds require exact updater and identity inputs', () => {
  const publicKey = Buffer.alloc(32, 7).toString('base64');
  assert.deepEqual(
    nativeReleaseBuildSettings({
      CODEVETTER_NATIVE_CHANNEL: 'production',
      CODEVETTER_NATIVE_BUNDLE_IDENTIFIER: 'com.codevetter.desktop',
      CODEVETTER_NATIVE_SPARKLE_FEED_URL:
        'https://github.com/Codevetter/codevetter/releases/latest/download/appcast.xml',
      CODEVETTER_NATIVE_SPARKLE_PUBLIC_KEY: publicKey,
    }).slice(-3),
    [
      'PRODUCT_BUNDLE_IDENTIFIER=com.codevetter.desktop',
      'INFOPLIST_KEY_SUFeedURL=https://github.com/Codevetter/codevetter/releases/latest/download/appcast.xml',
      `INFOPLIST_KEY_SUPublicEDKey=${publicKey}`,
    ]
  );
  assert.throws(
    () => nativeReleaseBuildSettings({ CODEVETTER_NATIVE_CHANNEL: 'production' }),
    /com\.codevetter\.desktop/
  );
  assert.throws(
    () =>
      nativeReleaseBuildSettings({
        CODEVETTER_NATIVE_CHANNEL: 'production',
        CODEVETTER_NATIVE_BUNDLE_IDENTIFIER: 'com.codevetter.desktop',
        CODEVETTER_NATIVE_SPARKLE_FEED_URL: 'http://updates.example.test/appcast.xml',
        CODEVETTER_NATIVE_SPARKLE_PUBLIC_KEY: publicKey,
      }),
    /HTTPS Sparkle feed/
  );
});

test('the foreground lane runs only XCUITest interaction targets', () => {
  const parsed = parseNativeCheckArguments(['--ui', '--', '--foreground', '--desktop-idle']);
  const [command] = nativeCheckCommands(parsed);
  assert.equal(command.backgroundSafe, false);
  assert.equal(command.arguments[0], 'macos');
  assert.match(command.arguments.at(-1), /only-testing:CodeVetterUITests/);
});

test('the pnpm argument delimiter does not weaken unknown-argument rejection', () => {
  assert.deepEqual(parseNativeCheckArguments(['--ui', '--', '--foreground', '--desktop-idle']), {
    mode: 'ui',
    foregroundApproved: true,
    desktopIdleApproved: true,
  });
  assert.throws(
    () =>
      parseNativeCheckArguments(['--ui', '--', '--foreground', '--desktop-idle', '--unexpected']),
    /Unknown native-check argument/
  );
});

test('full qualification keeps background checks before the foreground lane', () => {
  const commands = nativeCheckCommands(
    parseNativeCheckArguments(['--full', '--foreground', '--desktop-idle'])
  );
  assert.deepEqual(
    commands.map((command) => command.backgroundSafe),
    [true, true, true, true, true, true, true, false]
  );
});

test('the runner removes package-manager-only config noise from child npx processes', () => {
  const environment = nativeCheckEnvironment(
    {
      PATH: '/usr/bin',
      npm_config_store_dir: '/tmp/pnpm-store',
      NPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: 'true',
      HTTPS_PROXY: 'https://proxy.example.test',
    },
    '/tmp/native-cache'
  );
  assert.deepEqual(environment, {
    PATH: '/usr/bin',
    HTTPS_PROXY: 'https://proxy.example.test',
    npm_config_cache: '/tmp/native-cache',
    npm_config_update_notifier: 'false',
  });
});

test('the reusable cache remains repository-local and outside committed evidence', () => {
  assert.equal(
    nativeCheckCachePath('/fixture/repo'),
    '/fixture/repo/artifacts/native-checks/xcodebuildmcp-npm-cache'
  );
});

test('local checks stay polite while isolated hosted gates retain normal priority', () => {
  const [background] = nativeCheckCommands(parseNativeCheckArguments([]));
  const local = nativeCheckInvocation(background, {});
  assert.equal(local.executable, '/usr/bin/nice');
  assert.deepEqual(local.arguments.slice(0, 5), ['-n', '10', 'npx', '-y', 'xcodebuildmcp@2.7.0']);

  const hosted = nativeCheckInvocation(background, { GITHUB_ACTIONS: 'true' });
  assert.equal(hosted.executable, 'npx');
  assert.deepEqual(hosted.arguments.slice(0, 2), ['-y', 'xcodebuildmcp@2.7.0']);
});
