"""Draw the app icons for the manifest (public/icons/): 192 and 512 px, and a 512 px maskable one with the mark inside the 80 % safe zone.

    .venv-terrain/Scripts/python.exe scripts/make-pwa-icons.py

A plain mark: dark blue ground, a light-blue disc, a white wave line. No third-party artwork.
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / 'public' / 'icons'
BG, DISC, WAVE = (11, 18, 32), (59, 130, 246), (255, 255, 255)


def icon(size, safe=1.0, rounded=True):
    scale = 4                                                    # draw large, shrink for smooth edges
    s = size * scale
    img = Image.new('RGBA', (s, s), BG + (255,))
    d = ImageDraw.Draw(img)
    c, r = s / 2, s / 2 * 0.62 * safe
    d.ellipse([c - r, c - r, c + r, c + r], fill=DISC)
    w = max(2, int(s * 0.045 * safe))
    pts = []
    for i in range(0, 101):
        x = c - r * 0.72 + (r * 1.44) * i / 100
        y = c + r * 0.14 * math.sin(i / 100 * 3 * math.pi)
        pts.append((x, y))
    d.line(pts, fill=WAVE, width=w, joint='curve')
    img = img.resize((size, size), Image.LANCZOS)
    if rounded and safe == 1.0:                                  # a rounded square for the plain icons; the maskable one stays full-bleed
        mask = Image.new('L', (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.18), fill=255)
        img.putalpha(mask)
    return img


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    icon(192).save(OUT / 'icon-192.png', optimize=True)
    icon(512).save(OUT / 'icon-512.png', optimize=True)
    icon(512, safe=0.8, rounded=False).save(OUT / 'icon-maskable-512.png', optimize=True)
    for f in sorted(OUT.glob('*.png')):
        print(f.name, f.stat().st_size, 'bytes')


if __name__ == '__main__':
    main()
