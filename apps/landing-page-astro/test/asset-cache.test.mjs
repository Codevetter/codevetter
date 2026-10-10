import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import worker from '../worker.mjs';

test('hashed Astro assets retain the immutable cache policy through the Worker', async () => {
  const rules = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
  const policy = rules.match(/^\/_astro\/\*\n\s+Cache-Control: (.+)$/m)?.[1];
  assert.equal(policy, 'public, max-age=31536000, immutable');

  for (const method of ['GET', 'HEAD']) {
    for (const accept of ['text/css,*/*;q=0.1', 'text/markdown']) {
      const request = new Request('https://codevetter.com/_astro/Layout.Bx7pQ9a2.css', {
        method,
        headers: { accept },
      });
      let calls = 0;
      const response = await worker.fetch(request, {
        ASSETS: {
          async fetch(assetRequest) {
            calls += 1;
            assert.equal(assetRequest.url, request.url);
            assert.equal(assetRequest.method, method);
            return new Response(method === 'HEAD' ? null : 'body{color:white}', {
              headers: { 'content-type': 'text/css', 'cache-control': policy },
            });
          },
        },
      });

      assert.equal(calls, 1);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), policy);
      assert.equal(response.headers.get('content-type'), 'text/css');
      assert.equal(await response.text(), method === 'HEAD' ? '' : 'body{color:white}');
    }
  }
});
