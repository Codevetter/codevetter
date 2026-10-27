import { absoluteMarkdownLinks } from '../apps/landing-page-astro/src/lib/agent-surfaces/format.mjs';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentSurfaceManifest } from '../apps/landing-page-astro/src/lib/agent-surfaces/manifest.mjs';
import { createAgentSurfaceHandler } from '../apps/landing-page-astro/src/lib/agent-surfaces/handler.mjs';

const repo = resolve(import.meta.dirname, '..');
const origin = 'https://codevetter.com';
const routeKey = (path) => path.replace(/\/$/, '') || '/';
const escape = (value) =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const decode = (value) =>
  value.replace(
    /&(?:amp|quot|#39);/g,
    (entity) => ({ '&amp;': '&', '&quot;': '"', '&#39;': "'" })[entity]
  );
function walk(directory, extension) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = resolve(directory, entry.name);
    return entry.isDirectory()
      ? walk(file, extension)
      : entry.name.endsWith(extension)
        ? [file]
        : [];
  });
}
function headMetadata(html) {
  const attribute = (tag, name) => tag.match(new RegExp(`\\b${name}=(["'])(.*?)\\1`, 'i'))?.[2];
  const tags = html.match(/<(?:meta|link)\b[^>]*>/gi) || [];
  const named = (name) => tags.find((tag) => attribute(tag, 'name') === name);
  return {
    noindex: /noindex/i.test(attribute(named('robots') || '', 'content') || ''),
    description: decode(attribute(named('description') || '', 'content') || ''),
    canonical: attribute(tags.find((tag) => attribute(tag, 'rel') === 'canonical') || '', 'href'),
  };
}

/** Formats authored Markdown without deriving main content from rendered HTML. */
export function formatMarkdown(source, { title, description, canonical, resolveLink }) {
  let body = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
  body = body.replace(/^#\s+[^\n]+\n*/, '').replace(/^> Canonical page: [^\n]+\n*/, '');
  body = body.replace(/^> [^\n]+\n+Canonical: [^\n]+\n*/, '');
  body = body.replace(/^Canonical: [^\n]+\n*/m, '');
  body = absoluteMarkdownLinks(body, canonical, { resolveLink });
  return `# ${title}\n\n> ${description || title}\n\nCanonical: ${canonical}\n\n${body}\n`;
}

function collectPublicPages(dist) {
  const htmlPages = walk(dist, '.html');
  const publicPages = [];
  for (const file of htmlPages) {
    const html = readFileSync(file, 'utf8');
    const metadata = headMetadata(html);
    if (metadata.noindex || /(?:^|\/)404\.html$/.test(file)) continue;
    if (!metadata.canonical)
      throw new Error(`Public page lacks canonical: ${relative(dist, file)}`);
    const url = new URL(metadata.canonical, origin);
    if (url.origin !== origin) throw new Error(`External canonical: ${url.href}`);
    publicPages.push({ file, html, metadata, url });
  }
  return publicPages;
}

function collectSourceRoutes(dist, publicPages) {
  const sourceRoutes = new Map();
  for (const { file, url } of publicPages) {
    if (!url.pathname.startsWith('/docs/')) continue;
    const rel = relative(resolve(dist, 'docs'), file).replaceAll('\\', '/');
    const source = resolve(
      repo,
      'docs',
      rel === 'index.html' ? 'index.md' : rel.replace(/\/index\.html$/, '.md')
    );
    if (!existsSync(source))
      throw new Error(`No authored source for published docs: ${url.pathname}`);
    sourceRoutes.set(source, url.href);
  }
  return sourceRoutes;
}

function resolvePublicLink(target, { url, sourceFile, sourceRoutes, candidates }) {
  if (
    (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) &&
    new URL(target, url).origin !== origin
  )
    return new URL(target, url).href;
  if (sourceFile && !target.startsWith('/') && !target.startsWith('#')) {
    const [pathname, fragment] = target.split('#');
    const local = resolve(dirname(sourceFile), pathname);
    const canonical = sourceRoutes.get(local);
    if (canonical) return canonical + (fragment ? `#${fragment}` : '');
    if (existsSync(local))
      return `https://github.com/Codevetter/codevetter/blob/main/${relative(repo, local).replaceAll('\\', '/')}${fragment ? `#${fragment}` : ''}`;
  }
  const destination = new URL(target, url);
  if (destination.origin === origin && destination.pathname.endsWith('.md')) {
    const candidate = destination.pathname.slice(0, -3);
    if (candidates.has(candidate)) destination.pathname = candidate;
  }
  return destination.href;
}

function enrichHtml({ file, html, metadata, title, route }) {
  // Metadata additions only; the human-visible body remains byte-for-byte intact.
  let enriched = html;
  if (!/<meta\b[^>]*name=["']ai-summary["']/i.test(html))
    enriched = enriched.replace(
      '</head>',
      `<meta name="ai-summary" content="${escape(metadata.description || title)}"></head>`
    );
  const alternate = `<link rel="alternate" type="text/markdown" href="${route.md}">`;
  if (/<link\b[^>]*type=["']text\/markdown["'][^>]*>/i.test(enriched)) {
    enriched = enriched.replace(/<link\b[^>]*type=["']text\/markdown["'][^>]*>/gi, alternate);
  } else {
    enriched = enriched.replace('</head>', `${alternate}</head>`);
  }
  if (enriched !== html) writeFileSync(file, enriched);
}

const core = [
  '/',
  '/about',
  '/download',
  '/faq',
  '/compare',
  '/benchmark',
  '/docs/',
  '/changelog',
  '/privacy',
  '/terms',
  '/coding-agent-verification',
  '/verify-ai-generated-code',
  '/ai-code-review-vs-verification',
  '/verification-evidence-bundle',
  '/codevetter-vs-greptile',
  '/codevetter-vs-coderabbit',
  '/articles',
  '/inspiration',
];
const rank = (path) =>
  core.includes(path)
    ? core.indexOf(path)
    : path.startsWith('/articles/')
      ? 30
      : path.startsWith('/docs/')
        ? 100
        : 50;

function markdownTitle(source, route, url) {
  const title =
    source.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1].match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1] ||
    source.match(/^#\s+(.+)$/m)?.[1] ||
    route.title;
  if (!title) throw new Error(`Markdown lacks title: ${url.pathname}`);
  return title;
}

export async function finalizeLandingMarkdown(
  dist = resolve(repo, 'apps/landing-page-astro/dist')
) {
  const catalogFile = resolve(dist, 'api/md/_catalog');
  const identity = JSON.parse(readFileSync(resolve(dist, 'api/md/_identity'), 'utf8'));
  const existing = JSON.parse(readFileSync(catalogFile, 'utf8'));
  const candidates = new Map(existing.map((route) => [routeKey(route.path), route]));
  const registry = new Map();
  const pages = {};
  const publicPages = collectPublicPages(dist);
  const sourceRoutes = collectSourceRoutes(dist, publicPages);
  for (const { file, html, metadata, url } of publicPages) {
    const key = routeKey(url.pathname);
    let route = candidates.get(key);
    let sourceFile;
    if (url.pathname.startsWith('/docs/')) {
      sourceFile = [...sourceRoutes].find(([, destination]) => destination === url.href)?.[0];
      route = {
        path: url.pathname,
        url: url.href,
        md: `${origin}${key}.md`,
        ...(key === '/docs' ? { aliases: ['/docs/index.md'] } : {}),
      };
    }
    if (!route) throw new Error(`Missing public Markdown renderer: ${url.pathname}`);
    const mdPath = new URL(route.md).pathname;
    const source = readFileSync(sourceFile || resolve(dist, mdPath.slice(1)), 'utf8');
    const title = markdownTitle(source, route, url);
    const resolveLink = (target) =>
      resolvePublicLink(target, { url, sourceFile, sourceRoutes, candidates });
    const markdown = formatMarkdown(source, {
      title,
      description: metadata.description,
      canonical: url.href,
      resolveLink,
    });
    mkdirSync(dirname(resolve(dist, mdPath.slice(1))), { recursive: true });
    writeFileSync(resolve(dist, mdPath.slice(1)), markdown);
    const entry = {
      ...route,
      path: url.pathname,
      url: url.href,
      title,
      description: metadata.description,
      assetPath: mdPath,
      ...(source.match(/Last updated: (\d{4}-\d{2}-\d{2})/)
        ? { lastModified: source.match(/Last updated: (\d{4}-\d{2}-\d{2})/)[1] }
        : {}),
    };
    registry.set(key, entry);
    pages[url.pathname] = markdown;
    enrichHtml({ file, html, metadata, title, route });
  }
  // The landing build precedes the separate docs build; retain only its known index.
  if (!existsSync(resolve(dist, 'docs/index.html')) && candidates.has('/docs')) {
    registry.set('/docs', candidates.get('/docs'));
  }
  for (const route of registry.values()) {
    if (!Object.hasOwn(pages, route.path)) {
      const file = resolve(dist, new URL(route.md).pathname.slice(1));
      if (existsSync(file)) pages[route.path] = readFileSync(file, 'utf8');
    }
  }
  const routes = [...registry.values()].sort((a, b) => rank(a.path) - rank(b.path));
  writeFileSync(catalogFile, JSON.stringify(routes));
  const manifest = createAgentSurfaceManifest({
    ...identity,
    pages,
    sitemap: `${origin}/sitemap-index.xml`,
  });
  const handler = createAgentSurfaceHandler({ manifest, listMarkdownRoutes: () => routes });
  for (const path of ['/llms.txt', '/llms-full.txt', '/ai.txt']) {
    const response = await handler(new Request(origin + path));
    writeFileSync(resolve(dist, path.slice(1)), await response.text());
  }
  console.log(
    `AI readability: ${publicPages.length} public HTML pages, ${routes.length} registered Markdown routes.`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await finalizeLandingMarkdown();
