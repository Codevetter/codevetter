import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const layout = await readFile(
  new URL('../apps/landing-page-astro/src/layouts/Layout.astro', import.meta.url),
  'utf8'
);
const logger = await readFile(
  new URL('../apps/landing-page-astro/public/app-health-log.js', import.meta.url),
  'utf8'
);
const publicKey = 'ahk_pub_43b8473a6373800b1c7fac50ccac5c3d5ab760ea53b4f80e65dd981871bfae3f';

test('the landing page uses one origin-bound App Health project', () => {
  assert.equal((layout.match(/health\.sassmaker\.com\/tracker\.js/g) ?? []).length, 1);
  assert.match(layout, new RegExp(`data-key="${publicKey}"`));
  assert.match(layout, /data-project="app-963a6a0e-a082-4f60-a87a-b1b457bfc49a"/);
  assert.match(layout, /data-endpoint="https:\/\/ingest\.sassmaker\.com\/v1\/browser"/);
  assert.match(logger, new RegExp(publicKey));
});
