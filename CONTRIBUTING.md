# Working on this site together

There are three ways to contribute, and they need very different amounts of
setup. Pick the lightest one that does the job.

| | Who it suits | Needs |
| --- | --- | --- |
| **1. Content editing** | Anyone writing copy, news or programs | A browser, nothing else |
| **2. Code, locally** | Anyone changing layout, styling or structure | Node 20.11+, Git, an editor |
| **3. Code, via Claude Code on the web** | Same as 2, without installing anything | A Claude account with Claude Code |

---

## 1. Content editing — no tools required

Go to **<https://invicti.works/admin/>**, sign in, edit, save. That is the
whole workflow. See [`docs/CONTENT.md`](docs/CONTENT.md).

**Access needed:** your email on the Cloudflare Access policy, and **Write**
access to this repository. Both are described in
[`docs/SETUP.md`](docs/SETUP.md), steps 6 and 7.

---

## 2. Code, on your own machine

```bash
git clone https://github.com/Invicti-Works/Website.git
cd Website
npm install
npm run dev          # http://localhost:4321
```

Then, for any change:

```bash
git checkout -b your-name/short-description
# ...make the change...
npm run check        # types + content schemas
npm run build        # catches anything check misses
git commit -am "Describe the change"
git push -u origin your-name/short-description
```

Open a pull request on GitHub. CI runs the same two commands, and the reviewer
sees the diff before anything goes live.

**Access needed:** **Write** access to the repository.

---

## 3. Code, via Claude Code on the web

If you would rather not install Node and Git, you can work on this repository
from the browser at **<https://claude.ai/code>**:

1. Sign in with your own Claude account (Claude Code is included on the paid
   plans — it is per-person, not shared).
2. Connect your GitHub account when prompted, and authorize access to the
   **Invicti-Works** organization.
3. Pick the `Invicti-Works/Website` repository and describe what you want to
   change. Each session gets its own sandbox, runs the build, and opens a pull
   request for you.

**Access needed:** your own Claude subscription, plus **Write** access to this
repository. Two people can run sessions at the same time — they get separate
sandboxes and separate branches, so they cannot overwrite each other.

---

## Staying out of each other's way

The one real hazard with two people is **two edits to the same file at the same
time**. It is easy to avoid:

- **Always branch.** Never commit straight to `main`. One branch per change,
  named `yourname/what-it-does`.
- **Pull before you start.** `git checkout main && git pull` — then branch.
- **Keep pull requests small.** A 40-line PR gets reviewed the same day; a
  400-line one sits for a week and collects conflicts.
- **Say what you are picking up** before you start on something large, so you
  do not both rebuild the header on the same afternoon.
- **Content and code rarely collide.** CMS edits touch `src/content/` and
  `src/data/site.json`; code changes touch everything else. One of you can be
  adding a product while the other rebuilds the layout.

If you do get a conflict, it is almost always in a file you both touched. Pull
`main` into your branch, resolve it, push again — nothing is lost, because every
version is in Git.

## Reviewing each other's work

- One approval is enough. Do not let a PR sit — a stale branch is a future
  conflict.
- Check the deploy preview, not just the diff.
- Everything on the checklist in the pull request template applies, especially
  alt text and heading order.

## Definition of done

Before asking for review:

- [ ] `npm run check` passes (types **and** content schemas)
- [ ] `npm run build` passes
- [ ] Looked at it on a narrow screen
- [ ] New images have real alt text
- [ ] No `PLACEHOLDER` text left behind in anything you touched
- [ ] Brand orange used only for graphics, never for text (see `docs/BRAND.md`)
