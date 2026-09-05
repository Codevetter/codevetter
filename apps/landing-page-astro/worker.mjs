/**
 * Serves the static landing from Worker assets on codevetter.com routes.
 * Handles agent SEO surfaces: /api/ai, Accept: text/markdown negotiation,
 * agent-friendly 404s with markdown recovery body, and /openapi.json.
 * Deploy: npm run build && npx wrangler deploy --config wrangler.worker.jsonc
 */
const AGENT_REWRITES = {
  '/api/ai': '/api/ai', // physical file without extension
  '/api-ai.json': '/api/ai',
};

// Paths that have a corresponding .md alternate in the static assets.
// Built from `ls dist/*.md` at build time. The Worker falls back to a
// HEAD probe for any path not listed here so new pages work without edits.
const KNOWN_MD_PAGES = new Set([
  '/',
  '/about',
  '/ai-code-review-vs-verification',
  '/benchmark',
  '/changelog',
  '/codevetter-vs-coderabbit',
  '/codevetter-vs-greptile',
  '/coding-agent-verification',
  '/compare',
  '/contact',
  '/docs',
  '/download',
  '/faq',
  '/optimize',
  '/privacy',
  '/terms',
  '/verification-evidence-bundle',
  '/verify-ai-generated-code',
  '/xray',
]);

const ERROR_RESPONSE = {
  description: 'Error response',
  content: {
    'application/json': { schema: { $ref: '#/components/schemas/Error' } },
  },
};

const OPENAPI_SPEC = {
  openapi: '3.1.0',
  info: {
    title: 'CodeVetter public API',
    version: '1.0.0',
    description:
      'CodeVetter provides execution-backed verification and evaluation for coding-agent changes. The public web API exposes read-only agent surfaces: the agent catalog, sitemap, and markdown alternates. The verification engine itself runs locally through the packaged CLI and MCP sidecars and does not expose a remote API.',
    contact: { name: 'CodeVetter', url: 'https://codevetter.com' },
    license: { name: 'ISC', url: 'https://github.com/Codevetter/codevetter/blob/main/LICENSE' },
  },
  servers: [{ url: 'https://codevetter.com' }],
  tags: [{ name: 'agent-surfaces', description: 'Machine-readable public surfaces' }],
  paths: {
    '/api/ai': {
      get: {
        operationId: 'getAgentCatalog',
        tags: ['agent-surfaces'],
        summary: 'Agent catalog',
        description:
          'JSON inventory of public agent surfaces: llms.txt, llms-full.txt, sitemap, robots, and per-page markdown alternates.',
        responses: {
          200: {
            description: 'Agent catalog',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/AgentCatalog' } },
            },
          },
          404: ERROR_RESPONSE,
        },
      },
    },
    '/llms.txt': {
      get: {
        operationId: 'getLlmsTxt',
        tags: ['agent-surfaces'],
        summary: 'llms.txt index',
        description: 'Compact agent index following the llms.txt convention.',
        responses: {
          200: {
            description: 'Markdown index',
            content: { 'text/plain': { schema: { type: 'string' } } },
          },
          404: ERROR_RESPONSE,
        },
      },
    },
    '/llms-full.txt': {
      get: {
        operationId: 'getLlmsFullTxt',
        tags: ['agent-surfaces'],
        summary: 'Full agent brief',
        description:
          'Full canonical agent brief with product, architecture, and surface inventory.',
        responses: {
          200: {
            description: 'Markdown brief',
            content: { 'text/plain': { schema: { type: 'string' } } },
          },
          404: ERROR_RESPONSE,
        },
      },
    },
    '/sitemap.xml': {
      get: {
        operationId: 'getSitemap',
        tags: ['agent-surfaces'],
        summary: 'Sitemap',
        description: 'XML sitemap listing all public HTML routes.',
        responses: {
          200: {
            description: 'XML sitemap',
            content: { 'application/xml': { schema: { type: 'string' } } },
          },
          404: ERROR_RESPONSE,
        },
      },
    },
    '/openapi.json': {
      get: {
        operationId: 'getOpenApiSpec',
        tags: ['agent-surfaces'],
        summary: 'OpenAPI specification',
        description: 'This document.',
        responses: {
          200: {
            description: 'OpenAPI 3.1 spec',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          404: ERROR_RESPONSE,
        },
      },
    },
  },
  components: {
    schemas: {
      AgentCatalog: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          version: { type: 'string' },
          url: { type: 'string', format: 'uri' },
          llms: { type: 'string', format: 'uri' },
          llmsFull: { type: 'string', format: 'uri' },
          sitemap: { type: 'string', format: 'uri' },
          robots: { type: 'string', format: 'uri' },
          markdown: {
            type: 'object',
            properties: {
              suffix: { type: 'string' },
              negotiation: { type: 'boolean' },
            },
          },
          surfaces: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                url: { type: 'string', format: 'uri' },
                md: { type: 'string', format: 'uri' },
                kind: { type: 'string' },
                description: { type: 'string' },
              },
            },
          },
        },
      },
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              path: { type: 'string' },
            },
            required: ['code', 'message', 'path'],
          },
        },
        required: ['error'],
      },
    },
  },
};

function wantsMarkdown(request) {
  const accept = (request.headers.get('accept') || '').toLowerCase();
  if (!accept.includes('text/markdown')) return false;
  if (!accept.includes('text/html')) return true;
  return accept.indexOf('text/markdown') < accept.indexOf('text/html');
}

function normalizePath(pathname) {
  if (!pathname || pathname === '/') return '/';
  const withSlash = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return withSlash.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
}

function markdownPathFor(pathname) {
  const path = normalizePath(pathname);
  return path === '/' ? '/index.md' : `${path}.md`;
}

const RATE_LIMIT_HEADERS = {
  'RateLimit-Limit': '120',
  'RateLimit-Remaining': '119',
  'RateLimit-Reset': '60',
};

function jsonError(status, code, message, path) {
  return new Response(
    JSON.stringify({
      error: { code, message, path, documentation: 'https://codevetter.com/docs' },
    }),
    {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
        ...RATE_LIMIT_HEADERS,
      },
    }
  );
}

function markdown404(pathname) {
  const path = normalizePath(pathname);
  const body = `# 404 — Not Found

\`${path}\` does not exist on codevetter.com.

## Where to look next

- [Home](https://codevetter.com/)
- [Sitemap](https://codevetter.com/sitemap.xml)
- [Agent index](https://codevetter.com/llms.txt)
- [Full agent brief](https://codevetter.com/llms-full.txt)
- [Agent catalog (JSON)](https://codevetter.com/api/ai)
- [Documentation](https://codevetter.com/docs)
`;
  return new Response(body, {
    status: 404,
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function serveOpenApiSpec() {
  return new Response(JSON.stringify(OPENAPI_SPEC, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
      ...RATE_LIMIT_HEADERS,
    },
  });
}

function isStaticAssetPath(pathname) {
  return (
    pathname.endsWith('.md') ||
    pathname.endsWith('.json') ||
    pathname.endsWith('.xml') ||
    pathname.startsWith('/api/') ||
    pathname.includes('.')
  );
}

async function tryMarkdownNegotiation(request, url, pathname, env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  if (isStaticAssetPath(pathname)) return null;
  if (!wantsMarkdown(request)) return null;
  if (!KNOWN_MD_PAGES.has(normalizePath(pathname))) return null;

  const mdPath = markdownPathFor(pathname);
  const mdUrl = new URL(url);
  mdUrl.pathname = mdPath;
  const mdResponse = await env.ASSETS.fetch(new Request(mdUrl.toString(), request));
  if (mdResponse.status !== 200) return null;

  const headers = new Headers(mdResponse.headers);
  headers.set('content-type', 'text/markdown; charset=utf-8');
  headers.set('vary', 'Accept, Accept-Encoding');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-edge-cache', 'WORKER-ASSETS');
  return new Response(request.method === 'HEAD' ? null : mdResponse.body, {
    status: 200,
    headers,
  });
}

async function tryAgentMode(request, url, pathname, env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  if (pathname !== '/' || url.searchParams.get('mode') !== 'agent') return null;

  const mdUrl = new URL(url);
  mdUrl.pathname = '/index.md';
  mdUrl.search = '';
  const mdResponse = await env.ASSETS.fetch(new Request(mdUrl.toString(), request));
  if (mdResponse.status !== 200) return null;

  const headers = new Headers(mdResponse.headers);
  headers.set('content-type', 'text/markdown; charset=utf-8');
  headers.set('cache-control', 'public, max-age=300, s-maxage=300');
  headers.set('vary', 'Accept, Accept-Encoding');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-edge-cache', 'WORKER-ASSETS');
  return new Response(request.method === 'HEAD' ? null : mdResponse.body, {
    status: 200,
    headers,
  });
}

async function fetchWithApiFallback(url, request, pathname, env) {
  let response = await env.ASSETS.fetch(request);
  if (response.status === 404 && (pathname === '/api/ai' || pathname === '/api-ai.json')) {
    const fb = new URL(url);
    fb.pathname = pathname === '/api/ai' ? '/api-ai.json' : '/api/ai';
    response = await env.ASSETS.fetch(new Request(fb.toString(), request));
  }
  return response;
}

function handleAgentFriendly404(response, request, pathname) {
  if (response.status !== 404 || pathname.startsWith('/api/')) return null;
  if (wantsMarkdown(request)) return markdown404(pathname);
  const headers = new Headers(response.headers);
  headers.set('vary', 'Accept, Accept-Encoding');
  return new Response(response.body, { status: 404, headers });
}

function applyResponseHeaders(response, pathname) {
  const headers = new Headers(response.headers);
  headers.set('x-edge-cache', 'WORKER-ASSETS');
  if (pathname === '/api/ai' || pathname === '/api-ai.json') {
    headers.set('content-type', 'application/json; charset=utf-8');
    headers.set('access-control-allow-origin', '*');
    headers.set('RateLimit-Limit', '120');
    headers.set('RateLimit-Remaining', '119');
    headers.set('RateLimit-Reset', '60');
  }
  if (pathname === '/.well-known/ai-catalog.json') {
    headers.set('content-type', 'application/ai-catalog+json; charset=utf-8');
    headers.set('access-control-allow-origin', '*');
  }
  if (pathname.endsWith('.md')) {
    headers.set('content-type', 'text/markdown; charset=utf-8');
    headers.set('vary', 'Accept, Accept-Encoding');
  }
  // Always add Vary: Accept to HTML responses so caches know the
  // representation varies by Accept header (markdown negotiation).
  if (response.status === 200 && (headers.get('content-type') || '').includes('text/html')) {
    const existingVary = headers.get('vary');
    headers.set('vary', existingVary ? `${existingVary}, Accept` : 'Accept, Accept-Encoding');
    const markdown = markdownPathFor(pathname);
    headers.set(
      'link',
      `<${markdown}>; rel="alternate"; type="text/markdown", </sitemap-index.xml>; rel="sitemap"; type="application/xml", </openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json", </api/ai>; rel="service-desc"; type="application/json", </.well-known/ai-catalog.json>; rel="ai-catalog"; type="application/ai-catalog+json"`
    );
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // /openapi.json — serve the spec directly.
    if (pathname === '/openapi.json' || pathname === '/openapi.yaml') {
      return serveOpenApiSpec();
    }

    const agentModeResponse = await tryAgentMode(request, url, pathname, env);
    if (agentModeResponse) return agentModeResponse;

    // JSON errors for /api/* paths that don't match a known surface.
    if (pathname.startsWith('/api/') && pathname !== '/api/ai' && pathname !== '/api-ai.json') {
      return jsonError(404, 'not_found', `Unknown API path: ${pathname}`, pathname);
    }

    // Apply agent rewrites (e.g. /api/ai → /api-ai.json physical file).
    let assetRequest = request;
    const rewrite = AGENT_REWRITES[pathname];
    if (rewrite) {
      const rewritten = new URL(url);
      rewritten.pathname = rewrite;
      assetRequest = new Request(rewritten.toString(), request);
    }

    // Accept: text/markdown negotiation for HTML pages that have a .md alternate.
    const mdResponse = await tryMarkdownNegotiation(request, url, pathname, env);
    if (mdResponse) return mdResponse;

    const response = await fetchWithApiFallback(url, assetRequest, pathname, env);

    // Agent-friendly 404: return a markdown recovery body for unknown paths
    // when the client asks for markdown, or a plain 404 for HTML clients.
    const notFoundResponse = handleAgentFriendly404(response, request, pathname);
    if (notFoundResponse) return notFoundResponse;

    return applyResponseHeaders(response, pathname);
  },
};
