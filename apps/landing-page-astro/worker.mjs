/**
 * Serves the static landing from Worker assets on codevetter.com routes.
 * Bypasses stale zone edge cache on the Pages custom domain until purge works.
 * Deploy: npm run build && npx wrangler deploy --config wrangler.worker.jsonc
 */
export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    headers.set('x-edge-cache', 'WORKER-ASSETS');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
