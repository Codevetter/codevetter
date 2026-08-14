import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { inspectExistingViteArtifact } from './vite-artifact.mjs';

test('reads one bounded existing Vite initial JavaScript closure', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-vite-artifact-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'dist/assets'), { recursive: true });
  await writeFile(
    join(root, 'dist/index.html'),
    '<script type="module" src="/assets/main.js"></script>\n'
  );
  await writeFile(join(root, 'dist/assets/main.js'), 'import{value}from"./shared.js";value();\n');
  await writeFile(join(root, 'dist/assets/shared.js'), 'export const value=()=>42;\n');

  const artifact = await inspectExistingViteArtifact(root, 'dist');

  assert.equal(artifact.complete, true);
  assert.deepEqual(
    artifact.files.map((entry) => entry.file),
    ['index.html', 'assets/main.js', 'assets/shared.js']
  );
  assert.ok(artifact.raw_bytes > 0);
  assert.ok(artifact.gzip_bytes > 0);
  assert.equal(artifact.provenance, 'existing_unverified_vite_artifact');
});

test('marks dynamic or escaping artifact edges incomplete', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-vite-incomplete-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'dist'), { recursive: true });
  await writeFile(join(root, 'dist/index.html'), '<script type="module" src="./main.js"></script>');
  await writeFile(join(root, 'dist/main.js'), 'import("./later.js"); import "../escape.js";');
  await writeFile(join(root, 'escape.js'), 'export {};');

  const artifact = await inspectExistingViteArtifact(root, 'dist');

  assert.equal(artifact.complete, false);
  assert.ok(artifact.limitations.some((entry) => entry.includes('Dynamic imports')));
  assert.ok(artifact.limitations.some((entry) => entry.includes('escapes the build directory')));
});
