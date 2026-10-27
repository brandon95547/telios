"""Shared helpers: loading any upload, color math (sRGB to Lab), color names, JSON out."""
import colorsys
import json
import sys

import numpy as np
from PIL import Image, ImageOps

Image.MAX_IMAGE_PIXELS = 200_000_000


def load_rgba(path):
    """Any raster upload as 8-bit RGBA, EXIF orientation applied (16-bit, CMYK, palette, gray all handled)."""
    im = Image.open(path)
    im = ImageOps.exif_transpose(im)
    if im.mode in ('I;16', 'I;16B', 'I;16L', 'I'):
        a = np.asarray(im, dtype=np.float64)
        hi = a.max() or 1
        im = Image.fromarray((a * (255.0 / hi)).clip(0, 255).astype(np.uint8), 'L')
    elif im.mode == 'F':
        a = np.asarray(im, dtype=np.float64)
        lo, hi = a.min(), a.max()
        im = Image.fromarray(((a - lo) / ((hi - lo) or 1) * 255).astype(np.uint8), 'L')
    if im.mode == 'CMYK':
        im = im.convert('RGB')
    return im.convert('RGBA')


def srgb_to_linear(c):
    c = c / 255.0
    return np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)


def lab(rgb):
    """sRGB (0-255, any shape ending in 3) to CIE Lab (D65)."""
    c = srgb_to_linear(np.asarray(rgb, dtype=np.float64))
    xyz = c @ np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]]).T
    f = xyz / np.array([0.95047, 1.0, 1.08883])
    f = np.where(f > 0.008856, np.cbrt(f), 7.787 * f + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def lightness(rgb):
    return lab(rgb)[..., 0]


def hex_color(c):
    return '#%02x%02x%02x' % tuple(int(round(min(255, max(0, v)))) for v in c)


def parse_hex(h):
    h = h.strip().lstrip('#')
    if len(h) == 3:
        h = ''.join(ch * 2 for ch in h)
    return [int(h[i:i + 2], 16) for i in (0, 2, 4)]


_HUES = [(15, 'red'), (40, 'orange'), (65, 'gold'), (80, 'yellow'), (160, 'green'), (195, 'teal'),
         (250, 'blue'), (290, 'violet'), (330, 'magenta'), (360, 'red')]


def color_name(rgb):
    """A plain name for a color: 'black', 'warm gray', 'dark red', 'pale gold'…"""
    r, g, b = [v / 255.0 for v in rgb]
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    L, A, B = lab(np.array(rgb, dtype=np.float64))
    chroma = float(np.hypot(A, B))
    if chroma < 8:
        if L < 18:
            return 'black'
        if L > 92:
            return 'white'
        tone = 'warm gray' if B > 2 else 'cool gray' if B < -2 else 'gray'
        return ('dark ' if L < 40 else 'light ' if L > 72 else '') + tone
    deg = h * 360
    name = next(n for limit, n in _HUES if deg <= limit)
    if name in ('orange', 'gold', 'yellow') and L < 45:
        name = 'brown'
    if name == 'red' and L > 70:
        name = 'pink'
    if name == 'yellow' and L > 90 and chroma < 25:
        name = 'cream'
    shade = 'dark ' if L < 35 else 'pale ' if L > 82 else ''
    return shade + name


def out(obj):
    json.dump(obj, sys.stdout, indent=1)
    sys.stdout.write('\n')


def fail(msg, code=2):
    sys.stderr.write(msg + '\n')
    sys.exit(code)
