# Invicti.Works — website

Marketing and sales site for Invicti.Works: SaaS platforms and mobile
applications. Built with [Astro](https://astro.build), edited through
[Sveltia CMS](https://github.com/sveltia/sveltia-cms), deployed to
[Cloudflare Workers](https://developers.cloudflare.com/workers/static-assets/).

- **Editing content?** → [`docs/CONTENT.md`](docs/CONTENT.md)
- **Working on the site with someone else?** → [`CONTRIBUTING.md`](CONTRIBUTING.md)
- **Setting up hosting, the CMS login and Access?** → [`docs/SETUP.md`](docs/SETUP.md)
- **Colours and logo?** → [`docs/BRAND.md`](docs/BRAND.md)

> **Placeholder copy.** Every string marked `PLACEHOLDER` is a stand-in and must
> be replaced before launch — the tagline, the company description, both founder
> bios and the two example products. The logo artwork and brand colours are
> real.

## Adding a product

The site is built around this. Add a Markdown file to `src/content/products/`
(or use **Products → New Product** in the CMS) and you get:

- a landing page at `/products/<slug>` with hero, features, screenshots,
  optional pricing tiers and FAQ,
- a card on the home page and the products index,
- `SoftwareApplication` structured data for search engines,
- an entry in the sitemap.

No code change, no route to register. Pricing and FAQ sections hide themselves
when empty, so an unpriced product does not look unfinished.

## Running it locally

Requires Node 20.11 or newer.

```bash
npm install
npm run dev      # http://localhost:4321
```

Drafts are visible in `npm run dev` and excluded from production builds.

| Command | What it does |
| --- | --- |
| `npm run dev` | Local dev server with hot reload |
| `npm run check` | Type-check, and validate all content against its schema |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run cf:preview` | Build, then serve through the real Cloudflare runtime |
| `npm run deploy` | Manual deploy (normally unnecessary — see below) |

## How a change reaches the live site

```
edit (CMS or pull request) → commit on main → Cloudflare Workers Builds → live
```

Cloudflare builds from the repository directly, so there are **no deployment
secrets in GitHub**. GitHub Actions runs the type-check, content-schema
validation, build and a Wrangler config check on every pull request; it does not
deploy.

## Layout

```
brand/              Original logo artwork you uploaded (source, not served)
src/
  content/          Markdown, edited through the CMS
    products/         one file per application -> one landing page
    team/             founder bios
    pages/            about, and any standalone page added later
    news/
  content.config.ts Schemas -- content violating these fails the build
  data/site.json    Company details, also editable in the CMS
  layouts/          BaseLayout (html shell + SEO), PageLayout (title + body)
  components/       Header, Footer, Logo, Seo, ProductCard
  pages/            Routes
  lib/content.ts    Collection queries, sorting, draft filtering, labels
  styles/global.css Design tokens, base styles, marketing components
worker/
  index.js          Worker entry: OAuth paths, else hand back to assets
  cms-auth.js       GitHub OAuth flow, vendored from sveltia-cms-auth (MIT)
public/             Derived web assets, CMS, uploads
wrangler.jsonc      Cloudflare deployment config
```

## Notes for whoever works on this next

- **`wrangler.jsonc` has a `main`, but static pages never reach it.** Assets are
  served without invoking the Worker; only the two paths in
  `assets.run_worker_first` (`/oauth/authorize`, `/oauth/redirect`) run it, so
  ordinary traffic stays on the free unmetered asset tier. The Worker exists
  solely to sign CMS editors in — see `worker/index.js`.
- **Custom domains are commented out in `wrangler.jsonc`.** Cloudflare refused to
  create them over pre-existing DNS records, and that failure took the whole
  deploy down with it. Restore the block after clearing DNS — `docs/SETUP.md`
  step 4 has the exact error and procedure.
- **`not_found_handling` is `404-page`, not `single-page-application`.** This is a
  content site; SPA handling returns HTTP 200 for every bad URL and leaks
  soft-404s into the search index.
- **CMS field names must match `src/content.config.ts`.** If they drift the build
  fails loudly rather than publishing broken pages. Change both together.
- **`getStaticPaths` runs in its own module scope.** Constants declared in a page's
  frontmatter are *not* visible inside it — declare them in the function.
- **Brand orange is graphics-only.** 2.87:1 on white. See `docs/BRAND.md`.
- **The CMS bundle is not committed.** `scripts/vendor-cms.mjs` copies it out of
  `node_modules` at build time, so the version is pinned by `package-lock.json`
  and the editor loads no third-party script.
- **`Invicti.Works.code-workspace` references `../../../Downloads/invicti-mobile-template`**,
  a path that only exists on one machine. Harmless, but it will not resolve for
  anyone else who opens the workspace.
