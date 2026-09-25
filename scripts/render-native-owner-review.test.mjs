import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildOwnerReviewGallery,
  buildOwnerReviewManifest,
  nativeOwnerReviewRenders,
  ownerReviewEnvironment,
} from './render-native-owner-review.mjs';

test('owner-review render contract contains 35 unique environment and image identities', () => {
  assert.equal(nativeOwnerReviewRenders.length, 35);
  assert.equal(new Set(nativeOwnerReviewRenders.map(([key]) => key)).size, 35);
  assert.equal(new Set(nativeOwnerReviewRenders.map(([, path]) => path)).size, 35);
});

test('owner-review render contract matches the checked manifest identities', () => {
  const manifest = JSON.parse(
    readFileSync('evidence/design/native-acceptance-2026-09-01/owner-review-manifest.json')
  );
  assert.deepEqual(
    nativeOwnerReviewRenders.map(([, path]) => path).toSorted(),
    manifest.entries
      .filter((entry) => entry.path !== 'usage.png')
      .map((entry) => entry.path)
      .toSorted()
  );
});

test('owner-review environment resolves every render under the requested output root', () => {
  const environment = ownerReviewEnvironment('/fixture/review');
  assert.equal(Object.keys(environment).length, 35);
  assert.equal(environment.CODEVETTER_USAGE_SCREENSHOT_PATH, undefined);
  assert.equal(
    environment.CODEVETTER_OPS_SETTINGS_LIGHT_SCREENSHOT_PATH,
    '/fixture/review/settings-ops-light.png'
  );
});

test('owner-review manifest keeps visual acceptance pending', () => {
  const entries = [{ path: 'repo-unpack.png', pixels: '2560x1600', sha256: 'a'.repeat(64) }];
  const manifest = buildOwnerReviewManifest(entries, new Date('2026-09-02T07:00:00Z'));
  assert.equal(manifest.schema_version, 'codevetter.native-owner-review/v1');
  assert.equal(manifest.rendered_at, '2026-09-02');
  assert.equal(manifest.owner_acceptance, 'pending');
  assert.deepEqual(manifest.entries, entries);
});

test('owner-review gallery omits retired cards while retaining every current render', () => {
  const entries = nativeOwnerReviewRenders.map(([, path]) => ({ path }));
  const gallery = buildOwnerReviewGallery(entries);
  assert.doesNotMatch(gallery, /data-render="usage\.png"/);
  assert.equal([...gallery.matchAll(/data-render="/g)].length, entries.length);
  assert.match(gallery, /data-render="repo-unpack\.png"/);
});
