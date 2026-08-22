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
| **Products** | The applications you sell. **Adding one here creates its own landing page** at `/products/<name>` and lists it on the home page and the products index. |
| **Team** | The founder cards on `/about`. |
| **Pages** | Standalone pages such as *About*. Adding a new one (e.g. *Privacy*) publishes it at `/<name>` automatically. |
| **News** | Posts on `/news`, newest first. Also drives the RSS feed. |
| **Site settings** | Company name, tagline, contact details, social links. Feeds the header, footer, contact page and Google results. |

## Adding a product

This is the main thing the site is built to do. **Products → New Product**, then:

- **Product name, Tagline, Summary** — the only genuinely required fields. Tagline
  is the one-line pitch; Summary is what shows on cards, in Google results and
  in the preview card when someone shares the link.
- **Category and Status** — drive the badges. `Live` and `In beta` get a coloured
  badge; the others stay neutral. The label text carries the meaning, so the
  badge still reads correctly for someone who cannot distinguish the colours.
- **Platforms** — Web, iOS, Android, API, Desktop. Shown as badges.
- **Sort order** — lower numbers first.
- **Features** — become the "What it does" checklist.
- **Pricing tiers** — *optional*. Leave the list empty and the whole pricing
  section is hidden, so a product with no price yet does not look unfinished.
- **Questions** — optional FAQ, also hidden when empty.
- **External links** — demo, product site, App Store, Google Play. Each becomes a
  button in the hero.
- **Page content** — the Markdown body: the problem, how it works, who it is for.

Set **Draft** while you are still writing. Draft products are invisible on the
live site.

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
   step 8 — the CMS commits directly, so branch protection and direct CMS saves
   cannot both be switched on.
