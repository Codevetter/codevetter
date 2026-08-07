import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.resolve(appRoot, process.argv[2] ?? 'dist');
const origin = 'https://codevetter.com';

function canonicalUrl(value) {
  const url = new URL(value, origin);
  url.hash = '';
  url.search = '';
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString();
}

function localFile(value) {
  const url = new URL(value, origin);
  const pathname = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  return path.join(dist, pathname || 'index.md');
}

function readableMarkdown(value) {
  const file = localFile(value);
  return fs.existsSync(file) && fs.readFileSync(file, 'utf8').trimStart().startsWith('#');
}

const sitemap = fs.readFileSync(path.join(dist, 'sitemap-0.xml'), 'utf8');
const routes = [...sitemap.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)].map((match) => match[1]);
const routeSet = new Set(routes.map(canonicalUrl));
const submittedSitemap = fs.readFileSync(path.join(dist, 'sitemap.xml'), 'utf8');
const submittedRoutes = [...submittedSitemap.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)].map(
  (match) => match[1]
);
const submittedRouteSet = new Set(submittedRoutes.map(canonicalUrl));
const failures = [];

for (const route of routeSet) {
  if (!submittedRouteSet.has(route)) {
    failures.push(`${new URL(route).pathname}: generated route is absent from /sitemap.xml`);
  }
}

for (const route of submittedRouteSet) {
  if (!routeSet.has(route)) {
    failures.push(`${new URL(route).pathname}: submitted route is absent from generated sitemap`);
  }
}

for (const route of routes) {
  const url = new URL(route);
  const markdown =
    url.pathname === '/' ? `${origin}/index.md` : `${origin}${url.pathname.replace(/\/+$/, '')}.md`;
  if (!readableMarkdown(markdown)) {
    failures.push(`${url.pathname}: no readable Markdown at ${new URL(markdown).pathname}`);
  }
}

const catalog = JSON.parse(fs.readFileSync(path.join(dist, 'api-ai.json'), 'utf8'));
const surfaces = Array.isArray(catalog.surfaces) ? catalog.surfaces : [];
const catalogRouteSet = new Set();

for (const surface of surfaces) {
  const id = String(surface?.id ?? 'unnamed');
  if (typeof surface?.url !== 'string' || typeof surface?.md !== 'string') {
    failures.push(`${id}: catalog surface is missing url or md`);
    continue;
  }
  const route = new URL(surface.url, origin);
  const markdown = new URL(surface.md, origin);
  if (route.origin !== origin || markdown.origin !== origin) {
    failures.push(`${id}: catalog route or Markdown target is not same-origin`);
    continue;
  }
  catalogRouteSet.add(canonicalUrl(route));
  if (!routeSet.has(canonicalUrl(route))) {
    failures.push(`${id}: catalog route is absent from the public sitemap`);
  }
  if (!readableMarkdown(markdown)) {
    failures.push(`${id}: Markdown target is not readable`);
  }
}

for (const route of routeSet) {
  if (!catalogRouteSet.has(route)) {
    failures.push(`${new URL(route).pathname}: public sitemap route is absent from /api/ai`);
  }
}

if (routes.length === 0) failures.push('public sitemap contains no routes');
if (submittedRoutes.length === 0) failures.push('/sitemap.xml contains no routes');
if (surfaces.length === 0) failures.push('/api/ai contains no surfaces');

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`PASS ${routes.length}/${routes.length} sitemap routes have readable Markdown`);
console.log(
  `PASS ${submittedRoutes.length}/${routes.length} submitted sitemap routes match the generated sitemap`
);
console.log(
  `PASS ${surfaces.length}/${routes.length} API catalog surfaces cover every sitemap route and are readable`
);
