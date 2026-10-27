"""Trace mode: the fast path for simple flat art. The upload itself is cleaned and traced into
per-color layers in seconds: the paper made transparent, every pixel snapped to the reading's
palette, specks removed, then each color traced. It keeps the original's flaws (wobble, print
damage), which is why re-illustration is the default.

The color rule applies here too: a neutral base turns each palette color into the gray of the
same lightness; one ink and full color keep their colors.
"""
import os

import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.cluster.vq import kmeans2, vq

from .analyze import find_paper, find_window, flat_window, main_parts, silhouette
from .common import hex_color, lab, load_rgba, parse_hex, color_name
from .layers import build_layers, layered_svg, summary

TRACE_MIN = 1600     # smaller uploads are enlarged 2x first, for smoother curves
TRACE_MAX = 2600


def gray_of(rgb):
    """The neutral gray with the same lightness as a color."""
    L = lab(np.array(rgb, float))[0]
    y = ((L + 16) / 116) ** 3 if L > 8 else L / 903.3
    v = 12.92 * y if y <= 0.0031308 else 1.055 * y ** (1 / 2.4) - 0.055
    g = round(max(0, min(1, v)) * 255)
    return [g, g, g]


def majority(band, k, size=3):
    votes = np.stack([ndimage.uniform_filter((band == i).astype(np.float32), size) for i in range(k)])
    return votes.argmax(0)


def prepare(source):
    """The upload at the size it is traced at: (image, k, (w0, h0)), k the scale from the upload."""
    im = load_rgba(source)
    w0, h0 = im.size
    long = max(w0, h0)
    k = 2.0 if long < TRACE_MIN else min(1.0, TRACE_MAX / long)
    if k != 1.0:
        im = im.resize((round(w0 * k), round(h0 * k)), Image.LANCZOS)
    return im, k, (w0, h0)


def segment(rgba, color_mode, keep_background=False, pinhole=12, wider=1.0):
    """Where the design is, in an RGBA array: (shape, window, paper). One ink keeps the paper
    between its lines clear; color and shaded art are their whole silhouette, pale grounds and
    highlights included. A frame's window and stray marks are left out. `pinhole`: the area of
    paper inside the ink, in pixels, that is noise."""
    paper, ink = find_paper(rgba)
    if keep_background or paper['kind'] == 'none':
        shape = rgba[..., 3] >= 128
        window = None if keep_background else flat_window(rgba[..., :3])
        if window is not None:
            shape &= ~window
    else:
        ink = main_parts(ink)
        window = find_window(ink)
        if window is None:
            window = flat_window(rgba[..., :3])
        if color_mode == 'one-ink':
            # line art: the ink alone, the paper between its lines left clear
            shape = ink & ~window if window is not None else ink
            holes, n = ndimage.label(~shape)
            if n:
                # pinholes in the ink are noise; a few pixels of paper inside a line are not art
                sizes = ndimage.sum(np.ones_like(holes), holes, range(1, n + 1))
                shape |= np.isin(holes, 1 + np.nonzero(sizes < pinhole)[0])
        else:
            # color and shaded art: the whole design, its pale grounds and highlights included
            shape = silhouette(ink, window, wider)
        shape = ndimage.binary_opening(shape, iterations=1)
    return shape, window, paper


def palette_for(rgb, labs, shape, palette, paper, keep_background=False, max_colors=8):
    """The colors to draw with, dark to light: the reading's (less any that is the paper's own),
    or the design's main colors. (rgb array, names)."""
    if palette:
        pal = np.array([parse_hex(p['hex'] if isinstance(p, dict) else p) for p in palette], float)
        names = [p.get('name') if isinstance(p, dict) else None for p in palette]
        if paper['kind'] == 'paper' and not keep_background:
            # a palette color that is the paper's own is not ink
            pl = lab(np.array(parse_hex(paper['color']), float))
            keep = [i for i in range(len(pal)) if np.linalg.norm(lab(pal[i]) - pl) > 8] or list(range(len(pal)))
            pal, names = pal[keep], [names[i] for i in keep]
    else:
        pts = labs[shape]
        pts = pts[np.random.default_rng(0).choice(len(pts), min(len(pts), 60_000), replace=False)]
        n = max(1, min(max_colors, 6))
        centers, _ = kmeans2(pts, n, minit='++', seed=0, iter=25)
        idx = vq(labs[shape], centers)[0]
        pal = np.array([rgb[shape][idx == i].mean(0) if (idx == i).any() else [128] * 3 for i in range(n)])
        names = [None] * n
    order = np.argsort(lab(pal)[:, 0])
    return pal[order], [names[i] for i in order]


def trace(source, outdir, palette=None, color_mode='full', keep_background=False, max_colors=8, title='Telios'):
    im, k, (w0, h0) = prepare(source)
    rgba = np.asarray(im).astype(np.float64)
    h, w = rgba.shape[:2]
    rgb = ndimage.gaussian_filter(rgba[..., :3], (0.8, 0.8, 0))
    shape, window, paper = segment(np.asarray(im), color_mode, keep_background, 12 * k * k)
    labs = lab(rgb)
    pal, names = palette_for(rgb, labs, shape, palette, paper, keep_background, max_colors)

    band = np.zeros((h, w), int)
    band[shape] = vq(labs[shape], lab(pal))[0]
    band = majority(band, len(pal), 5)
    band[~shape] = 0

    if color_mode == 'neutral':
        colors = [hex_color(gray_of(c)) for c in pal]
    else:
        colors = [hex_color(c) for c in pal]
    names = [n or color_name(parse_hex(c)) for n, c in zip(names, colors)]
    layers = build_layers(band, shape, colors, names, speckle=int(4 * max(1, k)))
    svg = layered_svg(layers, w, h, w0, h0, title)
    with open(os.path.join(outdir, 'layered.svg'), 'w') as f:
        f.write(svg)
    return {'size': [w0, h0], 'tracedAt': [w, h], 'layers': summary(layers), 'background': paper, 'bytes': len(svg)}
