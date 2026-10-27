import assert from 'node:assert/strict';
import test from 'node:test';
import { formatMarkdown } from '../../../scripts/finalize-landing-markdown.mjs';

const options = {
  title: 'Guide',
  description: 'A public guide.',
  canonical: 'https://codevetter.com/docs/guide/',
  resolveLink: (link) => new URL(link, 'https://codevetter.com/docs/guide/').href,
};
test('source formatter resolves prose links, preserves code, and is idempotent', () => {
  const source = '# Guide\n\n[Next](../next/)\n\n```md\n[Example](/literal)\n```\n';
  const first = formatMarkdown(source, options);
  assert.match(first, /\[Next\]\(https:\/\/codevetter.com\/docs\/next\/\)/);
  assert.match(first, /\[Example\]\(\/literal\)/);
  assert.equal(formatMarkdown(first, options), first);
});

test('build catalog excludes noindex pages and fails for an unregistered public route', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { finalizeLandingMarkdown } = await import(
    '../../../scripts/finalize-landing-markdown.mjs'
  );
  const root = mkdtempSync(join(tmpdir(), 'codevetter-markdown-'));
  try {
    mkdirSync(join(root, 'api/md'), { recursive: true });
    writeFileSync(
      join(root, 'api/md/_identity'),
      JSON.stringify({
        name: 'CodeVetter',
        url: 'https://codevetter.com',
        summary: 'Public evidence.',
      })
    );
    writeFileSync(
      join(root, 'api/md/_catalog'),
      JSON.stringify([
        { path: '/', url: 'https://codevetter.com/', md: 'https://codevetter.com/index.md' },
        {
          path: '/hidden',
          url: 'https://codevetter.com/hidden',
          md: 'https://codevetter.com/hidden.md',
        },
      ])
    );
    writeFileSync(
      join(root, 'index.html'),
      `<head><link rel="canonical" href="https://codevetter.com/"><meta name="description" content="CodeVetter's public evidence."><link href="/" rel="alternate" type="text/markdown"></head><main>Unchanged</main>`
    );
    writeFileSync(join(root, 'index.md'), '# CodeVetter\n\nPublic evidence.\n');
    writeFileSync(
      join(root, 'hidden.html'),
      '<head><meta name="robots" content="noindex"><link rel="canonical" href="https://codevetter.com/hidden"></head>'
    );
    writeFileSync(join(root, 'hidden.md'), '# Hidden\n');
    await finalizeLandingMarkdown(root);
    const catalog = JSON.parse(readFileSync(join(root, 'api/md/_catalog')));
    assert.deepEqual(
      catalog.map((route) => route.path),
      ['/']
    );
    assert.match(readFileSync(join(root, 'index.md'), 'utf8'), /> CodeVetter's public evidence\./);
    assert.match(readFileSync(join(root, 'index.html'), 'utf8'), /<main>Unchanged<\/main>/);
    assert.match(
      readFileSync(join(root, 'index.html'), 'utf8'),
      /href="https:\/\/codevetter.com\/index.md"/
    );
    writeFileSync(
      join(root, 'missing.html'),
      '<head><link rel="canonical" href="https://codevetter.com/missing"></head>'
    );
    await assert.rejects(finalizeLandingMarkdown(root), /Missing public Markdown renderer/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
