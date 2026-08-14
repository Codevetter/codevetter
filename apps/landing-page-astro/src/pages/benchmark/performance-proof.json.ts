import proof from '../../../../../benchmarks/performance-lab/autonomous-browser-loop-anime-proof-2026-08-14.json';

export const prerender = true;

export function GET() {
  return new Response(`${JSON.stringify(proof, null, 2)}\n`, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
