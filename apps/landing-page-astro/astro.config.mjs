// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import react from '@astrojs/react';
import tailwind from '@tailwindcss/vite';

// CodeVetter landing — pure static Astro.
//
// Mirrors the fleet web stack standard (../../../AGENTS.md → "Fleet web
// stack standard"):
//   - output: 'static' (no SSR adapter; this is a marketing page)
//   - build.format: 'file' so slashless canonical URLs map directly to
//     `/faq.html` instead of redirecting to `/faq/` on Cloudflare Pages.
//   - build.inlineStylesheets: 'auto' — shared content-hashed CSS is external and
//     immutably cached under /_astro/; only tiny page CSS is inlined.
//   - Lightning CSS as both transformer and minifier.
//
// Tailwind v4 via the official `@tailwindcss/vite` plugin. The single
// `globals.css` entrypoint is imported from `Layout.astro`.
export default defineConfig({
  site: 'https://codevetter.com',
  output: 'static',
  trailingSlash: 'never',
  build: {
    format: 'file',
    inlineStylesheets: 'auto',
  },
  integrations: [
    react(),
    sitemap({
      customPages: ['https://codevetter.com/docs/'],
      serialize(item) {
        if (item.url === 'https://codevetter.com/xray/') {
          item.url = 'https://codevetter.com/xray';
        }
        return item;
      },
    }),
  ],
  vite: {
    plugins: [tailwind()],
    css: { transformer: 'lightningcss' },
    build: { cssMinify: 'lightningcss' },
  },
});
