"""Pattern tile: a scan of a repeating surface pattern made into one exact, seamless tile and traced to flat color layers.

A scan is rarely square to the page and never ends where the pattern does. So, with no model:

  1. the design is cut out of the scan's margin;
  2. the picture is turned by whatever it leans: the angle at which it best matches itself shifted along a level
     and along a plumb line, so its repeat runs level and plumb;
  3. the repeat is measured to a fraction of a pixel, and every copy of it in the scan is laid on one tile and
     averaged, so a copy's grain, blur and misprint are smoothed away and the tile is periodic by construction;
  4. the tile is slid so a point of symmetry (a medallion's middle) is in its middle;
  5. its colors are found (near ones merged), and the tile is traced with its own edges wrapped round it, so a
     shape that leaves one edge is the same shape that enters the opposite, and clipped to the tile.
"""
import itertools
import math
import os
import re

import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.cluster.vq import vq

from .common import hex_color, lab, load_rgba, color_name
from .layers import INKSCAPE, build_layers, fmt, slug, summary
from .trace import merged, palette_for, segment

TILT_SIDE = 640          # the lean is searched on a copy this big on its longer side
TILT_MAX = 4.0           # a scan is turned by no more than this many degrees
MIN_STRENGTH = 0.3       # the weakest match with itself (0–1) taken for a repeat
TILE_MIN = 1600          # a tile is traced at least this big on its longer side (smaller ones are enlarged)
TILE_MAX = 2600
BLEND = 5.0             # a color this near (Lab) the line between two others, between them, is the blend where they meet, not a color
TWINS = 9.0             # two colors this near (Lab) are one
SMOOTH = 1.1             # how far (in the picture's own pixels) the colors' outlines are smoothed


def gray_of(rgb):
    return rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114


def design_box(rgba):
    """The design's box in the scan (x0, y0, x1, y1): its margin of paper left out, and a hair more."""
    shape, _, _ = segment(rgba, 'full', False)
    ys, xs = np.nonzero(shape)
    if not len(xs):
        return 0, 0, rgba.shape[1], rgba.shape[0]
    pad = int(0.01 * max(rgba.shape[:2]))
    return int(xs.min()) + pad, int(ys.min()) + pad, int(xs.max()) + 1 - pad, int(ys.max()) + 1 - pad


def axis_curves(gray):
    """How alike the picture is to itself shifted along a level line and along a plumb one, by the shift (0–1, unbiased by how little of
    the picture overlaps at a long shift)."""
    g = gray - gray.mean()
    h, w = g.shape
    f = np.fft.rfft2(g, s=(2 * h, 2 * w))
    ac = np.fft.irfft2(f * np.conj(f))
    row = ac[0, :w] / (ac[0, 0] or 1) * w / np.maximum(w - np.arange(w), 1)
    col = ac[:h, 0] / (ac[0, 0] or 1) * h / np.maximum(h - np.arange(h), 1)
    return row, col


def best_after_dip(curve, cut=0.55):
    """The strongest return of a curve after it has first dipped (the zero-shift lobe left behind), over the shifts up to `cut` of its length."""
    n = int(len(curve) * cut)
    k = 1
    while k < n - 1 and curve[k] >= curve[k + 1]:
        k += 1
    return float(curve[k:n].max()) if k < n else 0.0


def lean_score(gray):
    row, col = axis_curves(gray)
    return best_after_dip(row) + best_after_dip(col)


def tilt_of(gray):
    """The angle (degrees, counterclockwise on the screen) the picture is turned by: the one at which turning it back makes it match
    itself best shifted level and plumb. Tried coarsely, then finely."""
    k = min(1.0, TILT_SIDE / max(gray.shape))
    small = ndimage.zoom(gray, k, order=1) if k < 1 else gray
    cut = int(math.ceil(math.sin(math.radians(TILT_MAX)) * max(small.shape))) + 2

    def score(deg):
        r = ndimage.rotate(small, -deg, reshape=False, order=1, mode='reflect')
        return lean_score(r[cut:-cut, cut:-cut])

    coarse = {d: score(d) for d in np.arange(-TILT_MAX, TILT_MAX + 1e-9, 0.5)}
    c = max(coarse, key=coarse.get)
    fine = {d: score(d) for d in np.arange(c - 0.5, c + 0.5 + 1e-9, 0.1)}
    f = max(fine, key=fine.get)
    ds = sorted(fine)
    i = ds.index(f)
    if 0 < i < len(ds) - 1:
        y0, y1, y2 = fine[ds[i - 1]], fine[ds[i]], fine[ds[i + 1]]
        den = y0 - 2 * y1 + y2
        if den:
            return float(f + 0.5 * 0.1 * (y0 - y2) / den), fine[f], coarse
    return float(f), fine[f], coarse


def turn(rgb, deg):
    """The picture turned by `deg` (counterclockwise on the screen), and cut to the part that is all picture."""
    out = np.stack([ndimage.rotate(rgb[..., c], -deg, reshape=False, order=1, mode='reflect') for c in range(3)], -1)
    cut = int(math.ceil(math.sin(math.radians(abs(deg))) * max(rgb.shape[:2]))) + 3
    return out[cut:-cut, cut:-cut] if cut * 2 < min(rgb.shape[:2]) else out


def ncc(a, b):
    a = a - a.mean()
    b = b - b.mean()
    d = math.sqrt((a * a).sum() * (b * b).sum())
    return float((a * b).sum() / d) if d else 0.0


def refine(gray, axis, p0, span=5.0, step=0.25):
    """The repeat along an axis to a fraction of a pixel: the shift that makes the picture most like itself."""
    g = ndimage.gaussian_filter(gray, 1.0)
    if axis == 1:
        g = g.T
    n = g.shape[1]
    best = (-2.0, p0)
    scores = []
    for s in np.arange(p0 - span, p0 + span + 1e-9, step):
        i = int(math.floor(s))
        f = s - i
        if i + 2 >= n:
            continue
        a = g[:, : n - i - 1]
        b = (1 - f) * g[:, i: n - 1] + f * g[:, i + 1: n]
        sc = ncc(a, b)
        scores.append((s, sc))
        if sc > best[0]:
            best = (sc, s)
    if not scores:
        return p0, 0.0
    # a parabola through the best and its neighbours
    ss = [s for s, _ in scores]
    k = ss.index(best[1])
    if 0 < k < len(scores) - 1:
        y0, y1, y2 = scores[k - 1][1], scores[k][1], scores[k + 1][1]
        den = y0 - 2 * y1 + y2
        if den:
            return float(best[1] + 0.5 * step * (y0 - y2) / den), float(best[0])
    return float(best[1]), float(best[0])


def lay_tile(rgb, cw, ch, S):
    """One tile, cw × ch of the picture's pixels (S times as many output pixels): every copy of the repeat in the picture, averaged
    (the median of them, so a misprint in one does not show)."""
    H0, W0 = rgb.shape[:2]
    W, H = max(8, int(round(cw * S))), max(8, int(round(ch * S)))
    yy, xx = np.mgrid[0:H, 0:W]
    sx, sy = xx * (cw / W), yy * (ch / H)
    stack = []
    for j in range(-1, int(H0 // ch) + 2):
        for i in range(-1, int(W0 // cw) + 2):
            X, Y = sx + i * cw, sy + j * ch
            ok = (X >= 0) & (X <= W0 - 1) & (Y >= 0) & (Y <= H0 - 1)
            if not ok.any():
                continue
            samp = np.stack([ndimage.map_coordinates(rgb[..., c], [Y, X], order=1, mode='nearest') for c in range(3)], -1).astype(np.float32)
            samp[~ok] = np.nan
            stack.append(samp)
    tile = np.nanmedian(np.stack(stack), axis=0)
    holes = np.isnan(tile).any(-1)
    if holes.any():
        idx = ndimage.distance_transform_edt(holes, return_distances=False, return_indices=True)
        tile = tile[tuple(idx)]
    return tile, len(stack), (W, H)


def centered(tile):
    """The tile slid round its edges so its point of symmetry (a medallion's middle) is in the middle, and how alike the tile is to
    itself turned half way round there (0–1): the slide is only taken where that is strong."""
    g = gray_of(tile)
    g = g - g.mean()
    flip = np.roll(g[::-1, ::-1], 1, axis=(0, 1))
    cc = np.fft.ifft2(np.fft.fft2(g) * np.fft.fft2(flip)).real
    py, px = np.unravel_index(int(cc.argmax()), cc.shape)
    H, W = g.shape
    strength = float(cc.max() / ((g * g).sum() or 1))
    if strength < 0.5:
        return tile, 0, 0, strength
    cy, cx = py / 2.0, px / 2.0
    dy, dx = int(round(H / 2 - cy)), int(round(W / 2 - cx))
    return np.roll(tile, (dy, dx), axis=(0, 1)), dx, dy, strength


def clean_palette(pal, labs, blend=BLEND, twins=TWINS):
    """The tile's own colors: those k-means found, less the blends (a color on the line between two others is where they meet, the
    antialiased edge of a shape, not a color of the pattern) and with twins made one. Dark to light."""
    pts = labs.reshape(-1, 3)
    pts = pts[:: max(1, len(pts) // 60000)]
    L = lab(np.array(pal, float))
    counts = np.bincount(vq(pts, L)[0], minlength=len(pal)).astype(float)
    keep = list(range(len(pal)))
    again = True
    while again and len(keep) > 2:
        again = False
        for c in sorted(keep, key=lambda i: counts[i]):
            for p, q in itertools.combinations([i for i in keep if i != c], 2):
                pq = L[q] - L[p]
                n2 = float(pq @ pq)
                if n2 < 25 ** 2:
                    continue
                t = float((L[c] - L[p]) @ pq / n2)
                if 0.15 < t < 0.85 and float(np.linalg.norm((L[c] - L[p]) - t * pq)) < blend:
                    keep.remove(c)
                    again = True
                    break
            if again:
                break
    out = merged(np.array(pal, float)[keep], counts[keep], twins)
    return out[np.argsort(lab(out)[:, 0])]


def smooth_labels(band, k, sigma):
    """The color of each pixel by what is round it (each color's presence blurred, wrapping at the edges, the strongest wins): outlines
    lose a scan's chop and specks go, and a line a few pixels wide stays."""
    votes = np.stack([ndimage.gaussian_filter((band == i).astype(np.float32), sigma, mode='wrap') for i in range(k)])
    return votes.argmax(0)


def seam_of(band):
    """How much more the colors change across the tile's edge than between neighboring pixels just inside it (about 1: no seam; the small
    constant keeps a plain tile, where nothing changes, from reading as a seam)."""
    def ratio(across, inner):
        return (across + 0.01) / (inner + 0.01)
    x = ratio((band[:, 0] != band[:, -1]).mean(), np.mean([(band[:, k + 1] != band[:, k]).mean() for k in (0, 1, 2, band.shape[1] - 4, band.shape[1] - 3, band.shape[1] - 2)]))
    y = ratio((band[0, :] != band[-1, :]).mean(), np.mean([(band[k + 1, :] != band[k, :]).mean() for k in (0, 1, 2, band.shape[0] - 4, band.shape[0] - 3, band.shape[0] - 2)]))
    return float(round(max(x, y), 3))


def offset_paths(paths, dx, dy):
    """The traced paths moved by (dx, dy), each path's own transform taken into account."""
    def move(m):
        return f'translate({fmt(round(float(m.group(1)) + dx, 2))},{fmt(round(float(m.group(2)) + dy, 2))})'
    out, n = re.subn(r'translate\((-?[\d.]+),\s*(-?[\d.]+)\)', move, paths)
    return out if n else re.sub(r'<path ', f'<path transform="translate({fmt(dx)},{fmt(dy)})" ', paths)


def tile_svg(layers, W, H, pad, title='Telios'):
    groups = []
    for n, l in enumerate(layers):
        label = l['name'].replace('&', 'and').replace('"', "'").replace('<', '').replace('>', '')
        groups.append(f'<g id="{slug(l["name"], n)}" inkscape:groupmode="layer" inkscape:label="{label}" fill="{l["color"]}">{offset_paths(l["paths"], -pad, -pad)}</g>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="{INKSCAPE}" width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
            f'<title>{title}</title>{"".join(groups)}</svg>\n')


def period_of_curve(curve, cut=0.6):
    """The repeat a self-match curve shows: its first strong return after the dip (the fundamental, not a multiple), to a fraction of a shift,
    and how strong. None where there is none."""
    n = int(len(curve) * cut)
    k = 1
    while k < n - 1 and curve[k] >= curve[k + 1]:
        k += 1
    seg = curve[k:n]
    peaks = [i for i in range(1, len(seg) - 1) if seg[i] >= seg[i - 1] and seg[i] >= seg[i + 1] and seg[i] > MIN_STRENGTH]
    if not peaks:
        return None
    top = max(seg[i] for i in peaks)
    first = next(i for i in peaks if seg[i] >= 0.85 * top)
    lag = first + k
    y0, y1, y2 = curve[lag - 1], curve[lag], curve[lag + 1]
    den = y0 - 2 * y1 + y2
    return float(lag + (0.5 * (y0 - y2) / den if den else 0.0)), float(curve[lag])


def half_alike(gray, cw, ch):
    """How alike the picture is to itself shifted half a repeat across and half down (0–1): high where the repeat holds two of the motif
    (a staggered, half-drop pattern), low where it holds one."""
    dy, dx = int(round(ch / 2)), int(round(cw / 2))
    return ncc(gray[dy:, dx:], gray[: gray.shape[0] - dy, : gray.shape[1] - dx])


def tile(source, outdir, max_colors=8, twins=TWINS, title='Telios', blend=BLEND):
    im = load_rgba(source)
    rgba = np.asarray(im)
    x0, y0, x1, y1 = design_box(rgba)
    rgb = rgba[y0:y1, x0:x1, :3].astype(np.float32)
    gray = gray_of(rgb)
    tilt, tscore, _ = tilt_of(gray)
    if abs(tilt) > 0.05:
        rgb = turn(rgb, tilt)
        gray = gray_of(rgb)
    row, col = axis_curves(gray)
    px, py = period_of_curve(row), period_of_curve(col)
    if not px or not py:
        raise ValueError('No repeating pattern was found in this picture. A pattern tile needs a design that repeats at least twice across and down.')
    cw, rx = refine(gray, 0, px[0])
    ch, ry = refine(gray, 1, py[0])
    if min(cw, ch) < 12 or cw > 0.62 * gray.shape[1] or ch > 0.62 * gray.shape[0]:
        raise ValueError('The repeat found is bigger than the picture can show twice: a pattern tile needs the design to repeat at least one and a half times across and down.')
    long = max(cw, ch)
    S = 2.0 if long < TILE_MIN / 2 else 1.0 if long < TILE_MAX else TILE_MAX / long
    tile_rgb, copies, (W, H) = lay_tile(rgb, cw, ch, S)
    tile_rgb, sx, sy, symmetry = centered(tile_rgb)
    # the averaged tile is already smooth: its colors are read from it as it is, so a dark outline and a dark fill stay two
    soft = tile_rgb
    labs = lab(soft)
    pal, _ = palette_for(soft, labs, np.ones((H, W), bool), None, {'kind': 'none'}, False, max_colors, 1)
    pal = clean_palette(pal, labs, blend, twins)
    band = vq(labs.reshape(-1, 3), lab(pal))[0].reshape(H, W)
    band = smooth_labels(band, len(pal), SMOOTH * S)
    seam = seam_of(band)
    colors = [hex_color(c) for c in pal]
    names = [color_name(tuple(c)) for c in pal]
    # traced with its own edges wrapped round it, so what leaves one edge is what enters the opposite
    pad = max(8, int(0.06 * min(W, H)))
    layers = build_layers(np.pad(band, pad, mode='wrap'), np.ones((H + 2 * pad, W + 2 * pad), bool), colors, names, speckle=int(4 * max(1, S)))
    svg = tile_svg(layers, W, H, pad, title)
    with open(os.path.join(outdir, 'layered.svg'), 'w') as f:
        f.write(svg)
    Image.fromarray(np.clip(tile_rgb, 0, 255).astype(np.uint8)).save(os.path.join(outdir, 'tile.png'))
    half = half_alike(gray, cw, ch)
    return {
        'size': [W, H], 'cell': [round(cw, 2), round(ch, 2)], 'tilt': round(float(tilt), 3), 'lattice': 'half-drop' if half > 0.5 else 'grid',
        'perCell': 2 if half > 0.5 else 1, 'repeatStrength': [round(rx, 3), round(ry, 3)], 'copies': copies, 'symmetry': round(symmetry, 3),
        'slid': [sx, sy], 'seam': seam, 'layers': summary(layers), 'bytes': len(svg),
    }
