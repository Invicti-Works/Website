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

/**
 * Apps sold through /marketplace.
 *
 * `stripeUrl` is a Stripe Payment Link. It is optional on purpose: an app can
 * be listed as "coming soon" before it is purchasable, and a card with no link
 * renders a "notify me" mailto rather than a dead Buy button. No Stripe key
 * ever touches this site -- a Payment Link is just a URL.
 */
const apps = defineCollection({
  loader: glob({ base: './src/content/apps', pattern: '**/*.md' }),
  schema: z.object({
    title: z.string(),
    /** Short positioning line, shown under the name. */
    tagline: z.string(),
    summary: z.string(),
    /** Display string, e.g. "$49" or "From $12/month". Not used for charging. */
    price: z.string().optional(),
    status: z.enum(['available', 'coming-soon']).default('coming-soon'),
    platforms: z.array(z.enum(['web', 'ios', 'android', 'api', 'desktop'])).default([]),
    /**
     * Stripe Payment Link. Leave empty until the app is purchasable.
     *
     * The `preprocess` is load-bearing: the CMS writes `stripeUrl: ''` for a
     * field an editor left blank, and a bare `.optional()` rejects the empty
     * string and fails the build. Treating '' as absent means "leave it blank
     * in the CMS" does the obvious thing instead of breaking the site.
     *
     * Regex rather than `.url()`, which is deprecated, and this is stricter
     * anyway: it requires https, which a Stripe payment link always is.
     */
    stripeUrl: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z
        .string()
        .regex(/^https:\/\/\S+$/, 'Must be the full https:// payment link from Stripe')
        .optional(),
    ),
    features: z.array(z.string()).default([]),
    order: z.number().default(100),
    draft: z.boolean().default(false),
  }),
});

export const collections = { team, apps };
