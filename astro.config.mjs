// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

import site from './src/data/site.json' with { type: 'json' };

// https://astro.build/config
export default defineConfig({
  // `site` drives canonical URLs, the sitemap and RSS. It is read from
  // src/data/site.json so editors can change it in the CMS without touching config.
  site: site.url,
  trailingSlash: 'ignore',
  build: {
    // Emit `about/index.html` rather than `about.html` so URLs work identically
    // on Cloudflare's default `auto-trailing-slash` asset handling.
    format: 'directory',
  },
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/admin'),
    }),
  ],
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'hover',
  },
});
