import { cpSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { posix, relative, resolve, sep } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const docsSource = resolve(repoRoot, 'docs');
const docsOutput = resolve(repoRoot, 'docs-site/dist');
const landingOutput = resolve(repoRoot, 'apps/landing-page-astro/dist');
const publicDocs = resolve(landingOutput, 'docs');
const SITE_ORIGIN = 'https://codevetter.com';
const REPOSITORY_URL = 'https://github.com/Codevetter/codevetter';
const DOC_URL_PATTERN =
  /(?<![A-Za-z0-9._~!$&'*+,;=:@%/-])(?:https:\/\/codevetter\.com)?\/docs(?:\/[A-Za-z0-9._~!$&'*+,;=:@%/-]*)?(?:\?[A-Za-z0-9._~!$&'*+,;=:@%/?-]*)?(?:#[A-Za-z0-9._~!$&'*+,;=:@%/?-]*)?/g;
const STATIC_FILE_PATTERN =
  /\.(?:html?|mdx?|json|xml|txt|png|jpe?g|webp|avif|gif|svg|ico|css|m?js|map|woff2?|ttf|otf|wasm|pdf|zip|dmg|exe|deb|appimage)$/i;
const TEXT_OUTPUT_PATTERN = /\.(?:html?|mdx?|json|xml|txt|css|m?js)$/i;
const RENDERED_HREF_PATTERN = /href=(['"])([^'"]+)\1/gi;

function splitURLSuffix(value) {
  const suffixIndex = value.search(/[?#]/);
  return suffixIndex === -1
    ? { pathname: value, suffix: '' }
    : { pathname: value.slice(0, suffixIndex), suffix: value.slice(suffixIndex) };
}

function sourceDirectoryForHTML(target) {
  const relativeHTML = relative(publicDocs, target).split(sep).join('/');
  const outputDirectory = posix.dirname(relativeHTML);
  // Blume renders `architecture/overview.md` to
  // `architecture/overview/index.html`. Resolve authored relative links from
  // the Markdown file's directory, not from the generated route directory.
  return relativeHTML === 'index.html' ? '' : posix.dirname(outputDirectory);
}

function generatedDocsRoute(sourcePath) {
  if (!/\.md$/i.test(sourcePath)) return null;
  const relativeSource = relative(docsSource, sourcePath).split(sep).join('/');
  if (relativeSource.startsWith('../') || relativeSource === '..') return null;

  const route = relativeSource.replace(/\.md$/i, '');
  const generatedPage =
    route.toLowerCase() === 'index'
      ? resolve(docsOutput, 'index.html')
      : resolve(docsOutput, route, 'index.html');
  if (!existsSync(generatedPage)) return null;
  return route.toLowerCase() === 'index' ? '/docs/' : `/docs/${route}/`;
}

function repositoryURL(target) {
  const repositoryPath = relative(repoRoot, target).split(sep).join('/');
  if (
    repositoryPath === '..' ||
    repositoryPath.startsWith('../') ||
    repositoryPath.startsWith('/')
  ) {
    return null;
  }

  const encodedPath = repositoryPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const view = statSync(target).isDirectory() ? 'tree' : 'blob';
  return `${REPOSITORY_URL}/${view}/main/${encodedPath}`;
}

function rewriteAuthoredSourceLinks(target, html) {
  const sourceDirectory = sourceDirectoryForHTML(target);

  return html.replace(RENDERED_HREF_PATTERN, (match, quote, rawHref) => {
    if (rawHref.startsWith('#') || rawHref.startsWith('//') || /^(?:[a-z]+:)/i.test(rawHref)) {
      return match;
    }

    const { pathname, suffix } = splitURLSuffix(rawHref);
    if (!pathname || (!pathname.startsWith('/docs/') && pathname.startsWith('/'))) {
      return match;
    }

    const sourceRelative = pathname.startsWith('/docs/')
      ? pathname.slice('/docs/'.length)
      : posix.normalize(posix.join(sourceDirectory, pathname));
    const sourceTarget = resolve(docsSource, sourceRelative);
    if (!existsSync(sourceTarget)) return match;

    const docsRoute = generatedDocsRoute(sourceTarget);
    const destination = docsRoute ?? repositoryURL(sourceTarget);
    return destination ? `href=${quote}${destination}${suffix}${quote}` : match;
  });
}

function removeDuplicatePageTitle(html) {
  const headings = [...html.matchAll(/<h1\b([^>]*)>([\s\S]*?)<\/h1>/gi)];
  if (headings.length !== 2) return { html, removed: 0 };

  const normalizeText = (value) =>
    value
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  if (normalizeText(headings[0][2]) !== normalizeText(headings[1][2])) {
    return { html, removed: 0 };
  }

  const duplicateID = headings[1][1].match(/\bid=(['"])(.*?)\1/i)?.[2];
  let after = html;
  if (duplicateID && !/\bid=/i.test(headings[0][1])) {
    after = after.replace(
      headings[0][0],
      `<h1${headings[0][1]} id="${duplicateID}">${headings[0][2]}</h1>`
    );
  }
  after = after.replace(headings[1][0], '');
  return { html: after, removed: 1 };
}

function canonicalDocsURL(value) {
  const prefix = value.startsWith(SITE_ORIGIN) ? SITE_ORIGIN : '';
  const relativeURL = prefix ? value.slice(prefix.length) : value;
  const { pathname, suffix } = splitURLSuffix(relativeURL);
  if (pathname === '/docs/index' || pathname === '/docs/index/') {
    return `${prefix}/docs/${suffix}`;
  }
  if (pathname.endsWith('/') || STATIC_FILE_PATTERN.test(pathname)) return value;
  return `${prefix}${pathname}/${suffix}`;
}

function normalizeDocsURLs(directory) {
  let replacements = 0;
  let duplicateTitles = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = normalizeDocsURLs(target);
      replacements += nested.replacements;
      duplicateTitles += nested.duplicateTitles;
      continue;
    }
    if (!TEXT_OUTPUT_PATTERN.test(entry.name)) continue;

    const before = readFileSync(target, 'utf8');
    const withSourceLinks = entry.name.endsWith('.html')
      ? rewriteAuthoredSourceLinks(target, before)
      : before;
    const deduplicated = entry.name.endsWith('.html')
      ? removeDuplicatePageTitle(withSourceLinks)
      : { html: withSourceLinks, removed: 0 };
    duplicateTitles += deduplicated.removed;
    const after = deduplicated.html.replace(DOC_URL_PATTERN, (value) => {
      const canonical = canonicalDocsURL(value);
      if (canonical !== value) replacements += 1;
      return canonical;
    });
    if (after !== before) writeFileSync(target, after);
  }
  return { replacements, duplicateTitles };
}

function assertInternalDocsLinks(directory) {
  const brokenLinks = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      brokenLinks.push(...assertInternalDocsLinks(target));
      continue;
    }
    if (!entry.name.endsWith('.html')) continue;

    const relativeHTML = relative(publicDocs, target).split(sep).join('/');
    const currentRoute =
      relativeHTML === 'index.html'
        ? '/docs/'
        : `/docs/${relativeHTML.replace(/index\.html$/, '')}`;
    const html = readFileSync(target, 'utf8');

    for (const match of html.matchAll(RENDERED_HREF_PATTERN)) {
      let rawHref = match[2];
      if (rawHref.startsWith(SITE_ORIGIN)) {
        rawHref = rawHref.slice(SITE_ORIGIN.length);
      } else if (
        rawHref.startsWith('#') ||
        rawHref.startsWith('//') ||
        /^(?:[a-z]+:)/i.test(rawHref)
      ) {
        continue;
      }

      const { pathname } = splitURLSuffix(rawHref);
      const route = pathname.startsWith('/')
        ? pathname
        : posix.resolve(posix.dirname(currentRoute), pathname);
      if (!route.startsWith('/docs/')) continue;

      const docsPath = route.slice('/docs/'.length);
      const candidate = route.endsWith('/')
        ? resolve(publicDocs, docsPath, 'index.html')
        : resolve(publicDocs, docsPath);
      if (!existsSync(candidate)) {
        brokenLinks.push(`${relativeHTML}: ${match[2]}`);
      }
    }
  }

  if (directory === publicDocs && brokenLinks.length > 0) {
    throw new Error(
      `[codevetter] broken internal docs links:\n${brokenLinks
        .map((link) => `- ${link}`)
        .join('\n')}`
    );
  }

  return brokenLinks;
}

function includeDocsSitemap() {
  const docsSitemap = `${SITE_ORIGIN}/docs/sitemap.xml`;
  for (const sitemapName of ['sitemap-index.xml', 'sitemap.xml']) {
    const sitemapIndex = resolve(landingOutput, sitemapName);
    const before = readFileSync(sitemapIndex, 'utf8');
    if (before.includes(docsSitemap)) continue;

    const entry = `<sitemap><loc>${docsSitemap}</loc></sitemap>`;
    const after = before.replace('</sitemapindex>', `${entry}</sitemapindex>`);
    if (after === before) {
      throw new Error(`[codevetter] could not add the docs sitemap to ${sitemapName}`);
    }
    writeFileSync(sitemapIndex, after);
  }
}

if (!existsSync(resolve(landingOutput, 'index.html'))) {
  throw new Error('[codevetter] build the Astro landing page before merging docs');
}
if (!existsSync(resolve(docsOutput, 'index.html'))) {
  throw new Error('[codevetter] build the Blume docs before merging them');
}
if (existsSync(publicDocs)) {
  throw new Error(
    '[codevetter] landing dist/docs already exists; rebuild the landing page before merging docs'
  );
}

cpSync(docsOutput, publicDocs, { recursive: true });
const normalization = normalizeDocsURLs(publicDocs);
includeDocsSitemap();
assertInternalDocsLinks(publicDocs);
console.log(
  `[codevetter] merged docs, normalized ${normalization.replacements} document URLs, removed ${normalization.duplicateTitles} duplicate page titles, indexed the docs sitemap, and verified internal links`
);
