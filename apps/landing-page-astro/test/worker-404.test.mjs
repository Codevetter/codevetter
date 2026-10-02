import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../worker.mjs';

test('HTML misses return the branded 404 asset with status 404', async () => {
  const assets = {
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === '/404') {
        return new Response('<main>This path ends here</main>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }
      if (path === '/') {
        return new Response('<main>Home</main>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }
      return new Response(null, { status: 404 });
    },
  };

  const response = await worker.fetch(new Request('https://codevetter.com/missing'), {
    ASSETS: assets,
  });

  assert.equal(response.status, 404);
  assert.match(response.headers.get('content-type') || '', /text\/html/u);
  assert.match(await response.text(), /This path ends here/u);
});

test('HEAD misses retain the branded 404 status without a response body', async () => {
  const assets = {
    async fetch(request) {
      if (new URL(request.url).pathname === '/404') {
        return new Response(null, { status: 200, headers: { 'content-type': 'text/html' } });
      }
      return new Response(null, { status: 404 });
    },
  };

  const response = await worker.fetch(
    new Request('https://codevetter.com/missing', { method: 'HEAD' }),
    {
      ASSETS: assets,
    }
  );

  assert.equal(response.status, 404);
  assert.equal(await response.text(), '');
});

test('markdown clients retain the machine-readable 404 response', async () => {
  const assets = {
    async fetch() {
      return new Response(null, { status: 404 });
    },
  };

  const response = await worker.fetch(
    new Request('https://codevetter.com/missing', { headers: { accept: 'text/markdown' } }),
    { ASSETS: assets }
  );

  assert.equal(response.status, 404);
  assert.match(response.headers.get('content-type') || '', /text\/markdown/u);
  assert.match(await response.text(), /Where to look next/u);
});
