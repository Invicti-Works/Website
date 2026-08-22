import type { APIContext } from 'astro';

// Generated rather than static so the Sitemap line always points at the real
// domain from astro.config.mjs instead of a hardcoded one that can go stale.
export async function GET(context: APIContext) {
  const sitemapUrl = new URL('sitemap-index.xml', context.site ?? context.url.origin).href;

  const body = [
    'User-agent: *',
    'Allow: /',
    // The CMS is behind Cloudflare Access, but keep it out of the index too.
    'Disallow: /admin',
    '',
    `Sitemap: ${sitemapUrl}`,
    '',
  ].join('\n');

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
