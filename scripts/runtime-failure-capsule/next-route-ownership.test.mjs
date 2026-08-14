import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { resolveNextRouteOwnership } from './next-route-ownership.mjs';

test('resolves App Router pages, methods, groups, and dynamic segments', async (context) => {
  const root = await fixture(context, {
    'src/app/page.tsx': 'export default function Home() {}\n',
    'src/app/(public)/items/[id]/route.ts': [
      'export async function GET() {}',
      'export const POST = async () => {};',
      '',
    ].join('\n'),
    'src/app/files/[...path]/route.ts': 'export function GET() {}\n',
    'src/app/archive/[[...path]]/page.tsx': 'export default function Archive() {}\n',
  });
  const ownership = await resolveNextRouteOwnership(root, [
    { method: 'GET', route: '/' },
    { method: 'POST', route: '/items/:number' },
    { method: 'GET', route: '/files/a/b' },
    { method: 'GET', route: '/archive' },
  ]);

  assert.deepEqual(
    ownership.map((source) => [source.file, source.line, source.function]),
    [
      ['src/app/page.tsx', 1, null],
      ['src/app/(public)/items/[id]/route.ts', 2, 'POST'],
      ['src/app/files/[...path]/route.ts', 1, 'GET'],
      ['src/app/archive/[[...path]]/page.tsx', 1, null],
    ]
  );
  assert.ok(ownership.every((source) => source.provenance === 'static_unique_next_route'));
});

test('resolves Pages Router page and API conventions', async (context) => {
  const root = await fixture(context, {
    'pages/index.tsx': 'export default function Home() {}\n',
    'pages/blog/[slug].tsx': 'export default function Blog() {}\n',
    'pages/api/items/[id].ts': 'export default function handler() {}\n',
  });
  const ownership = await resolveNextRouteOwnership(root, [
    { method: 'HEAD', route: '/' },
    { method: 'GET', route: '/blog/a' },
    { method: 'DELETE', route: '/api/items/4' },
  ]);
  assert.deepEqual(
    ownership.map((source) => source?.file),
    ['pages/index.tsx', 'pages/blog/[slug].tsx', 'pages/api/items/[id].ts']
  );
});

test('withholds unsupported methods and ambiguous route ownership', async (context) => {
  const root = await fixture(context, {
    'app/items/[id]/route.ts': 'export function GET() {}\n',
    'app/items/[slug]/route.ts': 'export function GET() {}\n',
    'app/submit/route.ts': 'export function POST() {}\n',
    'app/unsafe segment/page.tsx': 'export default function Unsafe() {}\n',
  });
  const ownership = await resolveNextRouteOwnership(root, [
    { method: 'GET', route: '/items/1' },
    { method: 'GET', route: '/submit' },
    { method: 'GET', route: '/unsafe segment' },
  ]);
  assert.deepEqual(ownership, [null, null, null]);
});

test('withholds all ownership when the bounded route inventory is incomplete', async (context) => {
  const files = { 'app/page.tsx': 'export default function Home() {}\n' };
  for (let index = 0; index < 257; index += 1) {
    files[`app/api-${index}/route.ts`] = 'export function GET() {}\n';
  }
  const root = await fixture(context, files);
  assert.deepEqual(await resolveNextRouteOwnership(root, [{ method: 'GET', route: '/' }]), [null]);
});

async function fixture(context, files) {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-next-routes-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, source] of Object.entries(files)) {
    const absolute = join(root, path);
    await mkdir(join(absolute, '..'), { recursive: true });
    await writeFile(absolute, source);
  }
  return root;
}
