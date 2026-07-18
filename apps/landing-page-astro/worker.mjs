/**
 * Serves the static landing from Worker assets on codevetter.com routes.
 * Handles agent SEO surfaces that need clean paths (/api/ai).
 * Deploy: npm run build && npx wrangler deploy --config wrangler.worker.jsonc
 */
const AGENT_REWRITES = {
  '/api/ai': '/api/ai', // physical file without extension
  '/api-ai.json': '/api/ai',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let assetRequest = request;
    const rewrite = AGENT_REWRITES[url.pathname];
    if (rewrite) {
      const rewritten = new URL(url);
      rewritten.pathname = rewrite;
      assetRequest = new Request(rewritten.toString(), request);
    }
    let response = await env.ASSETS.fetch(assetRequest);
    // Fallback: try /api-ai.json if /api/ai missing
    if (response.status === 404 && url.pathname === '/api/ai') {
      const fb = new URL(url);
      fb.pathname = '/api-ai.json';
      response = await env.ASSETS.fetch(new Request(fb.toString(), request));
    }
    if (response.status === 404 && url.pathname === '/api-ai.json') {
      const fb = new URL(url);
      fb.pathname = '/api/ai';
      response = await env.ASSETS.fetch(new Request(fb.toString(), request));
    }
    const headers = new Headers(response.headers);
    headers.set('x-edge-cache', 'WORKER-ASSETS');
    if (url.pathname === '/api/ai' || url.pathname === '/api-ai.json') {
      headers.set('content-type', 'application/json; charset=utf-8');
      headers.set('access-control-allow-origin', '*');
    }
    if (url.pathname.endsWith('.md')) {
      headers.set('content-type', 'text/markdown; charset=utf-8');
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
