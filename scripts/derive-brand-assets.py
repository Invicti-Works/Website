#!/usr/bin/env python3
"""
Derive the site's web assets from the original logo artwork in brand/.

The files in brand/ are 1-1.5 MB PNGs at ~1500px -- source artwork, not web
assets. This script trims each to its real bounding box (ignoring the soft
glow halo), resizes with Lanczos resampling and re-optimises, producing the
files the site actually serves.

The outputs are committed, so a normal build never runs this. Re-run it only
if the artwork in brand/ changes:

    pip install Pillow numpy
    python3 scripts/derive-brand-assets.py

See docs/BRAND.md for the mapping table.
"""

import os

from PIL import Image
import numpy as np

# Which raw file feeds which asset. Verified by measuring each file's trimmed
# aspect ratio and dominant colour rather than by filename, since the raw
# names carry no meaning.
SOURCES = {
    'horizontal_colour': 'brand/raw-02_04_41_PM_(2).png',   # ar 4.09, colour
    'horizontal_white': 'brand/raw-02_04_42_PM_(6).png',    # ar 3.62, white
    'mark': 'brand/raw-02_04_42_PM_(7).png',                # ar 0.85, colour
    'stacked': 'brand/raw-02_00_43_PM.png',                 # ar 1.65, colour
}

BRAND_NAVY = '#0d2340'
OUT = 'public'


def trim(path: str, alpha_threshold: int = 60) -> Image.Image:
    """Crop to the real artwork, ignoring the near-transparent glow halo.

    Pillow's getbbox() trims only fully transparent pixels, which leaves a
    large soft margin on these files and skews every downstream size.
    """
    im = Image.open(path).convert('RGBA')
    a = np.array(im)
    ys, xs = np.where(a[:, :, 3] > alpha_threshold)
    return im.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))


def fit_width(im: Image.Image, w: int) -> Image.Image:
    return im.resize((w, max(1, round(im.height * w / im.width))), Image.LANCZOS)


def fit_height(im: Image.Image, h: int) -> Image.Image:
    return im.resize((max(1, round(im.width * h / im.height)), h), Image.LANCZOS)


def square(im: Image.Image, size: int, pad: float = 0.06) -> Image.Image:
    """Centre the mark on a transparent square so it never distorts."""
    inner = round(size * (1 - pad * 2))
    im = fit_height(im, inner) if im.height >= im.width else fit_width(im, inner)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.paste(im, ((size - im.width) // 2, (size - im.height) // 2), im)
    return canvas


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    written = []

    # Header lockups. 640px wide keeps a ~320px slot crisp at 2x DPR.
    for key, name in (
        ('horizontal_colour', 'logo-horizontal.png'),
        ('horizontal_white', 'logo-horizontal-white.png'),
    ):
        im = fit_width(trim(SOURCES[key]), 640)
        im.save(f'{OUT}/{name}', optimize=True)
        written.append(name)

    mark = trim(SOURCES['mark'])
    for size, name in ((512, 'logo-mark.png'), (192, 'icon-192.png'), (32, 'favicon-32.png')):
        square(mark, size).save(f'{OUT}/{name}', optimize=True)
        written.append(name)

    # iOS ignores transparency and composites onto black, so bake the navy in.
    apple = Image.new('RGB', (180, 180), BRAND_NAVY)
    m = square(mark, 180, pad=0.14)
    apple.paste(m, (0, 0), m)
    apple.save(f'{OUT}/apple-touch-icon.png', optimize=True)
    written.append('apple-touch-icon.png')

    square(mark, 64).save(f'{OUT}/favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])
    written.append('favicon.ico')

    # Default social card: stacked lockup centred on brand navy.
    og = Image.new('RGB', (1200, 630), BRAND_NAVY)
    lock = fit_width(trim(SOURCES['stacked']), 760)
    if lock.height > 470:
        lock = fit_height(lock, 470)
    og.paste(lock, ((1200 - lock.width) // 2, (630 - lock.height) // 2), lock)
    og.save(f'{OUT}/og-default.png', optimize=True)
    written.append('og-default.png')

    for name in written:
        print(f'{name:28} {os.path.getsize(f"{OUT}/{name}") / 1024:7.1f} KB')


if __name__ == '__main__':
    main()
