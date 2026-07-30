import type { APIRoute, GetStaticPaths } from 'astro';
import { agentMarkdownPages } from '@/data/agent-markdown';

export const getStaticPaths = (() =>
  Object.entries(agentMarkdownPages).map(([route, markdown]) => ({
    params: { route },
    props: { markdown },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) =>
  new Response(props.markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
