#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isMainModule, parsePathArguments, readJSON, readPlist } from './native-script-utils.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const productionBundleIdentifier = 'com.codevetter.desktop';
const qualificationSchema = 'codevetter.native-package-qualification/v1';
const notarizationSchema = 'codevetter.native-notarization-proof/v1';
const installedUpgradeSchema = 'codevetter.native-installed-upgrade-proof/v1';
const dataContinuitySchema = 'codevetter.native-data-continuity/v1';
const appcastSchema = 'codevetter.native-appcast-qualification/v1';
const productionAppDataIdentity = 'com.codevetter.desktop';

export function parseArguments(argv) {
  return parsePathArguments(argv, {
    paths: {
      '--app': 'app',
      '--qualification': 'qualification',
      '--notarization-proof': 'notarizationProof',
      '--installed-proof': 'installedProof',
      '--appcast-proof': 'appcastProof',
      '--out': 'out',
    },
    required: ['--app', '--qualification'],
  });
}

export function evaluateNativeReleaseReadiness(input) {
  const qualification = input.qualification;
  const app = qualification.application ?? {};
  const archives = qualification.archives ?? [];
  const notarization = input.notarizationProof;
  const installed = input.installedProof;
  const appcastProof = input.appcastProof;
  const archiveHashes = new Set(archives.map((archive) => archive.sha256));
  const appVersion = input.info.CFBundleShortVersionString;
  const appBuild = input.info.CFBundleVersion;
  const requiredCompanions = ['ccusage', 'codevetter', 'codevetter-mcp'];
  const packagedCompanions = (qualification.sidecars ?? []).map((sidecar) => sidecar.name).sort();
  const teamIdentifiers = [input.signature, ...input.companionSignatures]
    .map((signature) => signature.teamIdentifier)
    .filter(Boolean);
  const consistentDeveloperTeam =
    teamIdentifiers.length === input.companionSignatures.length + 1 &&
    new Set(teamIdentifiers).size === 1 &&
    input.signature.developerID === true &&
    input.companionSignatures.every((signature) => signature.developerID === true);

  const checks = [
    check(
      'qualification',
      qualification.schema_version === qualificationSchema &&
        qualification.status === 'local_package_qualified' &&
        app.path === input.appPath
    ),
    check('deep_signature', input.deepSignatureValid),
    check('production_bundle', input.info.CFBundleIdentifier === productionBundleIdentifier),
    check('host_executable', input.info.CFBundleExecutable === 'CodeVetterNative'),
    check('version_identity', app.version === appVersion && app.build === appBuild),
    check('packaged_companions', arraysEqual(packagedCompanions, requiredCompanions)),
    check('hardened_runtime', input.signature.hardenedRuntime),
    check('developer_id_signature', input.signature.developerID),
    check('consistent_developer_team', consistentDeveloperTeam),
    check(
      'library_validation',
      input.entitlements['com.apple.security.cs.disable-library-validation'] !== true
    ),
    check('execution_authority', input.entitlements['com.apple.security.app-sandbox'] !== true),
    check('https_appcast', secureURL(input.info.SUFeedURL)),
    check('sparkle_public_key', validSparklePublicKey(input.info.SUPublicEDKey)),
    check(
      'sparkle_appcast',
      validAppcastProof(appcastProof, {
        feedURL: input.info.SUFeedURL,
        appVersion,
        appBuild,
        archiveHashes,
      })
    ),
    check('gatekeeper', input.gatekeeper.accepted),
    check(
      'notarization',
      notarization?.schema_version === notarizationSchema &&
        notarization.status === 'accepted' &&
        notarization.stapled === true &&
        archiveHashes.has(notarization.archive_sha256)
    ),
    check(
      'installed_upgrade',
      validInstalledUpgradeProof(installed, {
        appVersion,
        appBuild,
        archiveHashes,
      })
    ),
  ];
  const blockers = checks.filter((item) => !item.passed).map((item) => blockerFor(item.id));
  return {
    schema_version: 'codevetter.native-release-readiness/v1',
    authority: 'read_only_inspection',
    recorded_at: input.recordedAt ?? new Date().toISOString(),
    status: blockers.length === 0 ? 'ready' : 'blocked',
    shipping_ready: blockers.length === 0,
    application: {
      path: input.appPath,
      bundle_identifier: input.info.CFBundleIdentifier ?? null,
      version: appVersion ?? null,
      build: appBuild ?? null,
      executable: input.info.CFBundleExecutable ?? null,
      signing: input.signature.kind,
      team_identifier: input.signature.teamIdentifier ?? null,
    },
    updater: {
      feed_url: input.info.SUFeedURL ?? null,
      public_key_configured: validSparklePublicKey(input.info.SUPublicEDKey),
    },
    checks,
    gatekeeper: input.gatekeeper,
    blockers,
    limitations: [
      'This receipt only inspects supplied local artifacts and proof files.',
      'It never signs, notarizes, installs, publishes, enumerates identities, or reads credentials.',
    ],
  };
}

function validAppcastProof(proof, { feedURL, appVersion, appBuild, archiveHashes }) {
  return (
    proof?.schema_version === appcastSchema &&
    proof.status === 'qualified' &&
    proof.qualified === true &&
    proof.feed_url === feedURL &&
    proof.application?.bundle_identifier === productionBundleIdentifier &&
    proof.application?.version === appVersion &&
    proof.application?.build === appBuild &&
    archiveHashes.has(proof.archive?.sha256) &&
    proof.checks?.every((item) => item.passed === true)
  );
}

function validInstalledUpgradeProof(installed, { appVersion, appBuild, archiveHashes }) {
  const continuity = installed?.data_continuity;
  const before = continuity?.before_sha256;
  return (
    installed?.schema_version === installedUpgradeSchema &&
    installed.status === 'passed' &&
    installed.bundle_identifier === productionBundleIdentifier &&
    installed.version === appVersion &&
    installed.build === appBuild &&
    archiveHashes.has(installed.archive_sha256) &&
    installed.upgrade === true &&
    installed.relaunch === true &&
    installed.rollback === true &&
    continuity?.schema_version === dataContinuitySchema &&
    continuity.app_data_identity === productionAppDataIdentity &&
    continuity.database_filename === 'codevetter.db' &&
    Number.isSafeInteger(continuity.preserved_record_count) &&
    continuity.preserved_record_count > 0 &&
    canonicalSHA256(before) &&
    continuity.after_upgrade_sha256 === before &&
    continuity.after_rollback_sha256 === before
  );
}

export function inspectNativeReleaseReadiness(options = parseArguments(process.argv.slice(2))) {
  const appPath = realpathSync(options.app);
  const qualification = readJSON(options.qualification);
  const info = readPlist(join(appPath, 'Contents/Info.plist'), repositoryRoot);
  const signature = inspectSignature(appPath);
  const companionSignatures = (qualification.sidecars ?? []).map((sidecar) =>
    inspectSignature(join(appPath, 'Contents/MacOS', sidecar.name))
  );
  const receipt = evaluateNativeReleaseReadiness({
    appPath,
    qualification,
    info,
    signature,
    companionSignatures,
    entitlements: readEntitlements(appPath),
    deepSignatureValid: verifyDeepSignature(appPath),
    gatekeeper: inspectGatekeeper(appPath),
    notarizationProof: options.notarizationProof ? readJSON(options.notarizationProof) : null,
    installedProof: options.installedProof ? readJSON(options.installedProof) : null,
    appcastProof: options.appcastProof ? readJSON(options.appcastProof) : null,
  });
  const output = `${JSON.stringify(receipt, null, 2)}\n`;
  if (options.out) writeFileSync(options.out, output);
  process.stdout.write(output);
  return receipt;
}

function inspectSignature(path) {
  const result = spawnSync('codesign', ['-d', '--verbose=4', path], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const teamIdentifier = valueFor(output, 'TeamIdentifier');
  const authorities = output
    .split('\n')
    .filter((line) => line.startsWith('Authority='))
    .map((line) => line.slice('Authority='.length));
  const developerID = authorities.some((authority) =>
    authority.startsWith('Developer ID Application:')
  );
  return {
    valid: result.status === 0,
    kind: output.includes('Signature=adhoc') ? 'ad_hoc' : developerID ? 'developer_id' : 'other',
    developerID,
    hardenedRuntime: output.includes('(adhoc,runtime)') || output.includes('(runtime)'),
    teamIdentifier: teamIdentifier === 'not set' ? null : teamIdentifier,
  };
}

function readEntitlements(appPath) {
  try {
    const plist = execFileSync('codesign', ['-d', '--entitlements', ':-', appPath], {
      cwd: repositoryRoot,
      encoding: null,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(
      execFileSync('plutil', ['-convert', 'json', '-o', '-', '-'], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        input: plist,
      })
    );
  } catch {
    return {};
  }
}

function verifyDeepSignature(appPath) {
  return (
    spawnSync('codesign', ['--verify', '--deep', '--strict', appPath], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    }).status === 0
  );
}

function inspectGatekeeper(appPath) {
  const result = spawnSync('spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  const detail = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  return { accepted: result.status === 0, detail: detail.slice(0, 500) };
}

function check(id, passed) {
  return { id, passed: passed === true };
}

function blockerFor(id) {
  const messages = {
    qualification: 'The package has not passed the local package qualifier.',
    deep_signature: 'The staged application fails deep strict code-signature verification.',
    production_bundle: 'The production bundle identifier has not transferred to the native app.',
    host_executable: 'The native host executable collides with or differs from CodeVetterNative.',
    version_identity: 'The app and package qualification version/build identities differ.',
    packaged_companions:
      'The package does not contain exactly codevetter, codevetter-mcp, and ccusage.',
    hardened_runtime: 'Hardened Runtime is not enabled in the staged application signature.',
    developer_id_signature: 'The application is not signed by a Developer ID Application identity.',
    consistent_developer_team:
      'The host and packaged companions do not share one Developer ID team.',
    library_validation: 'Library Validation is disabled in the staged application.',
    execution_authority:
      'App Sandbox is enabled and would remove required local execution authority.',
    https_appcast: 'A production HTTPS Sparkle appcast is not configured.',
    sparkle_public_key: 'A production Sparkle EdDSA public key is not configured.',
    sparkle_appcast:
      'No offline-verified Sparkle appcast binds the production feed, key, version, and exact archive.',
    gatekeeper: 'Gatekeeper does not accept the staged application.',
    notarization: 'No archive-bound accepted and stapled notarization proof was supplied.',
    installed_upgrade:
      'No archive-bound production-identity upgrade, relaunch, stable-data continuity, and rollback proof was supplied.',
  };
  return messages[id];
}

function canonicalSHA256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function secureURL(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function validSparklePublicKey(value) {
  if (typeof value !== 'string') return false;
  const encoded = value.trim();
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encoded)) return false;
  try {
    const decoded = Buffer.from(encoded, 'base64');
    return decoded.length === 32 && decoded.toString('base64') === encoded;
  } catch {
    return false;
  }
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function valueFor(output, key) {
  return output
    .split('\n')
    .find((line) => line.startsWith(`${key}=`))
    ?.slice(key.length + 1);
}

if (isMainModule(import.meta.url)) inspectNativeReleaseReadiness();
