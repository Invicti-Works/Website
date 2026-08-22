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

**Blocked on one manual step, and it is blocking deploys too.**

`invicti.works` and `www.invicti.works` were declared as custom domains in
`wrangler.jsonc`. The deploy failed:

```
Hostname 'invicti.works' already has externally managed DNS records
(A, CNAME, etc). Delete them first or try a different hostname. [code: 100117]
No targets deployed for websitebuild
```

Cloudflare will not create a custom domain on a hostname that already has DNS
records. Worse, because the trigger update failed, **the whole deploy failed**
— so the site content stopped updating too. The `routes` block has been
commented out of `wrangler.jsonc` to get deploys working again.

### What is actually on the domain

Queried against public DNS on 22 Aug 2026:

| Name | Type | Value | Action |
| --- | --- | --- | --- |
| `invicti.works` | `A` | `172.67.216.24`, `104.21.53.178` | **Delete** |
| `invicti.works` | `AAAA` | `2606:4700:3031::6815:35b2`, `2606:4700:3034::ac43:d818` | **Delete** |
| `www.invicti.works` | `A` | same two addresses | **Delete** |
| `www.invicti.works` | `AAAA` | same two addresses | **Delete** |
| `invicti.works` | `MX` | `mx1/mx2/mx3-usg2.ppe-hosted.com` | **KEEP** |
| `invicti.works` | `TXT` | `NETORGFT21013219.onmicrosoft.com` | **KEEP** |
| `invicti.works` | `TXT` | `v=spf1 include:_spf-usg2.ppe-hosted.com include:secureserver.net ~all` | **KEEP** |

> **Do not delete the `MX` or `TXT` records.** They route and authenticate mail
> for the domain — Microsoft 365 behind Proofpoint filtering. Removing them
> breaks email to `info@invicti.works`, which is the contact address published
> on this site. They do not block the custom domain; only `A`, `AAAA` and
> `CNAME` on the apex and `www` do.

Two things the public view cannot tell you, because those `A`/`AAAA` answers are
Cloudflare edge addresses — the records are proxied, so the real target is
hidden:

- **What the records actually point at.** The dashboard shows the true value.
  Expect one or two rows per name, not the four addresses above.
- **Whether anything is being served there today.** If a site or landing page is
  currently live at `invicti.works`, deleting these replaces it with this one.
  Check before deleting.

### Finishing the job

1. Cloudflare → **DNS → Records**.
2. Delete the `A` and `AAAA` records on `invicti.works` and `www` per the table.
3. Uncomment the `routes` block in `wrangler.jsonc` (it is left in the file with
   the exact lines to restore) and merge.
4. The next deploy creates the custom domains, issues the certificates and
   writes the DNS records itself.

Until then the site is reachable at `https://websitebuild.<subdomain>.workers.dev`
— `workers_dev` and `preview_urls` are both enabled in `wrangler.jsonc` so
there is always a working URL and per-branch previews.

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

Cloudflare → **Workers & Pages → websitebuild → Settings → Variables and Secrets**:

| Name | Value | Type |
| --- | --- | --- |
| `GITHUB_CLIENT_ID` | Client ID from 5a | Text |
| `GITHUB_CLIENT_SECRET` | Client Secret from 5a | **Secret (encrypt)** |
| `ALLOWED_DOMAINS` | `invicti.works` | Text |

`ALLOWED_DOMAINS` is optional but you should set it. Without it the sign-in
endpoint will mint tokens for a popup opened by any site, and the handler skips
its origin check on the way back.

Redeploy so the variables take effect. `https://invicti.works/admin/` will then
sign in with GitHub.

> Sign-in needs step 4 finished first. `base_url` in `public/admin/config.yml`
> points at `https://invicti.works`, so the popup only resolves once the custom
> domain is attached.

## 6. Lock the CMS behind Cloudflare Access

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

## 7. Add Josh

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
   step 6 is enough.

**In the CMS:** add their email to the Access policy from step 6.

---

## 8. Protect the `main` branch

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

## 9. Recommended extras

**Analytics (free, no cookie banner).** Worker → **Settings → Web Analytics →
Enable**. Cloudflare Web Analytics does not use cookies or track people across
sites, so it does not trigger a consent requirement in most jurisdictions.

**Email on the domain (free forwarding).** **Email → Email Routing → Enable**,
then forward `info@invicti.works` to a real inbox. This only *receives*.
Sending from that address needs Google Workspace (free for verified nonprofits
via Google for Nonprofits) or a service like Resend.

**Contact and lead-capture forms.** This is a fully static site with no server,
so a form has nowhere to post. The contact page currently uses `mailto:` links
with prefilled subject lines, which route themselves and cannot silently drop a
lead. When you want a real form, the options are:

- A Cloudflare Worker that receives the post and emails it on (free, and keeps
  everything in one account — this is what I would pick).
- A hosted form service such as Formspree or Tally (free tiers exist, adds a
  third party and their branding).

For a sales site, a form usually pays for itself: it captures leads who will
not open their mail client, and it lets you qualify with structured fields. The
Worker route keeps everything inside Cloudflare and stays on the free tier at
any volume you are likely to see. Note that adding a Worker script means adding
`main` to `wrangler.jsonc`, which moves the site off the assets-only free tier
onto the metered one — still free up to 100,000 requests a day.

---

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
