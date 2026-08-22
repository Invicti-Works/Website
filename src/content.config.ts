import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

/**
 * Images live in `public/uploads/` because the CMS writes them there directly,
 * and are referenced as root-relative paths (`/uploads/foo.png`) rather than
 * through Astro's image pipeline -- that pipeline needs the file to exist under
 * `src/` at build time, which is not how CMS uploads arrive.
 */
const imageWithAlt = z.object({
  src: z.string(),
  alt: z.string().min(1, 'Alt text is required for accessibility'),
});

const seo = z
  .object({
    title: z.string().optional(),
    description: z.string().optional(),
    noindex: z.boolean().default(false),
  })
  .optional();

/**
 * Products are the applications Invicti.Works markets and sells. Adding one
 * in the CMS creates its landing page at /products/<slug> and lists it on the
 * home page and the products index -- no code change required.
 */
const products = defineCollection({
  loader: glob({ base: './src/content/products', pattern: '**/*.md' }),
  schema: z.object({
    title: z.string(),
    /** Short positioning line, shown under the name. */
    tagline: z.string(),
    /** One or two sentences for cards, search results and social previews. */
    summary: z.string(),
    category: z.enum(['saas', 'mobile', 'platform']),
    status: z.enum(['live', 'beta', 'in-development', 'concept']).default('in-development'),
    platforms: z.array(z.enum(['web', 'ios', 'android', 'api', 'desktop'])).default([]),
    /** Lower numbers sort first. */
    order: z.number().default(100),
    image: imageWithAlt.optional(),
    screenshots: z.array(imageWithAlt).default([]),
    /** Bulleted capability list rendered on the landing page. */
    features: z
      .array(
        z.object({
          title: z.string(),
          description: z.string().optional(),
        }),
      )
      .default([]),
    /** Optional pricing tiers. Omit entirely for products that are not priced yet. */
    pricing: z
      .array(
        z.object({
          name: z.string(),
          price: z.string(),
          period: z.string().optional(),
          description: z.string().optional(),
          includes: z.array(z.string()).default([]),
          highlighted: z.boolean().default(false),
        }),
      )
      .default([]),
    faq: z.array(z.object({ question: z.string(), answer: z.string() })).default([]),
    links: z
      .object({
        website: z.string().optional(),
        appStore: z.string().optional(),
        playStore: z.string().optional(),
        demo: z.string().optional(),
      })
      .default({}),
    /** Overrides the default "Talk to us" call to action on the landing page. */
    ctaLabel: z.string().optional(),
    draft: z.boolean().default(false),
    seo,
  }),
});

/** Founders and team, rendered on /about. */
const team = defineCollection({
  loader: glob({ base: './src/content/team', pattern: '**/*.md' }),
  schema: z.object({
    name: z.string(),
    role: z.string(),
    /** Short line used in listings; the Markdown body is the full bio. */
    summary: z.string(),
    order: z.number().default(100),
    /**
     * Headshot path under `public/`, e.g. `/team/josh-forman.jpg`. Deliberately
     * a bare path rather than the `{src, alt}` pair used elsewhere: the card
     * renders the person's name immediately beside the photo, so alt text here
     * would be read out twice by a screen reader. It is rendered `alt=""`.
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

const news = defineCollection({
  loader: glob({ base: './src/content/news', pattern: '**/*.md' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    summary: z.string(),
    author: z.string().optional(),
    image: imageWithAlt.optional(),
    draft: z.boolean().default(false),
    seo,
  }),
});

const pages = defineCollection({
  loader: glob({ base: './src/content/pages', pattern: '**/*.md' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    draft: z.boolean().default(false),
    seo,
  }),
});

export const collections = { products, team, news, pages };
