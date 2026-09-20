#!/usr/bin/env python3
"""
Derives every Mellocrush brand asset in public/brand and src/app from the two pieces of supplied artwork in
brand-source/, so the logo is regenerated rather than hand-edited and nothing drifts between sizes.

    pip install Pillow numpy
    python3 scripts/build-brand-assets.py

The artwork arrives flattened onto a solid background — the wordmark on the brand navy, the mark on white — so the
first job is a real alpha channel. Thresholding the background away would leave a rim of half-background pixels
around every curve, which reads as a dark halo on a light page and a light halo on a dark one. Instead each pixel is
treated as what it is, a composite `C = a*F + (1-a)*B`: the coverage `a` is estimated from how far the pixel has
travelled from the background, and the foreground colour `F` is then solved for and stored un-premultiplied. Curves
stay clean over any background.

The lettering is white in the supplied wordmark, which is right over the navy and invisible on the sand page colour.
The light-background variant recolours ONLY the near-neutral lettering to the artwork's own navy; the coral "oo" and
the gold heart are never touched, and the recolour is weighted by how neutral a pixel is, so the blends where the
white letters meet the coral stay smooth.
"""
from __future__ import annotations

import pathlib

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "brand-source"
# NOT public/: these are imported, so Next fingerprints them and serves them immutable. A logo that lives at a fixed
# public URL is a logo a browser can keep showing after it changes — which is exactly what happened the first time.
BRAND = ROOT / "src" / "assets" / "brand"
APP = ROOT / "src" / "app"

# The artwork's own colours, measured from the supplied files rather than guessed.
NAVY = (11, 26, 43)        # wordmark background, and the ink for the light-background variant
WHITE_BG = (254, 253, 253)  # mark background
PAGE = (255, 251, 241)      # --background: the warm page colour app icons sit on


def unmatte(rgb: np.ndarray, bg: tuple[int, int, int], *, floor: float, ceil: float) -> np.ndarray:
    """Recover straight-alpha RGBA from artwork flattened onto a solid `bg`.

    Coverage ramps from 0 to 1 across [floor, ceil] channel-distance from the background, so sensor-level noise in
    the flat area stays transparent while anything meaningfully coloured is fully opaque. The colour is then
    un-premultiplied, which is what keeps edges free of the background's tint.
    """
    c = rgb.astype(np.float32)
    b = np.array(bg, dtype=np.float32)
    dist = np.abs(c - b).max(axis=2)
    a = np.clip((dist - floor) / (ceil - floor), 0.0, 1.0)
    safe = np.maximum(a, 1e-3)[..., None]
    f = (c - (1.0 - a)[..., None] * b) / safe
    f = np.clip(f, 0, 255)
    out = np.zeros(rgb.shape[:2] + (4,), dtype=np.uint8)
    out[..., :3] = np.where(a[..., None] > 0, f, b).round().astype(np.uint8)
    out[..., 3] = (a * 255).round().astype(np.uint8)
    return out


def trim(rgba: np.ndarray, threshold: int = 6) -> np.ndarray:
    """Crop to the artwork itself; layout spacing belongs to the components, not to baked-in padding."""
    ys, xs = np.where(rgba[..., 3] > threshold)
    return rgba[ys.min(): ys.max() + 1, xs.min(): xs.max() + 1]


def recolour_lettering(rgba: np.ndarray, ink: tuple[int, int, int]) -> np.ndarray:
    """Turn the near-neutral lettering to `ink`, leaving the coral and gold exactly as delivered.

    Weighting by saturation rather than switching on a threshold matters where the white letters run into the coral
    "oo": those pixels are genuine blends, and a hard rule would leave a visible seam.
    """
    out = rgba.copy()
    c = rgba[..., :3].astype(np.float32)
    mx, mn = c.max(axis=2), c.min(axis=2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1.0), 0.0)
    # Solid coral sits near 0.65 saturation; fully neutral below 0.10, fully coloured above 0.30.
    neutral = np.clip((0.30 - sat) / 0.20, 0.0, 1.0)[..., None]
    out[..., :3] = (neutral * np.array(ink, dtype=np.float32) + (1 - neutral) * c).round().astype(np.uint8)
    return out


def save(rgba: np.ndarray, path: pathlib.Path, *, width: int | None = None, height: int | None = None,
         flatten: tuple[int, int, int] | None = None, pad_ratio: float = 0.0) -> None:
    im = Image.fromarray(rgba, "RGBA")
    if pad_ratio:
        side = round(max(im.size) * (1 + 2 * pad_ratio))
        canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        canvas.paste(im, ((side - im.width) // 2, (side - im.height) // 2), im)
        im = canvas
    if width:
        im = im.resize((width, round(width * im.height / im.width)), Image.LANCZOS)
    elif height:
        im = im.resize((round(height * im.width / im.height), height), Image.LANCZOS)
    if flatten:
        bg = Image.new("RGBA", im.size, flatten + (255,))
        im = Image.alpha_composite(bg, im)
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, optimize=True)
    print(f"  {path.relative_to(ROOT)}  {im.width}x{im.height}")


def square(rgba: np.ndarray, pad_ratio: float = 0.08) -> np.ndarray:
    """Centre the mark on a transparent square with a little breathing room, for icon slots."""
    side = round(max(rgba.shape[:2]) * (1 + 2 * pad_ratio))
    canvas = np.zeros((side, side, 4), dtype=np.uint8)
    y = (side - rgba.shape[0]) // 2
    x = (side - rgba.shape[1]) // 2
    canvas[y: y + rgba.shape[0], x: x + rgba.shape[1]] = rgba
    return canvas


def main() -> None:
    print("wordmark")
    word = trim(unmatte(np.asarray(Image.open(SRC / "mellocrush-wordmark.png").convert("RGB")), NAVY,
                        floor=8, ceil=40))
    print(f"  trimmed {word.shape[1]}x{word.shape[0]}  aspect {word.shape[1] / word.shape[0]:.4f}")
    save(word, BRAND / "mellocrush-logo-white.png")
    save(word, BRAND / "mellocrush-logo-white-480.png", width=480)
    save(word, BRAND / "mellocrush-logo-white-960.png", width=960)
    dark = recolour_lettering(word, NAVY)
    save(dark, BRAND / "mellocrush-logo.png")
    save(dark, BRAND / "mellocrush-logo-480.png", width=480)

    print("mark")
    mark = square(trim(unmatte(np.asarray(Image.open(SRC / "mellocrush-mark.png").convert("RGB")), WHITE_BG,
                               floor=5, ceil=30)))
    save(mark, BRAND / "mellocrush-mark.png", width=512)
    save(mark, BRAND / "mellocrush-mark-512.png", width=512)

    print("app icons (opaque: a transparent icon is composited onto black by iOS)")
    save(mark, BRAND / "mellocrush-app-icon-192.png", width=192, flatten=PAGE)
    save(mark, BRAND / "mellocrush-app-icon-512.png", width=512, flatten=PAGE)
    # src/app/icon.png and apple-icon.png are Next's file-based metadata convention; it fingerprints these itself.
    save(mark, APP / "icon.png", width=512, flatten=PAGE)
    save(mark, APP / "apple-icon.png", width=180, flatten=PAGE)


if __name__ == "__main__":
    main()
