import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const appRoot = new URL('../', import.meta.url);

test('benchmark entry points declare the catalog CTA event', async () => {
  const files = [
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

for (const [page, event] of [
  ['/benchmark', 'benchmark_opened'],
  ['/articles/react-hydration-hidden-root-regression', 'verification_proof_opened'],
  ['/articles/react-hydration-hidden-root-regression', 'verification_recipe_opened'],
  ['/articles/react-hydration-hidden-root-regression', 'verification_install_opened'],
])
  test(`the browser logger attributes ${event} to ${page}`, async () => {
    const listeners = new Map();
    const requests = [];
    const tracked = [];
    const document = {
      visibilityState: 'visible',
      addEventListener: (name, callback) => listeners.set(name, callback),
    };
    const window = { addEventListener() {}, appHealth: { track: (event) => tracked.push(event) } };
    const context = {
      document,
      window,
      navigator: {},
      crypto: { randomUUID: () => 'test-id' },
      Blob,
      location: { pathname: page },
      fetch: async (url, options) => requests.push({ url, options }),
    };
    const logger = await readFile(new URL('../public/app-health-log.js', import.meta.url), 'utf8');
    vm.runInNewContext(logger, context);

    listeners.get('click')({
      target: {
        closest: () => ({
          getAttribute: () => event,
          textContent: 'Inspect published benchmark evidence',
        }),
      },
    });
    await Promise.resolve();

    assert.equal(requests.length, 1);
    const payload = JSON.parse(requests[0].options.body);
    assert.equal(payload.logs[0].event, event);
    assert.equal(payload.logs[0].props.page, page);
    assert.deepEqual(tracked, [event]);
  });

test('newsletter markup and hosted loader require an explicit project key', async () => {
  const footer = await readFile(new URL('../src/components/Footer.astro', import.meta.url), 'utf8');
  const layout = await readFile(new URL('../src/layouts/Layout.astro', import.meta.url), 'utf8');

  assert.match(footer, /import\.meta\.env\.PUBLIC_SAASMAKER_NEWSLETTER_KEY\?\.trim\(\)/u);
  assert.match(footer, /\{newsletterProjectKey && \(/u);
  assert.match(footer, /project-key=\{newsletterProjectKey\}/u);
  assert.match(footer, /kind="newsletter"\s+layout="compact"\s+integrated\s+privacy-url=/u);
  assert.match(layout, /\{newsletterProjectKey && \(/u);
  assert.match(layout, /https:\/\/sassmaker\.com\/newsletter-capture\.js\?v=precise-b0adaa67/u);
  assert.doesNotMatch(`${footer}\n${layout}`, /pk_(?:example|test)/u);
});
