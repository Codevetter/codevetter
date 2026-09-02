import assert from 'node:assert/strict';
import test from 'node:test';

import {
  nativeCheckCommands,
  nativeCheckCachePath,
  nativeCheckEnvironment,
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
  assert.equal(commands.length, 2);
  assert.ok(commands.every((command) => command.backgroundSafe));
  assert.ok(
    commands.every(
      (command) => !command.arguments.includes('test') || command.arguments[0] === 'swift-package'
    )
  );
  assert.deepEqual(commands[0].arguments.slice(-2), ['--parallel', 'false']);
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

test('the foreground lane runs only XCUITest interaction targets', () => {
  const parsed = parseNativeCheckArguments(['--ui', '--foreground', '--desktop-idle']);
  const [command] = nativeCheckCommands(parsed);
  assert.equal(command.backgroundSafe, false);
  assert.equal(command.arguments[0], 'macos');
  assert.match(command.arguments.at(-1), /only-testing:CodeVetterUITests/);
});

test('full qualification keeps background checks before the foreground lane', () => {
  const commands = nativeCheckCommands(
    parseNativeCheckArguments(['--full', '--foreground', '--desktop-idle'])
  );
  assert.deepEqual(
    commands.map((command) => command.backgroundSafe),
    [true, true, false]
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
