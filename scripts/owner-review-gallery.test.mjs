import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const reviewRoot = resolve('evidence/design/native-acceptance-2026-09-01');

test('owner-review gallery contains every exact manifest render once', () => {
  const manifest = JSON.parse(readFileSync(resolve(reviewRoot, 'owner-review-manifest.json')));
  const gallery = readFileSync(resolve(reviewRoot, 'gallery.html'), 'utf8');
  const galleryPaths = [...gallery.matchAll(/data-render="([^"]+)"/g)].map((match) => match[1]);
  const manifestPaths = manifest.entries.map((entry) => entry.path);

  assert.equal(new Set(galleryPaths).size, galleryPaths.length);
  assert.deepEqual(galleryPaths.toSorted(), manifestPaths.toSorted());
  for (const path of manifestPaths) {
    assert.match(gallery, new RegExp(`href="${path}"`));
    assert.match(gallery, new RegExp(`src="${path}"`));
  }
  assert.doesNotMatch(gallery, /https?:\/\//);
});
