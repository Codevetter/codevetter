import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { finalizeLandingMarkdown } from './finalize-landing-markdown.mjs';

test('metadata entities are decoded once in Markdown and re-escaped in HTML', async () => {
  const dist = mkdtempSync(join(tmpdir(), 'codevetter-markdown-'));
  try {
    mkdirSync(join(dist, 'api/md'), { recursive: true });
    writeFileSync(
      join(dist, 'api/md/_identity'),
      JSON.stringify({ name: 'CodeVetter', url: 'https://codevetter.com', summary: 'Test' })
    );
    writeFileSync(
      join(dist, 'api/md/_catalog'),
      JSON.stringify([
        {
          path: '/',
          url: 'https://codevetter.com/',
          md: 'https://codevetter.com/index.md',
          title: 'Home',
        },
      ])
    );
    writeFileSync(join(dist, 'index.md'), '# Home\n\nAuthored content.\n');
    writeFileSync(
      join(dist, 'index.html'),
      '<html><head><link rel="canonical" href="https://codevetter.com/"><meta name="description" content="A &amp;quot; B &quot; C &#39;"></head><body>Unchanged</body></html>'
    );
    await finalizeLandingMarkdown(dist);
    assert.ok(readFileSync(join(dist, 'index.md'), 'utf8').includes(`> A &quot; B " C '`));
    const html = readFileSync(join(dist, 'index.html'), 'utf8');
    assert.ok(html.includes('content="A &amp;quot; B &quot; C \'"'));
    assert.ok(html.includes('<body>Unchanged</body>'));
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});
