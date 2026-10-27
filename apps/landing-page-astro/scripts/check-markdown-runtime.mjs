import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import worker from '../worker.mjs';

const runtimeOrigin = /^https?:\/\//.test(process.argv[2] || '') ? process.argv[2] : null;
const dist = resolve(import.meta.dirname, '..', runtimeOrigin ? 'dist' : process.argv[2] || 'dist');
const base = runtimeOrigin || 'https://codevetter.com';
const assets = {
  async fetch(request) {
    const url = new URL(request.url);
    const raw = resolve(dist, `.${url.pathname}`);
    const file = [raw, raw + '.html', resolve(raw, 'index.html')].find(
      (candidate) => existsSync(candidate) && statSync(candidate).isFile()
    );
    if (!file) return new Response('Not found', { status: 404 });
    const type = file.endsWith('.md')
      ? 'text/markdown'
      : file.endsWith('.html')
        ? 'text/html'
        : file.includes('/api/')
          ? 'application/json'
          : 'text/plain';
    return new Response(request.method === 'HEAD' ? null : readFileSync(file), {
      headers: { 'content-type': type },
    });
  },
};
const request = (path, init) =>
  runtimeOrigin
    ? fetch(base + path, { redirect: 'manual', ...init })
    : worker.fetch(new Request(base + path, init), { ASSETS: assets });
const catalog = await (await request('/api/md/_catalog')).json();
const sample = [
  '/',
  '/about',
  '/privacy',
  ...['/unpack/', '/articles/', '/inspiration/', '/xray/', '/docs/', '/docs/architecture/']
    .map((prefix) => catalog.find((route) => route.path.startsWith(prefix))?.path)
    .filter(Boolean),
];
for (const path of sample) {
  const route = catalog.find((entry) => entry.path === path);
  const suffix = new URL(route.md).pathname;
  const responses = await Promise.all([
    request(suffix),
    request('/api/md' + path),
    request(path, { headers: { Accept: 'text/markdown' } }),
  ]);
  const bodies = [];
  for (const response of responses) {
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type'), /text\/markdown/);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, follow');
    const location = response.headers.get('content-location');
    const localRewrite =
      runtimeOrigin && ['localhost', '127.0.0.1'].includes(new URL(runtimeOrigin).hostname)
        ? new URL(new URL(route.url).pathname, runtimeOrigin).href
        : route.url;
    assert.ok(
      location === route.url || location === localRewrite,
      `${path}: canonical location ${location}`
    );
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.ok(Number(response.headers.get('x-markdown-tokens')) > 0);
    bodies.push(await response.text());
  }
  assert.equal(new Set(bodies).size, 1, path);
  assert.match(bodies[0], /^# /);
  assert.ok(bodies[0].includes(`Canonical: ${route.url}`), path);
  const head = await request(suffix, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(
    head.headers.get('x-markdown-tokens'),
    responses[0].headers.get('x-markdown-tokens')
  );
}
for (const accept of [
  undefined,
  '*/*',
  'text/markdown;q=0',
  'text/markdown;q=0.5,text/html;q=0.8',
  'text/markdown,text/html',
]) {
  const response = await request('/', { headers: accept ? { Accept: accept } : {} });
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.match(response.headers.get('link'), /llms-full.txt.*describedby/);
}
for (const path of [
  '/missing.md',
  '/api/md/admin',
  '/api/md/dashboard',
  '/api/md/does-not-exist',
]) {
  const response = await request(path);
  assert.equal(response.status, 404, path);
  assert.match(response.headers.get('content-type'), /text\/markdown/);
}
const options = await request('/api/md/', { method: 'OPTIONS' });
assert.equal(options.status, 204);
assert.equal(await options.text(), '');
const policy = await (await request('/ai.txt')).text();
assert.match(policy, /training: allowed on public pages only/);
const full = await (await request('/llms-full.txt')).text();
assert.ok(full.length < 500000);
console.log(
  JSON.stringify(
    {
      runtime: runtimeOrigin || 'Worker with built asset binding',
      registeredRoutes: catalog.length,
      sampledRoutes: sample,
      fullExportCharacters: full.length,
      protocolChecks: 'passed',
    },
    null,
    2
  )
);
