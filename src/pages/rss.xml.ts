import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import site from '../data/site.json';
import { getNews } from '../lib/content';

export async function GET(context: APIContext) {
  const posts = await getNews();

  return rss({
    title: `${site.name} — News`,
    description: site.description,
    // `context.site` comes from `site` in astro.config.mjs.
    site: context.site ?? site.url,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.summary,
      pubDate: post.data.date,
      link: `/news/${post.id}/`,
      ...(post.data.author ? { author: post.data.author } : {}),
    })),
    customData: `<language>${site.locale.replace('_', '-')}</language>`,
  });
}
