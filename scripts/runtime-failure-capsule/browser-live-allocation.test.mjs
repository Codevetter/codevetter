import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { normalizeBrowserLiveAllocationProfile } from './browser-live-allocation.mjs';

test('normalizes bounded sampled-live browser allocations to repository sources', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-browser-live-allocation-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'src'));
  await mkdir(join(root, 'e2e'));
  await writeFile(join(root, 'src/App.tsx'), 'export function renderRows() {}\n');
  await writeFile(join(root, 'e2e/flow.spec.ts'), 'export const fixture = true;\n');

  const profile = {
    head: node('', '', 0, [
      node('renderRows', 'http://127.0.0.1:5173/src/App.tsx?token=secret', 0, [
        node('', 'http://127.0.0.1:5173/src/App.tsx?token=secret', 200_000),
      ]),
      node('fixture', 'http://localhost:5173/e2e/flow.spec.ts', 500_000),
      node('dependency', 'https://example.com/dependency.js?credential=secret', 900_000),
    ]),
    samples: [],
  };

  const result = normalizeBrowserLiveAllocationProfile(profile, root);

  assert.equal(result.sampled_live_bytes, 1_600_000);
  assert.equal(result.application_sampled_live_bytes, 200_000);
  assert.deepEqual(
    result.hotspots.map((hotspot) => ({
      function: hotspot.function,
      file: hotspot.file,
      role: hotspot.role,
      bytes: hotspot.sampled_live_bytes,
    })),
    [
      {
        function: 'fixture',
        file: 'e2e/flow.spec.ts',
        role: 'test_or_harness',
        bytes: 500_000,
      },
      {
        function: 'renderRows',
        file: 'src/App.tsx',
        role: 'application',
        bytes: 200_000,
      },
    ]
  );
  assert.equal(JSON.stringify(result).includes('token'), false);
  assert.equal(JSON.stringify(result).includes('example.com'), false);
});

test('rejects a malformed browser sampling profile', () => {
  assert.throws(
    () => normalizeBrowserLiveAllocationProfile({ head: {} }, process.cwd()),
    /malformed/
  );
});

let nextNodeId = 1;

function node(functionName, url, selfSize, children = []) {
  return {
    callFrame: { functionName, url, lineNumber: 0, columnNumber: 0, scriptId: '1' },
    selfSize,
    id: nextNodeId++,
    children,
  };
}
