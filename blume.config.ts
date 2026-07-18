import { defineConfig } from 'blume';

/**
 * Blume configuration for the CodeVetter docs site.
 *
 * The committed Markdown under docs/ is the source of truth. Blume is only
 * the presentation and search layer — generated output (.blume/) is
 * gitignored and never committed.
 *
 * See docs/development/docs.md for the documentation rules.
 */
export default defineConfig({
  title: 'CodeVetter docs',
  description:
    'Local-first knowledge system for CodeVetter — the AI desktop code review workbench for agent-generated code.',

  content: {
    root: 'docs',
    // Render committed Markdown as the docs site. Archive is excluded from
    // the rendered site (it is preserved for git history and reachable via
    // the repo, not as canonical pages). See docs/development/docs.md.
    include: ['**/*.md'],
    exclude: ['archive/**'],
  },

  theme: {
    accent: 'amber', // matches the product's warm amber accent (#d4a039)
    radius: 'md',
    mode: 'system',
  },

  search: {
    provider: 'orama',
  },

  markdown: {
    imageZoom: true,
    code: {
      icons: true,
      wrap: false,
    },
    codeBlocks: {
      theme: {
        light: 'github-light',
        dark: 'github-dark',
      },
    },
  },

  ai: {
    llmsTxt: true,
    mcp: {
      enabled: false,
      route: '/mcp',
    },
  },

  seo: {
    og: { enabled: true },
    sitemap: true,
    robots: true,
    structuredData: true,
  },

  deployment: {
    output: 'static',
    // No canonical docs site URL yet — set this when the docs site is
    // published. Leaving it unset keeps sitemap/feeds off until a site is
    // chosen.
    // site: "https://docs.codevetter.com",
  },
});
