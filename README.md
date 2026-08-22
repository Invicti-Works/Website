# Invicti.Works — website

Marketing and sales site for Invicti.Works: SaaS platforms and mobile
applications. Built with [Astro](https://astro.build), edited through
[Sveltia CMS](https://github.com/sveltia/sveltia-cms), deployed to
[Cloudflare Workers](https://developers.cloudflare.com/workers/static-assets/).

- **Editing content?** → [`docs/CONTENT.md`](docs/CONTENT.md)
- **Working on the site with someone else?** → [`CONTRIBUTING.md`](CONTRIBUTING.md)
- **Setting up hosting, the CMS login and Access?** → [`docs/SETUP.md`](docs/SETUP.md)
- **Colours and logo?** → [`docs/BRAND.md`](docs/BRAND.md)

## What the site is

Two public pages. The home page says what we engineer, carries the "Find your
solution" enquiry form, and ends with the founder bios. `/contact` is a
paragraph and an email address.

`/marketplace` is a third page that **does not exist until it has something to
sell.** It is built only when the `apps` collection has a published entry, so
there is no empty storefront and no navigation link pointing at one. Adding the
first app in the CMS publishes it; removing the last one takes it away. Paste a
Stripe Payment Link into an app to make it purchasable — see `docs/SETUP.md`
step 7.

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
| `npm test` | Test the Worker's enquiry endpoint |
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
    team/             founder bios, shown at the foot of the home page
    apps/             marketplace listings -- an entry here creates /marketplace
  content.config.ts Schemas -- content violating these fails the build
  data/site.json    Company details, also editable in the CMS
  layouts/          BaseLayout (html shell + SEO), PageLayout (title + body)
  components/       Header, Footer, Logo, Seo, HeroArt, SolutionFinder
  pages/            Routes
  lib/content.ts    Collection queries, sorting, draft filtering
  styles/global.css Design tokens, base styles, marketing components
worker/
  index.js          Worker entry: OAuth and /api/enquiry, else back to assets
  cms-auth.js       GitHub OAuth flow, vendored from sveltia-cms-auth (MIT)
  enquiry.js        The "Find your solution" form handler
  enquiry.test.mjs  Its tests -- `npm test`, and CI runs them
public/             Derived web assets, CMS, uploads
wrangler.jsonc      Cloudflare deployment config
```

## Notes for whoever works on this next

- **`wrangler.jsonc` has a `main`, but static pages never reach it.** Assets are
  served without invoking the Worker; only the paths in
  `assets.run_worker_first` (`/oauth/authorize`, `/oauth/redirect`,
  `/api/enquiry`) run it, so ordinary traffic stays on the free unmetered asset
  tier. The Worker signs CMS editors in and receives the enquiry form — see
  `worker/index.js`.
- **`astro check` does not cover `worker/`.** It only looks at `src/`, so the
  Worker's logic is tested by `npm test` instead. A syntax error there breaks
  CMS sign-in *and* the enquiry form together, since they share one entry point.
- **The enquiry form degrades rather than failing.** No `RESEND_API_KEY` yet, a
  5xx, a network error — the page falls back to a prefilled `mailto` so the
  lead still arrives. This is what makes it safe to ship ahead of `docs/SETUP.md`
  step 6.
- **Optional CMS string fields must tolerate `''`.** The CMS writes an empty
  string for a field an editor cleared, and a bare `.optional()` rejects that
  and fails the build. See `stripeUrl` in `src/content.config.ts` for the
  `preprocess` that handles it.
- **Changing the custom domains in `wrangler.jsonc` is ordering-sensitive.**
  Cloudflare will not create one over a pre-existing DNS record, and because the
  failure is in the trigger update it fails the *whole* deploy — the site stops
  updating, not just the domain. Clear the conflicting record **before** the
  `routes` change reaches `main`. `docs/SETUP.md` step 4 has the error, the
  workflow that clears records safely, and what the zone actually held.
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
