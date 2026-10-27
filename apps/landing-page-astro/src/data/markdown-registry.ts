import { agentMarkdownPages } from './agent-markdown';
import { siteIdentity } from './site-identity';
import { createAgentSurfaceManifest } from '../lib/agent-surfaces/manifest.mjs';
import { createAgentSurfaceHandler } from '../lib/agent-surfaces/handler.mjs';
import { listMarkdownRoutes } from '../lib/agent-surfaces/documents.mjs';

import homeMarkdown from '../../public/index.md?raw';
const pages: Record<string, string> = { '/': homeMarkdown };
for (const [path, body] of Object.entries(agentMarkdownPages)) pages[`/${path}`] = body;
const markdownManifest = createAgentSurfaceManifest({
  ...siteIdentity,
  pages,
  sitemap: `${siteIdentity.url}/sitemap-index.xml`,
});
export const markdownRoutes = listMarkdownRoutes(markdownManifest);
export const handleMarkdownDocument = createAgentSurfaceHandler({ manifest: markdownManifest });
