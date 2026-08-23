# Setup runbook

Everything in this file is a **"You do"** step — it needs a browser, an account,
or a payment method, so it cannot be done from the repository. Work through it
top to bottom; each step says what it unlocks.

Nothing here costs money except the domain. See [Costs](#costs) at the end.

---

## Before you start

Create the accounts with an **company email address that more than one
person can reach** (for example `admin@invicti.works` or a shared Google group)
— not a personal Gmail. If the domain and the Cloudflare account sit in one
individual's personal inbox, the company can lose control of its own
website when that person moves on. This is the single most common way small
companies lose their site, and it is very hard to undo later.

---

## 1. Cloudflare account

You already have one — `invicti.works` is in it. Two things to verify:

1. The account is owned by a **company email address more than one person can
   reach**, not a personal inbox. If it is not, change it now
   (**My Profile → Account**) rather than after the site is live.
2. Two-factor authentication is on: **My Profile → Authentication → Two-Factor
   Authentication**.

---

## 2. Confirm the domain

`invicti.works` is **already in your Cloudflare account**, so there is nothing
to buy or transfer. Two things worth checking before step 4:

1. **Overview → Status** shows **Active** (nameservers are pointed at
   Cloudflare). If it says *Pending*, the nameservers at the registrar have not
   propagated yet.
2. **DNS → Records** — note anything already pointing `invicti.works` or
   `www` somewhere else (a parking page, an old host). Adding the Worker
   custom domain in step 4 will conflict with an existing `A`/`AAAA`/`CNAME`
   record on the same name; delete the stale record first.

## 3. Deploy the website

This connects the repository so every merge to `main` publishes automatically.

1. In the dashboard, go to **Workers & Pages**.
2. **Create → Import a repository → Connect GitHub**.
3. Authorize the Cloudflare GitHub app. Choose the **Invicti-Works**
   organization and grant access to the **Website** repository.
   - An organization **owner** has to approve this. If you are not an owner,
     GitHub will queue a request for one.
4. Pick the `Website` repository, then set:

   | Field | Value |
   | --- | --- |
   | Project name | `websitebuild` (keep `name` in `wrangler.jsonc` in sync) |
   | Production branch | `main` |
   | Build command | `npm run build` |
   | Build output directory | `dist` |

5. **Save and Deploy.** The first build takes a couple of minutes.

> **Connect the repository to exactly one Worker.** Every connected Worker
> builds on every push, and each one posts its own check on every pull request.
> A second, misconfigured connection means a permanently red check that has
> nothing to do with your code.
6. You now have a live URL like `https://websitebuild.<subdomain>.workers.dev`.
   Open it and confirm the site loads.

No API token needs to be added to GitHub — Cloudflare pulls from the repository
itself, so there are no deployment secrets to manage or rotate.

---

## 4. The domain

**Done — the site is live on `invicti.works` and `www.invicti.works`.** Both are
declared as custom domains in `wrangler.jsonc`; the records that were blocking
them were deleted, and the deploy on `main` at 20:04 on 22 Aug 2026 attached the
domains and issued the certificates. Kept here as the record of what changed.

Cloudflare wrote its own records for the two hostnames when it attached them:

| Type | Name | Content | Proxied |
| --- | --- | --- | --- |
| `AAAA` | `invicti.works` | `100::` | yes |
| `AAAA` | `www.invicti.works` | `100::` | yes |

> **Do not delete those.** `100::` is Cloudflare's placeholder for a
> Worker-backed hostname — those records *are* the custom domain. They look
> exactly like what the DNS workflow was written to remove, so the workflow now
> excludes `100::` and `192.0.2.1` explicitly. Deleting them by hand in the
> dashboard would detach the domain and take the site down.

### What was actually on the domain

The earlier version of this table was wrong in three ways, and the way it was
wrong is worth keeping. It was written from **public DNS**, which cannot see
past a proxied record: every answer is a Cloudflare edge address, so the table
listed edge IPs as though they were the real targets, and inferred `AAAA`
records that did not exist. The authoritative list came from the zone itself, on
22 Aug 2026:

| Type | Name | Content | Action |
| --- | --- | --- | --- |
| `A` | `invicti.works` | `13.248.243.5` | **Deleted** |
| `A` | `invicti.works` | `76.223.105.230` | **Deleted** |
| `CNAME` | `www.invicti.works` | `invicti.works` | **Deleted** |
| `MX` ×3 | `invicti.works` | `mx1/mx2/mx3-usg2.ppe-hosted.com` | Kept |
| `TXT` | `invicti.works` | SPF, and the `NETORGFT…onmicrosoft.com` verification | Kept |
| `TXT` | `_dmarc` | `v=DMARC1; p=quarantine; …` | Kept |
| `CNAME` | `selector1/2._domainkey` | Microsoft DKIM | Kept |
| `CNAME` | `autodiscover`, `sip`, `lyncdiscover`, `msoid` | Microsoft 365 | Kept |
| `SRV` ×2 | `_sip._tls`, `_sipfederationtls._tcp` | Microsoft 365 | Kept |
| `CNAME` | `email`, `pay`, `_domainconnect` | GoDaddy | Kept |

Corrections against the old table: there were **no `AAAA` records at all**;
`www` was a **`CNAME` to the apex**, not `A`/`AAAA`; and the apex pointed at
`13.248.243.5` / `76.223.105.230` — GoDaddy website-builder addresses, not the
Cloudflare edge IPs the old table named. So the page previously served at
`invicti.works` was a GoDaddy builder site. If a GoDaddy plan is still being
billed for it, it is no longer serving anything.

> **Only three records blocked the custom domain**, and only `A`, `AAAA` and
> `CNAME` on the apex and `www` ever could. Everything else above is mail and
> subdomain infrastructure — deleting the `MX`, `TXT`, `SRV` or DKIM records
> would break email to `info@invicti.works`, the contact address published on
> this site.

### If it ever has to be done again

Run **Actions → Cloudflare DNS → Run workflow** with `mode: inspect` first; it
lists every record and marks which ones block the custom domain, changing
nothing. Then run `mode: delete-stale` with `confirm: DELETE`. It removes only
`A`, `AAAA` and `CNAME` on the apex and `www` — never `MX`, `TXT`, `SRV` or
`NS`, and never another subdomain.

The workflow reads `CLOUDFLARE_API_TOKEN` from **Settings → Secrets and
variables → Actions**, scoped to this zone only: Zone → Zone → Read, and
Zone → DNS → Edit. Doing it by hand in **DNS → Records** works just as well and
needs no token.

### Get the ordering right

This is the part that bites. Cloudflare will not create a custom domain over a
pre-existing DNS record, and because the failure is in the *trigger* update, it
fails the **entire** deploy — the site stops updating, not just the domain:

```
Hostname 'invicti.works' already has externally managed DNS records
(A, CNAME, etc). Delete them first or try a different hostname. [code: 100117]
No targets deployed for websitebuild
```

So: **delete the records first, then land the `routes` block.** It happened in
the other order here — #9 merged at 19:50 and the records went at 19:54 — and
that deploy uploaded the Worker but attached no domain, needing a re-run once
the zone was clear.

> Only a push to `main` applies routes. Branch builds run
> `wrangler versions upload`, which uploads a version without touching them, so
> the change sits safely on a branch until it is merged.

The site also stays reachable at `https://websitebuild.erica-936.workers.dev` —
`workers_dev` and `preview_urls` are both enabled in `wrangler.jsonc`, so there
is always a working URL and per-branch previews.

## 5. CMS sign-in

The CMS commits to GitHub as the signed-in person, so it needs an OAuth flow.
**That flow is already built and lives in this repository** — `worker/cms-auth.js`,
vendored from [sveltia-cms-auth](https://github.com/sveltia/sveltia-cms-auth)
(MIT) and served by our own Worker at `/oauth/authorize` and `/oauth/redirect`.

That means no second Worker to deploy and no separate service to keep alive.
Two things remain, and both need a browser.

### 5a. Register the GitHub OAuth app

1. <https://github.com/organizations/Invicti-Works/settings/applications> →
   **New OAuth App**. Register it under the *organization*, not your personal
   account, so it survives you changing roles.
2. Fill in:

   | Field | Value |
   | --- | --- |
   | Application name | `Invicti.Works CMS` |
   | Homepage URL | `https://invicti.works` |
   | Authorization callback URL | `https://invicti.works/oauth/redirect` |

   The callback URL must match exactly, including the path.
3. Register, then **Generate a new client secret**. Copy the **Client ID** and
   the **Client Secret** now — the secret is shown once.

### 5b. Give the Worker its credentials

**Read this before typing anything into the dashboard.** There are two kinds of
variable and they live in different places:

| Name | Where it goes | Why |
| --- | --- | --- |
| `GITHUB_CLIENT_ID` | `wrangler.jsonc`, under `vars` | Plain text — the dashboard cannot hold it (see below) |
| `ALLOWED_DOMAINS` | `wrangler.jsonc`, under `vars` | Same |
| `GITHUB_CLIENT_SECRET` | Dashboard, as **Secret (encrypt)** | Encrypted variables are never deleted by a deploy |

> **A plain-text variable typed into the dashboard does not survive.**
> `wrangler deploy` *deletes every plain var on the Worker that is not in the
> configuration file*, and Workers Builds runs it on every push to `main`. So a
> variable added in the dashboard is gone by the next build. This is
> [documented behaviour](https://developers.cloudflare.com/workers/wrangler/configuration/#source-of-truth),
> and it is exactly what made sign-in fail with `MISCONFIGURED_CLIENT` after the
> credentials had apparently been set correctly.
>
> **Secrets are the exception** — Wrangler never deletes an encrypted variable —
> which is why the client *secret* belongs in the dashboard and the client *ID*
> does not.

A GitHub OAuth **client ID is public by design**: it travels in the authorize
URL and every visitor who signs in can read it. Only the secret is secret, so
keeping the ID in version control is safe and keeps the configuration
reproducible.

Set the secret in Cloudflare → **Workers & Pages → websitebuild → Settings →
Variables and Secrets**, then redeploy — variables only reach a running Worker
on the next deploy.

`ALLOWED_DOMAINS` is optional but you should set it. Without it the sign-in
endpoint will mint tokens for a popup opened by any site, and the handler skips
its origin check on the way back.

Redeploy so the variables take effect — variables only reach a running Worker on
the next deploy, so nothing changes until you do. Then open
<https://invicti.works/admin/> and sign in with GitHub.

Step 4 is done, so the prerequisite for this is already met: `base_url` in
`public/admin/config.yml` points at `https://invicti.works`, and the sign-in
popup only resolves once that domain is attached.

### 5c. What you should see

Clicking **Sign in with GitHub** opens a small popup asking you to authorise
*Invicti.Works CMS*. Approve it, the popup closes itself, and the CMS loads with
**Team**, **Marketplace apps** and **Site settings** down the left. Saving there
commits straight to `main`, and Cloudflare deploys the change within a minute or
two.

### If it does not work

| What you see | What it means |
| --- | --- |
| `redirect_uri_mismatch` from GitHub | The callback URL on the OAuth app is not exactly `https://invicti.works/oauth/redirect`. No trailing slash, `https` not `http`. |
| "OAuth is not configured" or a 500 | `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` are missing, misspelled, or the Worker has not been redeployed since you added them. |
| Popup opens, then nothing happens | `ALLOWED_DOMAINS` does not contain `invicti.works`, so the handler refuses to post the token back to the page. |
| "Not Found" at `/admin/` | The deploy has not finished. Check the build in the Cloudflare dashboard. |
| Signs in, but saving fails | The account you signed in with does not have write access to `Invicti-Works/Website`. |

The Client Secret is shown **once**. If you lose it, generate a new one on the
same OAuth app and update the Worker variable — you do not need to start over.

## 6. The contact form

The "Find your solution" form on the home page posts to `/api/contact`, handled
by our own Worker (`worker/contact.js`). It emails the message to
`info@invicti.works` through [Resend](https://resend.com).

**It is safe to ship before this is set up.** With no API key the endpoint
answers `503`, and the page falls back to opening the visitor's email client
with every answer already filled in — so a message is never silently lost. What
you gain by finishing this is that submitting works without leaving the page.

### 6a. Resend

1. Create an account at <https://resend.com> — the free tier covers 3,000
   emails a month, which is far more than a contact form will ever send.
2. **Domains → Add Domain** → `invicti.works`.
3. Resend gives you DNS records to add in Cloudflare. Add them exactly as shown.

   > These are **additional** records for *sending*. They do not touch the `MX`
   > records that deliver your incoming Microsoft 365 mail. Resend will ask for
   > a DKIM `TXT` record and usually an SPF `TXT` on a subdomain such as
   > `send.invicti.works` — adding a second SPF record on the apex would break
   > your existing one, so keep it on the subdomain Resend names.

4. Wait for the domain to verify, then **API Keys → Create API Key** with
   **Sending access** only. Copy it — it is shown once.

### 6b. Give the Worker the key

Only one thing goes in the dashboard, and it is a secret:

Cloudflare → **Workers & Pages → websitebuild → Settings → Variables and
Secrets** → add `RESEND_API_KEY` as a **Secret (encrypt)**.

`CONTACT_TO` and `CONTACT_FROM` are already set in `wrangler.jsonc` under
`vars`, because a plain-text variable typed into the dashboard is deleted by the
next deploy — see the warning in step 5b. Change them there, not in the
dashboard.

`CONTACT_FROM` must be on the domain you verified in 6a, or Resend rejects the
send. Redeploy so the variables take effect, then submit the form once and check
the inbox.

Replies work as you would expect: the email's reply-to is set to the person who
filled the form in, so hitting reply writes to them, not to us.

---

## 7. The marketplace

`/marketplace` **does not exist yet, on purpose.** The page is built only when
the `apps` collection has at least one published entry — no page, no navigation
link, no sitemap entry until then. Adding your first app in the CMS publishes
the storefront on the next deploy; deleting the last one takes it away again.

Selling an app takes one thing from Stripe:

1. Stripe dashboard → **Payment links → New** → create a link for the app.
2. Copy the link and paste it into the app's **Stripe payment link** field in
   the CMS.

That is the whole integration. A Payment Link is just a URL, so **no Stripe key
is ever stored on this site** and there is nothing to rotate or leak. Leave the
field blank and the card shows "Notify me" instead of "Buy", which is how you
list something before it is ready.

> This handles taking the money. It does not handle **delivering** the app —
> download links, licence keys or App Store promo codes. Stripe can send a
> receipt with a link in it for simple cases; anything more needs a decision
> about fulfilment, and is worth having before the first sale rather than after.

---

## 8. Lock the CMS behind Cloudflare Access

The editor lives at a public URL, so put a login in front of it. The Zero Trust
free plan covers up to 50 users.

1. Go to **Zero Trust** in the sidebar (it will ask you to pick a team name the
   first time — any short name works, e.g. `invicti`). Choose the **Free** plan.
2. **Access → Applications → Add an application → Self-hosted.**
3. Configure:

   | Field | Value |
   | --- | --- |
   | Application name | `Website CMS` |
   | Session duration | 24 hours |
   | Domain | `invicti.works` |
   | Path | `admin` |

4. Add a policy: **Action `Allow`**, rule **Emails** → list the editors'
   addresses. (Or **Emails ending in** `@invicti.works` if everyone has an
   org address.)
5. Under **Login methods**, **One-time PIN** is enabled by default and needs no
   identity provider — editors get a code by email. That is enough to start.

**What this does and does not do.** Access controls who can *load* the editor.
Saving still requires the signed-in person to have write access to the GitHub
repository, so there are two independent gates. Access is not a substitute for
keeping repository permissions tight — someone with repo write access can commit
regardless of Access. Grant both deliberately.

---

## 9. Add Josh

**On GitHub:**

1. <https://github.com/orgs/Invicti-Works/people> → **Invite member**.
2. Repository → **Settings → Collaborators and teams** → give them **Write**.
3. Add both of your usernames to `.github/CODEOWNERS` so pull requests
   automatically request a review.
4. Point them at [`CONTRIBUTING.md`](../CONTRIBUTING.md) — it covers the three
   ways to work on the site and how to avoid stepping on each other.

**On Cloudflare:**

1. **Manage Account → Members → Invite**.
2. Note: granular roles are an Enterprise feature, so on the free plan they will
   effectively be an **Administrator** with access to DNS. Only invite them here
   if you are comfortable with that; they do **not** need a Cloudflare account
   just to edit content — for that, adding their email to the Access policy in
   step 8 is enough.

**In the CMS:** add their email to the Access policy from step 8.

---

## 10. Protect the `main` branch

So neither of you can accidentally publish straight to the live site.

1. Repository → **Settings → Rules → Rulesets → New branch ruleset**.
2. Name it `main protection`, set **Enforcement status** to **Active**.
3. Target branches → **Include default branch**.
4. Enable **Require a pull request before merging** with **1** required
   approval, and **Require status checks to pass** → select the
   `Type-check and build` check from CI.

Rulesets are free on this repository because it is public.

> One consequence worth knowing: the CMS commits directly to `main`. If you turn
> on required approvals, CMS saves will be **blocked**. Either leave `main`
> unprotected and rely on CI plus the draft flag, or set the CMS `branch:` in
> `public/admin/config.yml` to a `content` branch and merge that by pull
> request. Pick one deliberately — this is the only place where the two halves
> of this setup interact.

---

## 11. Recommended extras

**Analytics (free, no cookie banner).** Worker → **Settings → Web Analytics →
Enable**. Cloudflare Web Analytics does not use cookies or track people across
sites, so it does not trigger a consent requirement in most jurisdictions.

**Email on the domain (free forwarding).** **Email → Email Routing → Enable**,
then forward `info@invicti.works` to a real inbox. This only *receives*.
Sending from that address needs Google Workspace (free for verified nonprofits
via Google for Nonprofits) or a service like Resend.

**Contact and lead-capture forms.** Done — see step 6. `worker/contact.js`
receives `/api/contact` and emails it on through Resend, and `worker/intake.js`
receives `/api/intake` for the problem solver at `/build` (step 12). Both reply
with JSON to a `fetch` and a real HTML page to a browser that posted the form
directly, so neither depends on JavaScript.

---

---

## 12. The problem solver (`/build`)

The AI intake at `/build` interviews a visitor about something going wrong and
produces a structured build brief. It stores briefs in D1 and emails them
through the Resend setup from step 6.

It is safe to deploy before any of this is done: with no `ANTHROPIC_API_KEY` the
route returns 503 and the page shows a plain form that still reaches your inbox.

### 12a. Anthropic

1. Go to <https://console.anthropic.com> and add billing. **There is no free
   tier** — you are billed from the first token.
2. Create a **Workspace** called `invicti-intake`. Do not use the default one:
   the whole point is that the limit below cannot be spent by anything else.
3. On that workspace set a **monthly spend limit of $25** and a usage alert at
   50%. This is the real guardrail. The daily fuse in `wrangler.jsonc` is code,
   and code has bugs.
4. Create an API key **scoped to that workspace**, and paste it into the Worker
   as an encrypted secret named `ANTHROPIC_API_KEY` (same place as step 5b —
   Workers & Pages → `websitebuild` → Settings → Variables and Secrets → **Encrypt**).

Roughly $0.15–0.30 per completed brief on `claude-opus-5`. If that ever
matters, change `INTAKE_MODEL` in `wrangler.jsonc` to `claude-sonnet-5`, which
is about half, or `INTAKE_EFFORT` to `low`. Both are one-line changes.

### 12b. Turnstile

Cloudflare's bot check. Free and unmetered.

1. Cloudflare dashboard → **Turnstile** → **Add site**.
2. Domain `invicti.works`. Widget mode **Managed**.
3. Copy the **site key** into `turnstileSiteKey` in `src/data/intake.json`. It
   is public by design — the browser has to send it — exactly like
   `GITHUB_CLIENT_ID`.
4. Paste the **secret key** into the Worker as encrypted `TURNSTILE_SECRET_KEY`.

Leave both blank and the widget simply is not rendered and the check is skipped.
The honeypot, the per-IP limit and the daily fuse still apply.

### 12c. The salt

Generate 32 random characters and add them as encrypted `INTAKE_SALT`:

```
openssl rand -hex 16
```

It is used to hash visitor IP addresses for rate limiting. The raw address is
never stored. With no salt set, no IP is hashed and no per-IP counting happens
— the route still works.

### 12d. The database

```
npx wrangler d1 create invicti-briefs
```

In `wrangler.jsonc`, **uncomment the `d1_databases` block** and paste in the
`database_id` it printed. The id is an identifier, not a secret — it is useless
without account credentials.

The block ships commented out because Cloudflare validates bindings *before* it
builds: a `database_id` that is not a real UUID fails the deploy in under a
second with nothing compiled, and `wrangler deploy --dry-run` does not catch it
because a dry run never talks to the account. `npm test` checks the id is a
UUID once the block is live.

Then apply the schema:

```
npm run db:migrate
```

> **Migrations are not applied by deploying.** Neither `wrangler deploy` nor
> Workers Builds runs them. Code that expects a table an un-migrated database
> does not have fails at runtime, in front of a visitor, rather than at deploy
> time. **Run `npm run db:migrate` before pushing code that needs a new
> migration**, not after. This is the same species of trap as the plain-vars
> one in step 5b.

Free tier is 5 GB of storage, 5 million row reads a day and 100,000 writes.
Intake will use a rounding error of that.

### 12e. The sender address

`BRIEF_FROM` in `wrangler.jsonc` is `briefs@invicti.works`. Any address on a
domain verified in Resend works, and `invicti.works` was verified in step 6a, so
there is nothing extra to do — but if you change it to another domain you must
verify that one too or every brief email silently fails.

### 12f. Check it

1. Visit `/build`. You should get a conversation, and a panel on the right that
   fills in as you answer.
2. Turn JavaScript off and reload. You should get a plain form instead. Submit
   it — the reply is a rendered confirmation page and the brief still arrives.
3. Check the Worker logs for `cache_read_input_tokens`. If it is zero on the
   second turn of a conversation, prompt caching is not hitting and the bill is
   roughly four times what it should be.
4. `npx wrangler d1 execute invicti-briefs --remote --command "SELECT id, headline, completeness FROM briefs"`

### 12g. Privacy

The intake stores what visitors write. There is a note under the composer
saying so, and saying the conversation is processed by Anthropic. Before
`/build` is linked from anywhere public-facing beyond the home page, write a
short `/privacy` page covering what is stored, who processes it, and how long
it is kept — and link it from that note.

## Costs

| Item | Cost |
| --- | --- |
| Cloudflare Workers (static assets) | $0 — asset requests are free and unmetered |
| Cloudflare Workers Builds (CI/CD) | $0 on the free tier |
| Cloudflare Access / Zero Trust | $0 up to 50 users |
| Cloudflare Web Analytics | $0 |
| Cloudflare Email Routing | $0 |
| Sveltia CMS | $0, open source, self-hosted from this repository |
| GitHub (public repo, Actions, rulesets) | $0 |
| **Domain** (`invicti.works`, already registered) | renewal only, ~$20–30/year for a `.works` TLD |

The one thing that would move you off the free tier is adding server-side code
(a contact-form Worker, for instance) that exceeds 100,000 requests per day.
A brochure site will not come close.

---

## Quick reference

| Thing | Where |
| --- | --- |
| Live site | <https://invicti.works> |
| Content editor | `https://invicti.works/admin/` |
| Repository | <https://github.com/Invicti-Works/Website> |
| Deploy logs | Cloudflare → Workers & Pages → your Worker → Deployments |
| CI results | GitHub → Actions |
