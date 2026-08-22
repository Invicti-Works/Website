# Brand

## Colours

**Sampled directly from the official logo artwork** in `brand/`, not eyeballed.
All are defined once as CSS custom properties at the top of
[`src/styles/global.css`](../src/styles/global.css) — change them there, never
in individual components.

| Token | Value | Contrast on white | Safe for |
| --- | --- | --- | --- |
| `--brand-navy` | `#003870` | 11.67:1 | Anything, including body text |
| `--brand-blue` | `#0058a0` | 7.23:1 | Anything, including body text |
| `--brand-orange` | `#f87000` | **2.87:1** | **Logo and non-text graphics only** |
| `--color-accent-warm` | `#b85200` | 4.95:1 | Orange text, where orange text is wanted |

### The orange constraint — read before using it

The brand orange is **2.87:1 on white**. WCAG 2.1 AA requires **4.5:1** for body
text and **3:1** even for large text, so it fails both. This is a common trap
with orange brand palettes and it is not a matter of taste: orange body copy on
white is genuinely hard to read for a substantial number of people, and for a
commercial site it is an accessibility-compliance exposure.

So:

- **Logo** — uses the exact brand orange. Correct, and explicitly permitted:
  WCAG exempts logotypes from the contrast minimum.
- **Graphics** — buttons on the dark navy band, checklist ticks, decorative
  rules. Fine, because no information depends on perceiving the colour.
- **Orange text** — use `--color-accent-warm` (`#b85200`), same hue at 4.95:1.
  This is what product taglines and role labels use.

Dark mode substitutes lighter tints automatically. Components do not need to
handle it.

## Logo files

The originals you uploaded live in [`brand/`](../brand). They are **1–1.5 MB
PNGs at 1500px** — source artwork, not web assets. Everything the site actually
serves was derived from them once and committed to `public/`:

| Web asset | Derived from | Used for |
| --- | --- | --- |
| `public/logo-horizontal.png` | `raw-02_04_41_PM_(2).png` | Header, light theme |
| `public/logo-horizontal-white.png` | `raw-02_04_42_PM_(6).png` | Header (dark theme) and footer |
| `public/logo-mark.png` | `raw-02_04_42_PM_(7).png` | 512px mark, PWA icon, structured data |
| `public/icon-192.png` | same | PWA icon |
| `public/favicon-32.png`, `favicon.ico` | same | Browser tab |
| `public/apple-touch-icon.png` | same | iOS home screen — navy baked in, because iOS composites transparency onto black |
| `public/og-default.png` | `raw-02_00_43_PM.png` | 1200×630 social card, lockup centred on brand navy |

Each was trimmed of its transparent margin, resized with Lanczos resampling and
saved as a **64-colour palette PNG** — the header lockup is 7.8 KB, down from
1.1 MB in the source and 52 KB as a full-colour PNG.

The palette step matters more than it sounds. The logo is flat brand colour, not
a photograph, so a small palette is visually indistinguishable: at display size
even a 16-colour version shows no banding, and 64 colours measures an RMSE of
1.6 against the original. Before this, the two logo files were **71% of the home
page's total weight**. They are now 14 KB of a 49 KB page.

Founder headshots stay as JPEG — they are photographic, and quantising them
would band skin tones.

## Founder headshots

| Web asset | Derived from |
| --- | --- |
| `public/team/erica-gaffney.jpg` | `brand/photos/erica-gaffney.jpeg` |
| `public/team/josh-forman.jpg` | `brand/photos/josh-forman.jpeg` |

Centre-cropped square and resized to 320px — enough for the 120px avatar at 2x
DPR without upscaling the originals. Same script as the logo assets.

To add someone: drop a square-ish photo in `brand/photos/<slug>.jpeg`, add the
slug to `PHOTOS` in the script, run it, and set `image: /team/<slug>.jpg` in
their file under `src/content/team/`.

**No alt text.** The card renders the person's name immediately beside the
photo, so alt text would make a screen reader announce the name twice. The image
is marked decorative (`alt=""`), which is the correct treatment when adjacent
text already identifies the subject. This is the one place the site's
alt-text-required rule is deliberately not applied.

### Regenerating them

They are committed, so a normal build does not touch them. Regenerate only if
the artwork in `brand/` changes:

```bash
pip install Pillow numpy
python3 scripts/derive-brand-assets.py
```

That script is the single source of truth for the derivation — the trimming
threshold, the resampling, the iOS navy backfill and the social-card
composition all live there rather than in anyone's memory. The header swaps colour and white versions with a `<picture>`
element and `prefers-color-scheme`, so no JavaScript and no flash of the wrong
logo.

### Still worth getting

These are raster. **Ask whoever produced the logo for the vector original**
(`.svg` or `.ai`). Vector would sharpen the mark at every size, shrink the
header asset to a few KB, and allow recolouring in CSS. The current PNGs are
good enough to launch on.

## Typography

A system font stack — whatever font is already on the reader's device. It loads
instantly, costs nothing and makes no third-party request. If the brand has a
specific typeface, self-host it (do not hotlink a font CDN) and update
`--font-sans` in `global.css`.
