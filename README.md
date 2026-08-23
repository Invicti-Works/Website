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

Two public pages. The home page says what we engineer -- mobile and web
applications, for individuals and organizations alike -- carries the "Find your
solution" contact form, and ends with the founder bios. `/contact` is a
paragraph and an email address.

The header is the logo alone. Both calls to action live in the hero, and the
footer carries the full list of destinations.

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
| `npm test` | Test the Worker's contact endpoint |
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
  data/intake.json  Public config for /build -- Turnstile site key, copy
  layouts/          BaseLayout (html shell + SEO), PageLayout (title + body)
  components/       Header, Footer, Logo, Seo, SolutionFinder, ToolBrief
  pages/            Routes -- build.astro (the problem solver) and
                    console/ (the founders' dashboard, Access-gated)
  lib/content.ts    Collection queries, sorting, draft filtering
  styles/global.css Design tokens, base styles, form fields, marketing components
worker/
  index.js          Worker entry: OAuth, /api/contact, /api/intake,
                    /api/console/*, else back to assets
  cms-auth.js       GitHub OAuth flow, vendored from sveltia-cms-auth (MIT)
  contact.js        The "Find your solution" form handler
  intake.js         The /build conversation: one model call per turn
  intake-prompt.js  Its system prompt, tool definition and model pricing
  intake-store.js   D1 persistence, plus an in-memory sibling for the tests
  brief-schema.js   The build brief: schema, validator, connector catalog,
                    and the no-JS form -- shared by the Worker and Astro
  console.js        The founders' dashboard API, behind Cloudflare Access
  lib/access.js     Access assertion verification -- fails closed, by design
  lib/github.js     The GitHub App that opens build work in the private repo
  lib/http.js       JSON-or-HTML replies, shared by the API routes
  lib/email.js      Resend, shared by the API routes
  *.test.mjs        Tests -- `npm test`, and CI runs them
migrations/         D1 schema. NOT applied by deploy -- `npm run db:migrate`
public/             Derived web assets, CMS, uploads
wrangler.jsonc      Cloudflare deployment config
```

## Notes for whoever works on this next

- **The console fails closed; the intake fails open. That asymmetry is on
  purpose.** `worker/lib/access.js` rejects everything when `ACCESS_TEAM_DOMAIN`
  or `ACCESS_AUD` is unset, because the worst case behind `/console` is
  publishing a stranger's business briefs. The Turnstile check in
  `worker/intake.js` does the opposite and lets requests through when
  unconfigured, because the worst case there is a bot wasting a few tokens.
  Don't "fix" either one to match the other.
- **Cloudflare Access must cover `api/console` as well as `console`.** Gating
  only the page leaves the API — which is where the briefs actually are — open
  to anyone who guesses the URL. The Worker re-verifies the assertion anyway, so
  a mistake here is caught rather than fatal; that is the whole reason the
  second check exists.
- **Build specs go to a private repo. This one is public.** `TOOLFORGE_REPO`
  must never point back at `Invicti-Works/Website`, and `npm test` fails if it
  does.
- **`GH_APP_PRIVATE_KEY` is PKCS#8, not the PKCS#1 GitHub hands you.** Convert
  it with `openssl pkcs8 -topk8 -nocrypt` (docs/SETUP.md 13c). `worker/lib/github.js`
  detects the wrong format and says so, because otherwise this surfaces as an
  opaque `DataError` long after anyone remembers the format mattered.
- **`/console/brief/` takes its id from a query parameter, not a route.** Ids
  only exist in D1 and the site builds statically, so `getStaticPaths` cannot
  enumerate them.
- **D1 migrations are not applied by deploying.** Neither `wrangler deploy` nor
  Workers Builds runs them. Code that expects a table an un-migrated database
  does not have fails at *runtime*, in front of a visitor, rather than at deploy
  time. Run `npm run db:migrate` **before** pushing code that needs a new
  migration. Same species of trap as the plain-vars one below, and it bites in a
  worse place.
- **`/api/intake` costs real money, so it fails closed in four places.** A
  honeypot and the daily spend fuse both short-circuit before any model call; a
  Turnstile check and a per-IP session count gate new conversations. The fuse
  reads `ai_usage` in D1 and is capped by `INTAKE_DAILY_BUDGET_CENTS` in
  `wrangler.jsonc`. None of that replaces the monthly spend limit on the
  Anthropic workspace — that one is the guard a bug in our code cannot bypass.
  See `docs/SETUP.md` step 12.
- **Every intake failure that is not the visitor's fault must stay a 503 or a
  502, never a 500.** `src/components/ToolBrief.astro` reads any non-400 as
  "ours, not theirs" and falls back to the plain form. A 500 would too, but the
  distinction is what lets the route ship before `ANTHROPIC_API_KEY` exists.
- **The intake transcript lives in D1, never in the browser.** A
  client-supplied transcript is attacker-supplied: it would make `/api/intake`
  a free, prompt-injectable LLM proxy on our card. `worker/intake.js` ignores
  anything transcript-shaped in the request body, and there is a test for it.
- **Prompt caching on the intake is load-bearing, and a miss is silent.** The
  ~5k-token system prefix is re-sent every turn; without a cache hit a long
  conversation costs about four times what it should. If you edit
  `worker/intake-prompt.js`, nothing per-request may be interpolated into
  `SYSTEM_PROMPT` — the brief so far deliberately travels in `messages`, after
  the cache breakpoint. Check `cache_read_input_tokens` in the Worker logs.
- **The Turnstile *site* key lives in `src/data/intake.json`, not
  `src/data/site.json`.** `site.json` is a Sveltia CMS collection and the CMS
  rewrites the whole file from the fields it knows about, so a key it has never
  heard of is silently dropped the next time anyone edits site settings.
- **Form field styles are in `global.css`, not scoped to a component.** Two
  forms use `.field`, `.form-status` and `.form-trap` now; a scoped copy in
  either would drift.
- **`wrangler.jsonc` has a `main`, but static pages never reach it.** Assets are
  served without invoking the Worker; only the paths in
  `assets.run_worker_first` (`/oauth/authorize`, `/oauth/redirect`,
  `/api/contact`) run it, so ordinary traffic stays on the free unmetered asset
  tier. The Worker signs CMS editors in and receives the contact form — see
  `worker/index.js`.
- **A plain-text variable set in the Cloudflare dashboard does not survive.**
  `wrangler deploy` deletes every plain var not present in `wrangler.jsonc`, and
  Workers Builds runs it on every push — so dashboard-set vars last until the
  next build. Put them in `vars` in `wrangler.jsonc`. **Secrets are the
  exception**: an encrypted variable is never deleted, so `GITHUB_CLIENT_SECRET`
  and `RESEND_API_KEY` belong in the dashboard and must not go in the config.
- **`astro check` does not cover `worker/`.** It only looks at `src/`, so the
  Worker's logic is tested by `npm test` instead. A syntax error there breaks
  CMS sign-in *and* the contact form together, since they share one entry point.
- **The contact form degrades rather than failing.** No `RESEND_API_KEY` yet, a
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
