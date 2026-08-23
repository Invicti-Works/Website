# Editing the website

No code required. Go to **<https://invicti.works/admin/>**, sign in, edit.

## How saving works

The editor commits your change straight into the GitHub repository. Cloudflare
sees the commit and rebuilds, so edits are live in **one to two minutes**. There
is no separate "publish to server" step.

Every version is kept in Git, so nothing is ever really lost.

## What you can edit

| Section | What it controls |
| --- | --- |
| **Team** | The founder cards at the foot of the home page. |
| **Marketplace apps** | The applications you sell. **The `/marketplace` page does not exist until there is one here** — adding your first app publishes the storefront, and removing the last one takes it away again. |
| **Site settings** | Company name, tagline, contact details, social links. Feeds the header, footer, contact page and Google results. The **Description** is also the sentence under the home-page headline. |

## Selling an app

**Marketplace apps → New App.** Nothing is public until you save one without
**Draft** ticked.

- **App name, Tagline, Summary** — the required fields. Tagline is the one-line
  pitch; Summary is the paragraph on the card.
- **Price** — shown exactly as you type it (`$49`, `From $12/month`). It is
  display text only; what a buyer is actually charged comes from Stripe.
- **Status** — *Available* or *Coming soon*. Coming soon adds a badge.
- **Platforms** — Web, iOS, Android, API, Desktop. Shown as pills.
- **Stripe payment link** — create a Payment Link in the Stripe dashboard and
  paste it here. **Leave it blank and the card shows "Notify me" instead of
  "Buy"**, which is how you list something before it is ready to sell.
- **Features** — a short bulleted list on the card.
- **Sort order** — lower numbers first.

No Stripe key is stored on the site, so there is nothing here that can leak.

> Taking payment and *delivering* the app are two different jobs. A Payment Link
> handles the money. How the buyer receives what they bought — a download, a
> licence key, a promo code — is worth deciding before your first sale.

## The Draft switch

Everything has one.

- **Draft on** — saved, but hidden from the live site.
- **Draft off** — live.

## Writing for the web

- **Summary is not decoration.** It appears on index pages, in Google results and
  in social previews. Write a real sentence.
- **Headings go in order.** The page title is the H1, so start in-page headings at
  H2 and only use H3 inside an H2. Screen-reader users navigate by heading and
  skipping a level breaks that.
- **Link text should describe the destination.** "Read the case study" works;
  "click here" does not, because someone tabbing through hears only link text.
- **Short paragraphs.** Three or four lines reads far better on a phone.

## Images

- **Alt text is required.** Describe what the image shows, for someone who cannot
  see it. "Dashboard showing weekly active users trending up" — not "screenshot".
- If an image is purely decorative, leave the image field empty rather than
  writing meaningless alt text.
- Resize to about **1600px wide** before uploading. Straight-from-phone and
  straight-from-Figma exports are often several MB and will make the page slow
  on mobile data.

**The build fails if an image has no alt text.** That is deliberate — a guard
rail, not a bug. Add the alt text and save again.

## If a save fails

In order of likelihood:

1. **Your session expired.** Reload `/admin/` and sign in again.
2. **You do not have write access to the repository.** Ask whoever administers
   the GitHub organization.
3. **The `main` branch requires pull-request review.** See `docs/SETUP.md`
   step 10 — the CMS commits directly, so branch protection and direct CMS saves
   cannot both be switched on.

## Where briefs from `/build` go

The problem solver at `/build` is not CMS content and nothing about it is edited
here. Each finished conversation emails a brief to `info@invicti.works` and
stores a copy in the site's database, so a brief is never lost even if the email
bounces.

Two things on that page *are* editable, by hand in `src/data/intake.json`
(not through the CMS — see the note in the file):

- `heading` and `summary` — the page title and the paragraph under it.
- `opener` — the first question the assistant asks.

Changing the opener changes the tone of every conversation that follows it, so
it is worth reading the whole thing back before you commit.
