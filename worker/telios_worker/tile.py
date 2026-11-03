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
MOST = 3                # a pattern tile or a border has at most this many colors
EDGE_IN = (0.08, 0.12)  # a border's ground is read this far in from its top and bottom edges (shares of its height)
EDGE_OUT = 0.05         # a strip this thin along those edges is a margin, not design
MARGIN_SHARE = 0.10     # …when it is under this share of the unit
GROUND_SHARE = 0.6      # …when it holds this much of them
TILE_GROUND_SHARE = 0.35  # a pattern's ground covers at least this much of its tile
MIDDLE_SHARE = 0.2      # …and this much of the strip's middle half, between its motifs
SMOOTH = 1.1             # how far (in the picture's own pixels) the colors' outlines are smoothed


def gray_of(rgb):
    return rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114


def design_box(rgba):
    """The design's box in the scan (x0, y0, x1, y1): its margin of paper left out, and a hair more."""
    shape, _, _ = segment(rgba, 'full', False)
    ys, xs = np.nonzero(shape)
    if not len(xs):
        return 0, 0, rgba.shape[1], rgba.shape[0]
    # a hair in from the edge of the design, by its shorter side: by its longer, a long thin border would lose a fifth of its width
    pad = max(1, int(0.01 * min(rgba.shape[:2])))
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
    if cut * 2 + 16 >= min(small.shape):
        # a long thin strip would be cut to nothing by turning it: it is not a pattern to level both ways (a border is levelled along its length)
        return 0.0, 0.0, {}

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
    # the picture convolved with itself: at a shift s it adds up g(x) g(s - x), which is large where the picture is
    # the same turned half way round about s / 2
    F = np.fft.fft2(g)
    cc = np.fft.ifft2(F * F).real
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


def tile_svg(layers, W, H, pad, title='Telios', pad_y=None):
    groups = []
    for n, l in enumerate(layers):
        label = l['name'].replace('&', 'and').replace('"', "'").replace('<', '').replace('>', '')
        groups.append(f'<g id="{slug(l["name"], n)}" inkscape:groupmode="layer" inkscape:label="{label}" fill="{l["color"]}">{offset_paths(l["paths"], -pad, -(pad if pad_y is None else pad_y))}</g>')
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


def at_most(pal, labs, n):
    """The palette with its nearest two colors (Lab, weighted by the pixels each holds) made one until `n` or fewer are left, so a
    design of five tones is three and nothing but near neighbors is lost. Dark to light."""
    pal = [np.array(c, float) for c in pal]
    if len(pal) <= n:
        return np.array(pal)
    pts = labs.reshape(-1, 3)
    pts = pts[:: max(1, len(pts) // 60000)]
    counts = np.bincount(vq(pts, lab(np.array(pal)))[0], minlength=len(pal)).astype(float)
    counts = list(counts)
    while len(pal) > n:
        L = [lab(c) for c in pal]
        best = min(((float(np.linalg.norm(L[i] - L[j])), i, j) for i in range(len(pal)) for j in range(i + 1, len(pal))))
        _, i, j = best
        pal[i] = (pal[i] * counts[i] + pal[j] * counts[j]) / max(1.0, counts[i] + counts[j])
        counts[i] += counts[j]
        del pal[j], counts[j]
    out = np.array(pal)
    return out[np.argsort(lab(out)[:, 0])]


def ground_of(band, k):
    """The index of the color that is a border's background: the one just inside its top and bottom edges that also fills the gaps in its
    middle. It is read a little in from the edge (EDGE_IN), because a scan's paper margin or a thin line right at the edge would otherwise
    be taken for it. A rule that is the border's own, and not in the middle, is kept. None when there is none."""
    h = band.shape[0]
    a, b = int(round(EDGE_IN[0] * h)), max(int(round(EDGE_IN[1] * h)), int(round(EDGE_IN[0] * h)) + 2)
    edge = np.concatenate([band[a:b].ravel(), band[h - b:h - a].ravel()])
    counts = np.bincount(edge, minlength=k)
    best = int(counts.argmax())
    if counts[best] < GROUND_SHARE * edge.size:
        return None
    middle = band[int(0.25 * h):int(0.75 * h)]
    return best if (middle == best).mean() >= MIDDLE_SHARE else None


def margin_colors(band, k, skip):
    """The colors that are only a thin strip along the top and bottom edges (a scan's paper margin left at the border's rim): nearly all
    of their pixels in the outer EDGE_OUT of the height, and few of them overall. They go with the background."""
    h = band.shape[0]
    rows = max(2, int(round(EDGE_OUT * h)))
    out = []
    for i in range(k):
        if i == skip:
            continue
        mask = band == i
        total = int(mask.sum())
        if total and total < MARGIN_SHARE * band.size and (mask[:rows].sum() + mask[h - rows:].sum()) >= 0.95 * total:
            out.append(i)
    return out


def tile_ground(band, k):
    """The index of the color that is a pattern's background: a color of most of the tile that runs unbroken across the repeated surface
    (one connected region when the tile is laid out round, whose gaps are the design). Checker squares are separate, so no color of a
    checkerboard is a ground. None when there is none."""
    H, W = band.shape
    for i in sorted(range(k), key=lambda c: -(band == c).mean()):
        share = float((band == i).mean())
        if share < TILE_GROUND_SHARE:
            break
        lab_, n = ndimage.label(np.tile(band == i, (3, 3)))
        centre = lab_[H:2 * H, W:2 * W]
        sizes = np.bincount(centre[band == i], minlength=n + 1)
        if int((sizes > 0.01 * H * W).sum()) == 1:
            return i
    return None


def tile(source, outdir, max_colors=8, twins=TWINS, title='Telios', blend=BLEND, keep_ground=False):
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
        # a strip that repeats along its length only is a border, not a pattern
        along = px if gray.shape[1] >= gray.shape[0] else py
        if (px or py) and not (px and py) and max(gray.shape) >= 2 * min(gray.shape) and along:
            raise ValueError('This repeats along its length only: it is a border, not a pattern tile. Choose Made for → Border.')
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
    # a ground takes a place among the colors, so one more is kept until it is found and taken out
    pal = at_most(clean_palette(pal, labs, blend, twins), labs, MOST if keep_ground else MOST + 1)
    band = vq(labs.reshape(-1, 3), lab(pal))[0].reshape(H, W)
    band = smooth_labels(band, len(pal), SMOOTH * S)
    seam = seam_of(band)
    ground = None if keep_ground else tile_ground(band, len(pal))
    removed = None
    shape = np.ones((H, W), bool)
    if ground is not None:
        removed = {'color': hex_color(pal[ground]), 'share': round(float((band == ground).mean()), 3)}
        keep = [i for i in range(len(pal)) if i != ground]
        remap = np.zeros(len(pal), int)
        remap[keep] = np.arange(len(keep))
        shape = band != ground
        band = remap[band]
        pal = pal[keep]
    elif len(pal) > MOST:
        pal = at_most(pal, labs, MOST)
        band = smooth_labels(vq(labs.reshape(-1, 3), lab(pal))[0].reshape(H, W), len(pal), SMOOTH * S)
    colors = [hex_color(c) for c in pal]
    names = [color_name(tuple(c)) for c in pal]
    # traced with its own edges wrapped round it, so what leaves one edge is what enters the opposite
    pad = max(8, int(0.06 * min(W, H)))
    layers = build_layers(np.pad(band, pad, mode='wrap'), np.pad(shape, pad, mode='wrap'), colors, names, speckle=int(4 * max(1, S)))
    svg = tile_svg(layers, W, H, pad, title)
    with open(os.path.join(outdir, 'layered.svg'), 'w') as f:
        f.write(svg)
    Image.fromarray(np.clip(tile_rgb, 0, 255).astype(np.uint8)).save(os.path.join(outdir, 'tile.png'))
    half = half_alike(gray, cw, ch)
    return {
        'size': [W, H], 'cell': [round(cw, 2), round(ch, 2)], 'tilt': round(float(tilt), 3), 'lattice': 'half-drop' if half > 0.5 else 'grid',
        'perCell': 2 if half > 0.5 else 1, 'repeatStrength': [round(rx, 3), round(ry, 3)], 'copies': copies, 'symmetry': round(symmetry, 3),
        'slid': [sx, sy], 'seam': seam, 'layers': summary(layers), 'bytes': len(svg), 'ground': removed,
    }


# ── A border: a strip that repeats along its length ──

def centered_x(unit):
    """The unit slid round its left and right edges so its axis of mirror symmetry (a palmette's middle) is in the middle, and how
    alike it is to its mirror image there (0–1); the slide is only taken where that is strong."""
    g = gray_of(unit)
    g = g - g.mean()
    F = np.fft.fft(g, axis=1)
    cc = np.fft.ifft(F * F, axis=1).real.sum(axis=0)
    px = int(cc.argmax())
    strength = float(cc.max() / ((g * g).sum() or 1))
    if strength < 0.5:
        return unit, 0, strength
    dx = int(round(unit.shape[1] / 2 - px / 2.0))
    return np.roll(unit, dx, axis=1), dx, strength


def strip_score(gray):
    """How well a strip matches itself shifted along its length, on its middle rows (the ends of a turned copy are made up)."""
    h = gray.shape[0]
    return best_after_dip(axis_curves(gray[int(h * 0.15): int(h * 0.85) or None])[0])


def strip_tilt(gray):
    """The angle (degrees, counterclockwise) a strip is turned by: where turning it back makes it match itself best along its length.
    None where no angle does clearly better than none (a level strip stays as it is)."""
    k = min(1.0, 900 / max(gray.shape))
    small = ndimage.zoom(gray, k, order=1) if k < 1 else gray
    score = lambda d: strip_score(ndimage.rotate(small, -d, reshape=False, order=1, mode='reflect'))
    coarse = {d: score(d) for d in np.arange(-3.0, 3.0 + 1e-9, 0.5)}
    c = max(coarse, key=coarse.get)
    fine = {d: score(d) for d in np.arange(c - 0.5, c + 0.5 + 1e-9, 0.1)}
    f = max(fine, key=fine.get)
    ds = sorted(fine)
    i = ds.index(f)
    deg = float(f)
    if 0 < i < len(ds) - 1:
        y0, y1, y2 = fine[ds[i - 1]], fine[ds[i]], fine[ds[i + 1]]
        den = y0 - 2 * y1 + y2
        if den:
            deg = float(f + 0.5 * 0.1 * (y0 - y2) / den)
    base = strip_score(small)
    return deg if (abs(deg) >= 0.2 and fine[f] > base * 1.05) else 0.0


def seam_x(band):
    """The seam of a unit that repeats along its length: how much more the colors change across its left and right edges than just inside."""
    across = (band[:, 0] != band[:, -1]).mean()
    inner = np.mean([(band[:, k + 1] != band[:, k]).mean() for k in (0, 1, 2, band.shape[1] - 4, band.shape[1] - 3, band.shape[1] - 2)])
    return float(round((across + 0.01) / (inner + 0.01), 3))


def border(source, outdir, max_colors=8, twins=TWINS, title='Telios', blend=BLEND, keep_ground=False):
    """A border (a band or strip) made into one exact unit that repeats along its length, traced to flat color layers. The strip is turned
    to run level (a tall one a quarter turn), levelled by what it leans, its repeat found along its length to a fraction of a pixel, every
    copy of it laid on one unit, and the unit traced with its left and right edges wrapped round it."""
    rgba = np.asarray(load_rgba(source))
    x0, y0, x1, y1 = design_box(rgba)
    rgb = rgba[y0:y1, x0:x1, :3].astype(np.float32)
    quarter = rgb.shape[0] > rgb.shape[1]
    if quarter:
        rgb = np.ascontiguousarray(np.rot90(rgb))
    if rgb.shape[1] < 2 * 24 or rgb.shape[0] < 8:
        raise ValueError('This picture is too small to find a border in.')
    gray = gray_of(rgb)
    tilt = strip_tilt(gray)
    if tilt:
        rgb = np.stack([ndimage.rotate(rgb[..., c], -tilt, reshape=False, order=1, mode='reflect') for c in range(3)], -1)
        gray = gray_of(rgb)
    row, _ = axis_curves(gray)
    p = period_of_curve(row)
    if not p:
        raise ValueError('No repeat was found along this border: its design does not repeat along its length at least twice.')
    cw, rx = refine(gray, 0, p[0])
    H0, W0 = rgb.shape[:2]
    if cw < 12 or cw > 0.62 * W0:
        raise ValueError('The repeat found is bigger than the border can show twice: it needs to repeat at least one and a half times along its length.')
    # a turned strip is made up near its ends, so the unit is laid from the middle of it where that still holds a few copies
    if tilt and W0 > 3.2 * cw:
        wc = int(min(W0, max(3.2 * cw, 0.5 * W0)))
        left = (W0 - wc) // 2
        rgb = rgb[:, left:left + wc]
    S = 2.0 if max(cw, H0) < TILE_MIN / 2 else 1.0 if max(cw, H0) < TILE_MAX else TILE_MAX / max(cw, H0)
    unit, copies, (W, H) = lay_tile(rgb, cw, H0, S)
    unit, sx, symmetry = centered_x(unit)
    labs = lab(unit)
    pal, _ = palette_for(unit, labs, np.ones((H, W), bool), None, {'kind': 'none'}, False, max_colors, 1)
    # a ground takes a place among the colors, so one more is kept until it is found and taken out: the border has at most three of its own
    pal = at_most(clean_palette(pal, labs), labs, MOST if keep_ground else MOST + 1)
    band = vq(labs.reshape(-1, 3), lab(pal))[0].reshape(H, W)
    # smoothed along its length with its ends wrapped, but not across (its top and bottom are the strip's own edges)
    votes = np.stack([ndimage.gaussian_filter((band == i).astype(np.float32), SMOOTH * S, mode=('nearest', 'wrap')) for i in range(len(pal))])
    band = votes.argmax(0)
    ground = None if keep_ground else ground_of(band, len(pal))
    removed = None
    if ground is not None:
        margins = margin_colors(band, len(pal), ground)
        drop = [ground] + margins
        removed = {'color': hex_color(pal[ground]), 'share': round(float((band == ground).mean()), 3), 'margins': [hex_color(pal[i]) for i in margins]}
        keep = [i for i in range(len(pal)) if i not in drop]
        remap = np.zeros(len(pal), int)
        remap[keep] = np.arange(len(keep))
        shape = ~np.isin(band, drop)
        band = remap[band]
        pal = pal[keep]
    else:
        shape = np.ones((H, W), bool)
        if len(pal) > MOST:
            pal = at_most(pal, labs, MOST)
            band = vq(labs.reshape(-1, 3), lab(pal))[0].reshape(H, W)
    seam = seam_x(band)
    colors = [hex_color(c) for c in pal]
    names = [color_name(tuple(c)) for c in pal]
    pad = max(8, int(0.12 * W))
    layers = build_layers(np.pad(band, ((0, 0), (pad, pad)), mode='wrap'), np.pad(shape, ((0, 0), (pad, pad)), mode='wrap'), colors, names, speckle=int(4 * max(1, S)))
    svg = tile_svg(layers, W, H, pad, title, pad_y=0)
    with open(os.path.join(outdir, 'layered.svg'), 'w') as f:
        f.write(svg)
    Image.fromarray(np.clip(unit, 0, 255).astype(np.uint8)).save(os.path.join(outdir, 'tile.png'))
    return {
        'size': [W, H], 'cell': [round(cw, 2), float(H0)], 'tilt': round(float(tilt), 3), 'lattice': 'strip', 'perCell': 1,
        'repeatStrength': [round(rx, 3), round(rx, 3)], 'copies': copies, 'symmetry': round(symmetry, 3), 'slid': [sx, 0], 'seam': seam,
        'turned': bool(quarter), 'layers': summary(layers), 'bytes': len(svg), 'ground': removed,
    }
