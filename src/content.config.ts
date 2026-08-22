import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

/** Founders, rendered at the foot of the home page. */
const team = defineCollection({
  loader: glob({ base: './src/content/team', pattern: '**/*.md' }),
  schema: z.object({
    name: z.string(),
    role: z.string(),
    /** Short line under the name; the Markdown body is the bio itself. */
    summary: z.string(),
    order: z.number().default(100),
    /**
     * Headshot path under `public/`, e.g. `/team/josh-forman.jpg`. Deliberately
     * a bare path rather than a `{src, alt}` pair: the card renders the
     * person's name immediately beside the photo, so alt text here would be
     * read out twice by a screen reader. It is rendered `alt=""`.
     * Derived from brand/photos/ by scripts/derive-brand-assets.py.
     */
    image: z.string().optional(),
    links: z
      .object({
        linkedin: z.string().optional(),
        github: z.string().optional(),
        email: z.string().optional(),
      })
      .default({}),
    draft: z.boolean().default(false),
  }),
});

export const collections = { team };
