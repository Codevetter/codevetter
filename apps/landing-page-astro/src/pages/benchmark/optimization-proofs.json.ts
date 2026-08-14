import anime from '../../../../../benchmarks/performance-lab/autonomous-browser-loop-anime-proof-2026-08-14.json';
import freeAi from '../../../../../benchmarks/performance-lab/free-ai-selection-one-pass-proof-2026-08-14.json';
import starboard from '../../../../../benchmarks/performance-lab/starboard-token-scan-rejection-2026-08-14.json';

export const prerender = true;

export function GET() {
  return new Response(`${JSON.stringify({ anime, free_ai: freeAi, starboard }, null, 2)}\n`, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
