#!/usr/bin/env node

import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  XCODEBUILDMCP,
  nativeCheckCachePath,
  nativeCheckEnvironment,
} from './run-native-checks.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultOutputRoot = resolve(repositoryRoot, 'artifacts/native-owner-review');
const galleryTemplate = resolve(
  repositoryRoot,
  'evidence/design/native-acceptance-2026-09-01/gallery.html'
);

export const nativeOwnerReviewRenders = Object.freeze([
  ['CODEVETTER_USAGE_SCREENSHOT_PATH', 'usage.png'],
  ['CODEVETTER_UNPACK_SCREENSHOT_PATH', 'repo-unpack.png'],
  ['CODEVETTER_UNPACK_QUERY_DESK_SCREENSHOT_PATH', 'repository-query-desk.png'],
  ['CODEVETTER_UNPACK_QUERY_SCREENSHOT_PATH', 'repository-query-evidence-workbench.png'],
  ['CODEVETTER_REVIEW_FINDINGS_SCREENSHOT_PATH', 'review-findings.png'],
  ['CODEVETTER_REVIEW_FINDINGS_LIGHT_SCREENSHOT_PATH', 'review-findings-light.png'],
  ['CODEVETTER_REVIEW_PROOF_MAP_SCREENSHOT_PATH', 'review-proof-map.png'],
  ['CODEVETTER_REVIEW_INTENT_SCREENSHOT_PATH', 'review-intent.png'],
  ['CODEVETTER_TESTING_SCREENSHOT_PATH', 'testing.png'],
  ['CODEVETTER_TESTING_LIGHT_SCREENSHOT_PATH', 'testing-light.png'],
  ['CODEVETTER_WARM_SCREENSHOT_PATH', 'testing-warm.png'],
  ['CODEVETTER_DIFFERENTIAL_SCREENSHOT_PATH', 'testing-differential.png'],
  ['CODEVETTER_SCENARIO_SCREENSHOT_PATH', 'testing-scenario.png'],
  ['CODEVETTER_WATCHER_SCREENSHOT_PATH', 'testing-watcher.png'],
  ['CODEVETTER_QA_WORKSPACE_SCREENSHOT_PATH', 'qa-journey-workspace.png'],
  ['CODEVETTER_PERFORMANCE_SCREENSHOT_PATH', 'performance.png'],
  ['CODEVETTER_PERFORMANCE_LIGHT_SCREENSHOT_PATH', 'performance-light.png'],
  ['CODEVETTER_RUNS_SCREENSHOT_PATH', 'runs.png'],
  ['CODEVETTER_RUNS_LIGHT_SCREENSHOT_PATH', 'runs-light.png'],
  ['CODEVETTER_CAPABILITIES_SCREENSHOT_PATH', 'capabilities-mcp.png'],
  ['CODEVETTER_SETTINGS_SCREENSHOT_PATH', 'settings.png'],
  ['CODEVETTER_RUBRICS_SCREENSHOT_PATH', 'settings-rubrics.png'],
  ['CODEVETTER_RUBRICS_LIGHT_SCREENSHOT_PATH', 'settings-rubrics-light.png'],
  ['CODEVETTER_HISTORY_ROOTS_SCREENSHOT_PATH', 'settings-history-roots.png'],
  ['CODEVETTER_HISTORY_ROOTS_LIGHT_SCREENSHOT_PATH', 'settings-history-roots-light.png'],
  ['CODEVETTER_MEMORIES_SCREENSHOT_PATH', 'settings-memories.png'],
  ['CODEVETTER_MEMORIES_LIGHT_SCREENSHOT_PATH', 'settings-memories-light.png'],
  ['CODEVETTER_AGENT_ISLAND_SETTINGS_SCREENSHOT_PATH', 'settings-agent-island.png'],
  ['CODEVETTER_AGENT_ISLAND_SETTINGS_LIGHT_SCREENSHOT_PATH', 'settings-agent-island-light.png'],
  ['CODEVETTER_OPS_SETTINGS_SCREENSHOT_PATH', 'settings-ops.png'],
  ['CODEVETTER_OPS_SETTINGS_LIGHT_SCREENSHOT_PATH', 'settings-ops-light.png'],
  ['CODEVETTER_ONBOARDING_SCREENSHOT_PATH', 'onboarding-purpose.png'],
  ['CODEVETTER_ONBOARDING_AGENT_SCREENSHOT_PATH', 'onboarding-agent.png'],
]);

export function ownerReviewEnvironment(outputRoot = defaultOutputRoot) {
  const root = resolve(outputRoot);
  return Object.fromEntries(
    nativeOwnerReviewRenders.map(([environmentKey, path]) => [environmentKey, join(root, path)])
  );
}

export function buildOwnerReviewManifest(entries, renderedAt = new Date()) {
  return {
    schema_version: 'codevetter.native-owner-review/v1',
    rendered_at: renderedAt.toISOString().slice(0, 10),
    surface: 'native macOS Evidence Workbench',
    scale: 'deterministic offscreen pixels',
    owner_acceptance: 'pending',
    entries,
  };
}

export function finalizeOwnerReview(outputRoot = defaultOutputRoot) {
  const root = resolve(outputRoot);
  const entries = nativeOwnerReviewRenders.map(([, path]) => artifact(join(root, path), path));
  const manifest = buildOwnerReviewManifest(entries);
  writeFileSync(join(root, 'owner-review-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  copyFileSync(galleryTemplate, join(root, 'gallery.html'));
  return manifest;
}

export function renderOwnerReview(outputRoot = defaultOutputRoot, spawn = spawnSync) {
  if (process.platform !== 'darwin') {
    throw new Error('Native owner-review rendering requires macOS.');
  }
  const root = resolve(outputRoot);
  mkdirSync(root, { recursive: true });
  const cache = nativeCheckCachePath();
  const result = spawn(
    '/usr/bin/nice',
    [
      '-n',
      '10',
      'npx',
      '-y',
      XCODEBUILDMCP,
      'swift-package',
      'test',
      '--package-path',
      'apps/macos/CodeVetterPackage',
      '--parallel',
      'false',
    ],
    {
      cwd: repositoryRoot,
      env: {
        ...nativeCheckEnvironment(process.env, cache),
        ...ownerReviewEnvironment(root),
      },
      stdio: 'inherit',
    }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Native owner-review rendering exited ${result.status}`);
  return finalizeOwnerReview(root);
}

function artifact(path, name) {
  const contents = readFileSync(path);
  const dimensions = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', path], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const width = dimensions.match(/pixelWidth:\s+(\d+)/)?.[1];
  const height = dimensions.match(/pixelHeight:\s+(\d+)/)?.[1];
  if (!width || !height) throw new Error(`Could not read image dimensions: ${path}`);
  return {
    path: name,
    pixels: `${width}x${height}`,
    sha256: createHash('sha256').update(contents).digest('hex'),
  };
}

function parseArguments(argv) {
  let operation = 'render';
  let outputRoot = defaultOutputRoot;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (['env', 'finalize', 'render'].includes(argument)) operation = argument;
    else if (argument === '--out-root')
      outputRoot = resolve(requiredValue(argv, ++index, argument));
    else if (argument !== '--') throw new Error(`Unknown argument: ${argument}`);
  }
  return { operation, outputRoot };
}

function requiredValue(argv, index, argument) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
  return value;
}

function main() {
  const { operation, outputRoot } = parseArguments(process.argv.slice(2));
  mkdirSync(outputRoot, { recursive: true });
  if (operation === 'env') {
    for (const [key, value] of Object.entries(ownerReviewEnvironment(outputRoot))) {
      process.stdout.write(`${key}=${value}\n`);
    }
  } else if (operation === 'finalize') {
    finalizeOwnerReview(outputRoot);
  } else {
    renderOwnerReview(outputRoot);
  }
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) main();
