import { createHash } from 'node:crypto';
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

function isPublishedUrlCanonical(value) {
  const url = new URL(value, origin);
  return url.pathname === '/' || url.pathname === '/docs/' || value === canonicalUrl(value);
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
const failures = [];

const aiCatalog = JSON.parse(
  fs.readFileSync(path.join(dist, '.well-known', 'ai-catalog.json'), 'utf8')
);
if (aiCatalog.specVersion !== '1.0' || !Array.isArray(aiCatalog.entries)) {
  failures.push('/.well-known/ai-catalog.json is not an AI Catalog 1.0 document');
}
for (const entry of aiCatalog.entries ?? []) {
  if (
    typeof entry?.identifier !== 'string' ||
    typeof entry?.displayName !== 'string' ||
    typeof entry?.type !== 'string' ||
    typeof entry?.url !== 'string' ||
    new URL(entry.url, origin).origin !== origin
  ) {
    failures.push(`${entry?.identifier ?? 'unnamed'}: AI Catalog entry is incomplete or external`);
  }
}

const skillsIndex = JSON.parse(
  fs.readFileSync(path.join(dist, '.well-known', 'agent-skills', 'index.json'), 'utf8')
);
for (const skill of skillsIndex.skills ?? []) {
  const skillFile = localFile(skill.url);
  if (
    typeof skill?.name !== 'string' ||
    typeof skill?.description !== 'string' ||
    skill?.type !== 'text/markdown' ||
    !fs.existsSync(skillFile)
  ) {
    failures.push(`${skill?.name ?? 'unnamed'}: skill discovery entry is incomplete`);
    continue;
  }
  const skillBytes = fs.readFileSync(skillFile);
  const digest = `sha256:${createHash('sha256').update(skillBytes).digest('hex')}`;
  if (skill.digest !== digest) {
    failures.push(`${skill.name}: skill digest does not match the published SKILL.md`);
  }
  const skillSource = skillBytes.toString('utf8');
  if (!skillSource.startsWith('---\n') || !skillSource.includes(`\nname: ${skill.name}\n`)) {
    failures.push(`${skill.name}: published SKILL.md metadata does not match discovery`);
  }
}
if (!Array.isArray(skillsIndex.skills) || skillsIndex.skills.length === 0) {
  failures.push('/.well-known/agent-skills/index.json contains no skills');
}

// Verify both sitemap indexes resolve to checked-in build output. The docs
// sitemap is merged after Astro builds the landing sitemap.
const sitemapIndex = fs.readFileSync(path.join(dist, 'sitemap-index.xml'), 'utf8');
const indexEntries = [...sitemapIndex.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)].map(
  (match) => match[1]
);
const legacySitemap = fs.readFileSync(path.join(dist, 'sitemap.xml'), 'utf8');
const legacyEntries = [...legacySitemap.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)].map(
  (match) => match[1]
);
if (indexEntries.length === 0) {
  failures.push('sitemap-index.xml contains no sitemap entries');
}
for (const entry of indexEntries) {
  const entryUrl = new URL(entry, origin);
  const sitemapFile = path.join(dist, decodeURIComponent(entryUrl.pathname).replace(/^\/+/, ''));
  if (entryUrl.origin !== origin || !entryUrl.pathname.endsWith('.xml')) {
    failures.push(`${entry}: sitemap-index entry is not a same-origin XML sitemap`);
  } else if (!fs.existsSync(sitemapFile)) {
    failures.push(`${entry}: sitemap-index entry has no local build output`);
  }
}
if (JSON.stringify(legacyEntries) !== JSON.stringify(indexEntries)) {
  failures.push('sitemap.xml does not mirror sitemap-index.xml entries');
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
  if (!isPublishedUrlCanonical(surface.url)) {
    failures.push(`${id}: catalog URL is not canonical`);
  }
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
if (surfaces.length === 0) failures.push('/api/ai contains no surfaces');

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`PASS ${routes.length}/${routes.length} sitemap routes have readable Markdown`);
console.log(
  `PASS ${indexEntries.length} sitemap-index entr${indexEntries.length === 1 ? 'y' : 'ies'} resolve to local sitemap files`
);
console.log(`PASS sitemap.xml mirrors the canonical sitemap index`);
console.log(
  `PASS ${surfaces.length}/${routes.length} API catalog surfaces cover every sitemap route and are readable`
);
console.log(
  `PASS ${skillsIndex.skills.length} published skill digest and ${aiCatalog.entries.length} AI Catalog entries`
);
