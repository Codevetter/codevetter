import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const appRoot = new URL('../', import.meta.url);

test('benchmark entry points declare the catalog CTA event', async () => {
  const files = [
    'src/components/Hero.astro',
    'src/components/Footer.astro',
    'src/pages/xray/index.astro',
    'src/pages/about.astro',
    'src/pages/download.astro',
    'src/pages/benchmark/optimization.astro',
  ];

  for (const file of files) {
    const source = await readFile(new URL(file, appRoot), 'utf8');
    assert.match(source, /href="\/benchmark"[^>]*data-log="benchmark_opened"/u, file);
  }
});

test('the browser logger sends the selected data-log event', async () => {
  const listeners = new Map();
  const requests = [];
  const document = {
    visibilityState: 'visible',
    addEventListener: (name, callback) => listeners.set(name, callback),
  };
  const window = { addEventListener() {} };
  const context = {
    document,
    window,
    navigator: {},
    crypto: { randomUUID: () => 'test-id' },
    Blob,
    location: { pathname: '/benchmark' },
    fetch: async (url, options) => requests.push({ url, options }),
  };
  const logger = await readFile(new URL('../public/app-health-log.js', import.meta.url), 'utf8');
  vm.runInNewContext(logger, context);

  listeners.get('click')({
    target: {
      closest: () => ({
        getAttribute: () => 'benchmark_opened',
        textContent: 'Inspect published benchmark evidence',
      }),
    },
  });
  await Promise.resolve();

  assert.equal(requests.length, 1);
  const payload = JSON.parse(requests[0].options.body);
  assert.equal(payload.logs[0].event, 'benchmark_opened');
  assert.equal(payload.logs[0].props.page, '/benchmark');
});
