import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  attributeBrowserLoadingSources,
  createBrowserLoadingSummary,
  normalizeBrowserResourceSize,
} from './browser-loading.mjs';

test('normalizes bounded Playwright HAR sizes without converting missing values to zero', () => {
  assert.deepEqual(
    normalizeBrowserResourceSize({
      _resourceType: 'Script',
      response: {
        _transferSize: 1_024,
        bodySize: 900,
        content: { size: 1_200, mimeType: 'application/javascript; charset=utf-8' },
      },
      timings: { wait: 2.3456, receive: 1.2345 },
    }),
    {
      resource_type: 'script',
      mime_category: 'script',
      transfer_bytes: 1_024,
      encoded_body_bytes: 900,
      decoded_body_bytes: 1_200,
      wait_ms: 2.346,
      receive_ms: 1.235,
    }
  );
  assert.equal(
    normalizeBrowserResourceSize({ response: { _transferSize: -1 } }).transfer_bytes,
    null
  );
  assert.equal(
    normalizeBrowserResourceSize({ response: { _transferSize: 2 ** 40 } }).transfer_bytes,
    null
  );
});

test('attributes only exact contained local development-server module routes', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-browser-loading-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src/main.tsx'), 'export const Main = () => null;\n');

  const attributed = await attributeBrowserLoadingSources(root, [
    resource('/src/main.tsx', 1_000),
    resource('/node_modules/react.js', 2_000),
    resource('/_next/static/chunks/app.js', 3_000),
    resource('/../outside.ts', 4_000),
    resource('/src/main.tsx', 5_000, { network_scope: 'remote' }),
  ]);

  assert.deepEqual(attributed[0].attributes.source, {
    file: 'src/main.tsx',
    line: 1,
    function: null,
    provenance: 'exact_local_module_route',
  });
  assert.equal(attributed[1].attributes.source, null);
  assert.equal(attributed[2].attributes.source, null);
  assert.equal(attributed[3].attributes.source, null);
  assert.equal(attributed[4].attributes.source, null);
  const summary = createBrowserLoadingSummary(attributed, {
    traceResourceCount: attributed.length,
    samplingApplied: false,
  });
  assert.equal(summary.repository_modules.count, 1);
  assert.equal(summary.repository_modules.observed_transfer_bytes, 1_000);
  assert.equal(summary.repository_modules.largest[0].source.file, 'src/main.tsx');
});

test('publishes a complete total only for a full inventory with every transfer size', () => {
  const resources = [
    resource('/src/small.ts', 10_000, { resource_type: 'script', duration_ms: 4 }),
    resource('/src/large.ts', 90_000, { resource_type: 'script', duration_ms: 2 }),
    resource('/hero.png', 50_000, { resource_type: 'image', duration_ms: 8 }),
  ];
  const complete = createBrowserLoadingSummary(resources, {
    traceResourceCount: 3,
    samplingApplied: false,
  });

  assert.equal(complete.inventory.complete, true);
  assert.equal(complete.complete_transfer_bytes, 150_000);
  assert.equal(complete.completed_responses.complete, true);
  assert.equal(complete.completed_responses.complete_transfer_bytes, 150_000);
  assert.equal(complete.largest_resources[0].route, '/src/large.ts');
  assert.deepEqual(
    complete.categories.map((category) => [
      category.resource_type,
      category.observed_transfer_bytes,
    ]),
    [
      ['script', 100_000],
      ['image', 50_000],
    ]
  );

  const missingSize = resource('/src/missing.ts', null);
  const partial = createBrowserLoadingSummary([...resources, missingSize], {
    traceResourceCount: 4,
    samplingApplied: false,
  });
  assert.equal(partial.inventory.complete, false);
  assert.equal(partial.complete_transfer_bytes, null);
  assert.equal(partial.completed_responses.complete, false);
  assert.equal(partial.observed_transfer_bytes, 150_000);

  const sampled = createBrowserLoadingSummary(resources, {
    traceResourceCount: 10,
    samplingApplied: true,
  });
  assert.equal(sampled.inventory.complete, false);
  assert.equal(sampled.complete_transfer_bytes, null);
  assert.equal(sampled.completed_responses.complete, false);

  const empty = createBrowserLoadingSummary([], {
    traceResourceCount: 0,
    samplingApplied: false,
  });
  assert.equal(empty.state, 'unavailable');
  assert.equal(empty.inventory.complete, false);
});

function resource(
  route,
  transferBytes,
  { network_scope = 'loopback', resource_type = 'script', duration_ms = 1 } = {}
) {
  return {
    kind: 'http_client',
    started_at_ms: 1,
    duration_ms,
    attributes: {
      route,
      network_scope,
      resource_type,
      mime_category: resource_type === 'image' ? 'image' : 'script',
      transfer_bytes: transferBytes,
      encoded_body_bytes: transferBytes,
      decoded_body_bytes: transferBytes,
      status: 200,
      request_identity_sha256: 'a'.repeat(64),
      source: null,
    },
    limitations: [],
  };
}
