"""Stage 2 of the process: measuring an uploaded design so the reading and the plan rest on numbers.

ingest(original, outdir) prepares the upload (RGBA, leveled, at most 3000 px), writes source.png,
view.png (for the model and the screen), thumb.png (for the library), and returns the measurements:
the paper and the ink, tilt, the window of a frame and its band depths, symmetry, what repeats
(autocorrelation along each band, or a 2D lattice), the palette, flat or shaded, carved lines,
and a first guess at the kind.
"""
import math
import os

import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.cluster.vq import kmeans2, vq

from .common import color_name, hex_color, lab, load_rgba, parse_hex

MAX_SIDE = 3000
WORK = 1200         # the long side measurements are taken at


# ── Paper and ink ──

def otsu(values, bins=256):
    hist, edges = np.histogram(values, bins=bins)
    mids = (edges[:-1] + edges[1:]) / 2
    w0 = np.cumsum(hist)
    w1 = w0[-1] - w0
    m0 = np.cumsum(hist * mids) / np.maximum(w0, 1)
    m1 = (np.sum(hist * mids) - np.cumsum(hist * mids)) / np.maximum(w1, 1)
    return mids[np.argmax(w0 * w1 * (m0 - m1) ** 2)]


def find_paper(rgba):
    """The ground the design sits on: transparency, or a uniform color all round the edge."""
    a = rgba[..., 3]
    if (a < 128).mean() > 0.02:
        return {'kind': 'transparent'}, a >= 128
    h, w = a.shape
    m = max(2, round(0.004 * min(h, w)))
    labs = lab(rgba[..., :3].astype(np.float64))
    edge = np.concatenate([labs[:m].reshape(-1, 3), labs[-m:].reshape(-1, 3), labs[:, :m].reshape(-1, 3), labs[:, -m:].reshape(-1, 3)])
    paper = np.median(edge, 0)
    spread = np.median(np.linalg.norm(edge - paper, axis=1))
    d = np.linalg.norm(labs - paper, axis=-1)
    uniform = spread < 6 and (np.linalg.norm(edge - paper, axis=1) < 10).mean() > 0.8
    if not uniform:
        return {'kind': 'none'}, np.ones(a.shape, bool)
    # faint engraved lines matter: the cut sits just above the paper's own noise, below Otsu's
    thr = max(6 + 3 * spread, min(otsu(d[::4, ::4].ravel()), 15))
    ink = d > thr
    ink = ndimage.binary_opening(ink, iterations=1)
    rgb = lab_to_rgb_approx(rgba[..., :3], d < spread * 2 + 3)
    return {'kind': 'paper', 'color': hex_color(rgb), 'threshold': float(thr)}, ink


def lab_to_rgb_approx(rgb, where):
    sel = rgb[where]
    return np.median(sel, 0) if len(sel) else np.array([255, 255, 255])


def reach(shape):
    """How far apart two pieces of one design may be, in pixels: the gaps a speckled scan leaves
    in a line, or between a band's motifs, are bridged; a caption beside the design is not."""
    return max(3, round(0.006 * max(shape)))


def find_window(ink, min_share=0.08):
    """A frame's window: the largest empty region enclosed by the design (not reaching the image's
    edge), once gaps in the ink are bridged. A boolean mask, or None."""
    r = reach(ink.shape)
    grown = ndimage.binary_dilation(ink, iterations=r)
    empty, n = ndimage.label(~grown)
    if n == 0:
        return None
    edge = set(np.unique(np.concatenate([empty[0], empty[-1], empty[:, 0], empty[:, -1]]))) - {0}
    sizes = ndimage.sum(np.ones_like(empty), empty, range(1, n + 1))
    best = [(s, i + 1) for i, s in enumerate(sizes) if i + 1 not in edge]
    if not best:
        return None
    s, j = max(best)
    if s < min_share * ink.size:
        return None
    return ndimage.binary_dilation(empty == j, iterations=r) & ~ink


def flat_window(rgb, min_share=0.08):
    """For a piece with no paper round it: a flat panel in the middle (a frame's window drawn as
    a tinted panel), the region of the center's color reached from the center."""
    h, w = rgb.shape[:2]
    labs = lab(ndimage.uniform_filter(rgb.astype(np.float64), size=(3, 3, 1)))
    c = np.median(labs[h // 2 - 5:h // 2 + 5, w // 2 - 5:w // 2 + 5].reshape(-1, 3), 0)
    near = np.linalg.norm(labs - c, axis=-1) < 7
    parts, _ = ndimage.label(near)
    j = parts[h // 2, w // 2]
    if j == 0:
        return None
    region = ndimage.binary_fill_holes(parts == j)
    if region.mean() < min_share or region[0].any() or region[-1].any() or region[:, 0].any() or region[:, -1].any():
        return None
    return region


def main_parts(ink):
    """The design without stray marks beside it (a page number, a caption): the connected
    pieces, once gaps are bridged, at least a tenth the size of the largest."""
    grown = ndimage.binary_dilation(ink, iterations=reach(ink.shape))
    parts, n = ndimage.label(grown)
    if n <= 1:
        return ink
    sizes = ndimage.sum(ink, parts, range(1, n + 1))
    keep = 1 + np.nonzero(sizes >= 0.1 * sizes.max())[0]
    return ink & np.isin(parts, keep)


def silhouette(ink, window=None, wider=1.0):
    """The design's whole shape: its ink with the gaps between lines and the light parts of a
    shaded relief filled in, but a frame's window left open. `wider` bridges larger gaps (a
    faint stretch of an outer rule)."""
    r = round(reach(ink.shape) * wider)
    filled = ndimage.binary_fill_holes(ndimage.binary_dilation(ink, iterations=r))
    filled = ndimage.binary_erosion(filled, iterations=r, border_value=1) | ink
    if window is not None:
        filled &= ~window
    return filled


# ── Leveling ──

def measure_tilt(mask):
    """The angle (degrees, within ±3) that makes the ink's row and column profiles sharpest."""
    if mask.sum() < 50:
        return 0.0
    m = mask.astype(np.float32)
    best, best_a = -1, 0.0
    for a in np.arange(-3, 3.01, 0.25):
        r = ndimage.rotate(m, a, reshape=False, order=1)
        s = (r.sum(0) ** 2).sum() + (r.sum(1) ** 2).sum()
        if s > best:
            best, best_a = s, a
    for a in np.arange(best_a - 0.2, best_a + 0.21, 0.05):
        r = ndimage.rotate(m, a, reshape=False, order=1)
        s = (r.sum(0) ** 2).sum() + (r.sum(1) ** 2).sum()
        if s > best:
            best, best_a = s, a
    return float(round(best_a, 2))


# ── Symmetry and repeats ──

def corr(a, b):
    a = a - a.mean()
    b = b - b.mean()
    d = math.sqrt((a * a).sum() * (b * b).sum())
    return float((a * b).sum() / d) if d else 0.0


def mirror_score(img, span=0.04):
    """How nearly an image is its own mirror image left to right, about the best axis within
    `span` of its middle (a design is rarely centered on its scan). Returns (correlation, axis):
    the axis as a pixel-edge position, a whole or half number."""
    h, w = img.shape
    if w < 8:
        return 0.0, w / 2

    def score(a, n2):
        # column i mirrors to n2 - 1 - i; the overlap [i0, i1) is symmetric about n2 / 2
        W = a.shape[1]
        i0, i1 = max(0, n2 - W), min(W, n2)
        if i1 - i0 < 0.6 * W:
            return -1.0
        part = a[:, i0:i1]
        return corr(part, part[:, ::-1])

    q = max(1, w // 400)
    small = img[::q, ::q] if q > 1 else img
    ws = small.shape[1]
    lo, hi = int(ws * (1 - 2 * span)), int(math.ceil(ws * (1 + 2 * span)))
    coarse = max(range(lo, hi + 1), key=lambda n2: score(small, n2))
    best = max(range(coarse * q - 2 * q, coarse * q + 2 * q + 1), key=lambda n2: score(img, n2))
    return round(score(img, best), 3), best / 2


def acf_1d(strip, axis):
    """Autocorrelation of a strip along an axis, averaged across it, normalized to 1 at lag 0."""
    s = strip - strip.mean(axis=axis, keepdims=True)
    n = s.shape[axis]
    f = np.fft.rfft(s, n=2 * n, axis=axis)
    ac = np.fft.irfft(f * np.conj(f), axis=axis)
    ac = ac.take(range(n), axis=axis).sum(axis=1 - axis)
    ac /= ac[0] or 1
    # unbiased: a lag sees fewer pairs
    return ac * n / np.maximum(n - np.arange(n), 1)


def period_of(strip, axis, min_lag=4):
    """The strongest repeat along a strip: its period in pixels and how strong it is (0–1)."""
    n = strip.shape[axis]
    if n < 4 * min_lag:
        return None
    ac = acf_1d(strip.astype(np.float64), axis)
    hi = int(n * 0.45)
    if hi <= min_lag + 2:
        return None
    seg = ac[min_lag:hi]
    peaks = [i for i in range(1, len(seg) - 1) if seg[i] >= seg[i - 1] and seg[i] >= seg[i + 1] and seg[i] > 0.2]
    if not peaks:
        return None
    # The first peak nearly as strong as the strongest: the fundamental, not a multiple.
    top = max(seg[i] for i in peaks)
    first = next(i for i in peaks if seg[i] >= 0.85 * top)
    lag = first + min_lag
    # refine to sub-pixel with a parabola
    y0, y1, y2 = ac[lag - 1], ac[lag], ac[lag + 1] if lag + 1 < n else ac[lag]
    den = y0 - 2 * y1 + y2
    sub = 0.5 * (y0 - y2) / den if den else 0.0
    return {'period': float(lag + sub), 'strength': float(round(ac[lag], 3)), 'count': float(round(n / (lag + sub), 2))}


def lattice_of(gray):
    """A surface pattern's 2D repeat: the shortest translations that map it onto itself."""
    g = gray - gray.mean()
    h, w = g.shape
    f = np.fft.rfft2(g, s=(2 * h, 2 * w))
    ac = np.fft.irfft2(f * np.conj(f))[:h, :w]
    ac /= ac[0, 0] or 1
    ac = np.fft.fftshift(np.fft.irfft2(f * np.conj(f)))
    ac /= ac.max() or 1
    cy, cx = ac.shape[0] // 2, ac.shape[1] // 2
    local = ndimage.maximum_filter(ac, size=7) == ac
    cand = [(ac[y, x], y - cy, x - cx) for y, x in zip(*np.nonzero(local & (ac > 0.3)))
            if (abs(y - cy) > 4 or abs(x - cx) > 4) and abs(y - cy) < h * 0.6 and abs(x - cx) < w * 0.6]
    if len(cand) < 2:
        return None
    cand.sort(key=lambda c: (c[1] ** 2 + c[2] ** 2))
    v1 = cand[0]
    v2 = next((c for c in cand[1:] if abs(c[1] * v1[2] - c[2] * v1[1]) > 0.3 * (c[1] ** 2 + c[2] ** 2)), None)
    if v2 is None:
        return None
    vecs = sorted([(v1[2], v1[1], v1[0]), (v2[2], v2[1], v2[0])], key=lambda v: abs(v[1]))
    (ax, ay, s1), (bx, by, s2) = vecs
    kind = 'grid'
    if abs(ay) <= 2 and abs(bx) > 3 and abs(abs(bx) - abs(ax) / 2) < 4:
        kind = 'half-drop' if abs(by) > abs(ax) * 0.4 else 'brick'
    return {'a': [int(ax), int(ay)], 'b': [int(bx), int(by)], 'strength': float(round(min(s1, s2), 3)), 'kind': kind}


# ── Palette, rendering, carved lines ──

def palette_of(rgb, shape, max_k=8):
    pts = lab(rgb[shape].astype(np.float64))
    if len(pts) < 20:
        return [], pts, None, None
    rng = np.random.default_rng(0)
    sample = pts[rng.choice(len(pts), min(len(pts), 60_000), replace=False)]
    prev, chosen = None, None
    for k in range(1, max_k + 1):
        centers, labels = kmeans2(sample, k, minit='++', seed=0, iter=25)
        used = np.bincount(labels, minlength=k) > 0
        centers = centers[used]
        sse = ((sample - centers[vq(sample, centers)[0]]) ** 2).sum()
        if prev is not None and sse > 0.8 * prev:
            break
        chosen, prev = centers, sse
    centers = chosen
    # merge clusters closer than ΔE 10
    merged = True
    while merged and len(centers) > 1:
        merged = False
        d = np.linalg.norm(centers[:, None] - centers[None], axis=-1) + np.eye(len(centers)) * 1e9
        i, j = np.unravel_index(np.argmin(d), d.shape)
        if d[i, j] < 10:
            centers = np.delete(np.vstack([centers, (centers[i] + centers[j]) / 2]), [i, j], 0)
            merged = True
    idx, dist = vq(sample, centers)
    order = np.argsort(centers[:, 0])
    srgb = sample_rgb(rgb, shape, centers)
    out = []
    for k in order:
        share = float((idx == k).mean())
        if share < 0.004:
            continue
        out.append({'hex': hex_color(srgb[k]), 'share': round(share, 3), 'name': color_name(srgb[k]),
                    'L': round(float(centers[k][0]), 1), 'C': round(float(np.hypot(centers[k][1], centers[k][2])), 1)})
    return out, sample, centers, dist


def sample_rgb(rgb, shape, centers):
    """Each Lab center as the mean sRGB of the pixels nearest it (no Lab→sRGB inverse needed)."""
    px = rgb[shape].astype(np.float64)
    rng = np.random.default_rng(1)
    pick = rng.choice(len(px), min(len(px), 60_000), replace=False)
    px = px[pick]
    idx = vq(lab(px), centers)[0]
    return np.array([px[idx == k].mean(0) if (idx == k).any() else [128, 128, 128] for k in range(len(centers))])


def flatness(rgb, shape):
    """Share of the design's interior (away from edges) explained by a few flat colors: near 1
    for flat print and line art, low for painted gradients and shaded relief."""
    L = lab(ndimage.uniform_filter(rgb.astype(np.float64), size=(5, 5, 1)))
    gx = ndimage.sobel(L[..., 0], 1)
    gy = ndimage.sobel(L[..., 0], 0)
    grad = np.hypot(gx, gy)
    interior = shape & (grad < np.percentile(grad[shape], 60) if shape.any() else shape)
    pts = L[interior]
    if len(pts) < 50:
        return 1.0, 0.0
    rng = np.random.default_rng(0)
    pts = pts[rng.choice(len(pts), min(len(pts), 40_000), replace=False)]
    centers, _ = kmeans2(pts, 4, minit='++', seed=0, iter=20)
    d = vq(pts, centers)[1]
    # how much of the interior lies on smooth ramps of lightness
    ramp = float(((grad[shape] > 1.5) & (grad[shape] < 12)).mean())
    return float(round((d < 6).mean(), 3)), round(ramp, 3)


def carved_lines(rgb, shape):
    """Light lines cut out of a solid ink (a white-line woodcut): many small gaps enclosed in the
    ink, the ink round them at least 2.5 times as broad. (count, times broader) or None."""
    L = lab(rgb.astype(np.float64))[..., 0] / 100
    if not shape.any():
        return None
    lo, hi = np.percentile(L[shape], [2, 98])
    ink = shape & (L < (lo + hi) / 2) if hi - lo > 0.25 else shape
    gaps, n = ndimage.label(ndimage.binary_fill_holes(ink) & ~ink)
    if n == 0:
        return None
    sizes = ndimage.sum(np.ones_like(gaps), gaps, range(1, n + 1))
    small = 1 + np.nonzero(sizes < 0.01 * ink.size)[0]
    lines = np.isin(gaps, small)
    if len(small) < 40 or lines.sum() < 0.08 * (ink.sum() + lines.sum()):
        return None
    broader = ndimage.distance_transform_edt(ink)[ink].mean() / ndimage.distance_transform_edt(lines)[lines].mean()
    return {'count': int(len(small)), 'broader': round(float(broader), 2)} if broader >= 2.5 else None


def hue_families(rgb, shape):
    labs = lab(rgb[shape].astype(np.float64))
    if len(labs) > 80_000:
        labs = labs[np.random.default_rng(0).choice(len(labs), 80_000, replace=False)]
    C = np.hypot(labs[:, 1], labs[:, 2])
    chromatic = C > 12
    share = float(chromatic.mean()) if len(C) else 0.0
    if chromatic.sum() < 30:
        return share, []
    hue = (np.degrees(np.arctan2(labs[chromatic, 2], labs[chromatic, 1])) + 360) % 360
    hist, _ = np.histogram(hue, bins=12, range=(0, 360))
    hist = hist / hist.sum()
    fams = [int(i * 30 + 15) for i in np.nonzero(hist > 0.08)[0]]
    return round(share, 3), fams


# ── The kind ──

def guess_kind(bbox, win, coverage, aspect, lat, grid):
    if win is not None:
        return 'frame', 0.75
    if aspect >= 3.0:
        return 'border', 0.7
    if lat is not None and coverage > 0.35 and lat['strength'] > 0.45:
        return 'pattern', 0.6
    # an L of ink along two adjacent sides, light elsewhere: a corner
    g = grid
    for corner in (g, np.fliplr(g), np.flipud(g), np.flipud(np.fliplr(g))):
        arm = (corner[0, :].mean() + corner[:, 0].mean()) / 2
        rest = corner[1:, 1:].mean()
        if arm > 0.18 and rest < 0.35 * arm and corner[0, 0] > 0.15:
            return 'corner', 0.55
    return 'ornament', 0.45


def ingest(original, outdir):
    rgba = np.asarray(load_rgba(original)).copy()
    h, w = rgba.shape[:2]
    if max(h, w) > MAX_SIDE:
        k = MAX_SIDE / max(h, w)
        rgba = np.asarray(Image.fromarray(rgba).resize((round(w * k), round(h * k)), Image.LANCZOS)).copy()
        h, w = rgba.shape[:2]

    # measure at a working size
    k = min(1.0, WORK / max(h, w))
    small = np.asarray(Image.fromarray(rgba).resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)).copy()
    paper, ink = find_paper(small)

    tilt = measure_tilt(ink) if paper['kind'] != 'none' else 0.0
    leveled = False
    if 0.3 <= abs(tilt) <= 3:
        fill = tuple(int(v) for v in (*Image.new('RGB', (1, 1), paper.get('color', '#ffffff')).getpixel((0, 0)), 0 if paper['kind'] == 'transparent' else 255))
        rgba = np.asarray(Image.fromarray(rgba).rotate(-tilt, resample=Image.BICUBIC, expand=False, fillcolor=fill)).copy()
        small = np.asarray(Image.fromarray(rgba).resize(small.shape[1::-1], Image.LANCZOS)).copy()
        paper, ink = find_paper(small)
        leveled = True

    Image.fromarray(rgba).save(os.path.join(outdir, 'source.png'))
    view = Image.fromarray(rgba)
    view.thumbnail((1600, 1600), Image.LANCZOS)
    view.save(os.path.join(outdir, 'view.png'))
    thumb = Image.fromarray(rgba)
    thumb.thumbnail((480, 480), Image.LANCZOS)
    thumb.save(os.path.join(outdir, 'thumb.png'))

    sh, sw = ink.shape
    if paper['kind'] != 'none':
        ink = main_parts(ink)
        window = find_window(ink)
        window_fill = None
        if window is None:
            # a window drawn as a tinted panel is ink to the paper test; find it by its flatness
            window = flat_window(small[..., :3])
            if window is not None:
                fill = np.median(small[..., :3][window], 0)
                paper_lab = lab(np.array(parse_hex(paper['color']), float)) if paper['kind'] == 'paper' else None
                if paper_lab is None or np.linalg.norm(lab(fill) - paper_lab) > 5:
                    window_fill = hex_color(fill)
        shape = silhouette(ink, window)
    else:
        window = flat_window(small[..., :3])
        window_fill = hex_color(np.median(small[..., :3][window], 0)) if window is not None else None
        shape = np.ones_like(ink) if window is None else ~window
    ys, xs = np.nonzero(shape)
    if len(ys) == 0:
        ys, xs = np.array([0, sh - 1]), np.array([0, sw - 1])
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    bbox = [int(x0), int(y0), int(x1 - x0), int(y1 - y0)]
    crop_shape = shape[y0:y1, x0:x1]
    crop_rgb = small[y0:y1, x0:x1, :3]
    gray = lab(crop_rgb.astype(np.float64))[..., 0]
    gray = np.where(crop_shape, gray, gray[crop_shape].mean() if crop_shape.any() else 50)

    win = None
    if window is not None:
        wy, wx = np.nonzero(window[y0:y1, x0:x1])
        if len(wy):
            win = [int(wx.min()), int(wy.min()), int(wx.max() - wx.min() + 1), int(wy.max() - wy.min() + 1)]

    bw, bh = bbox[2], bbox[3]
    coverage = float(crop_shape.mean())
    aspect = max(bw, bh) / max(1, min(bw, bh))
    # blurred a little, so a scan's speckle and a pixel's misalignment don't hide a mirror image
    # each about its best axis near the middle, since a scan is rarely centered on the design
    soft = ndimage.gaussian_filter(gray, max(1.0, 0.004 * max(bw, bh)))
    sym = {'lr': mirror_score(soft)[0], 'tb': mirror_score(soft.T)[0]}
    # the outline alone, which shading lit from one side doesn't spoil
    form = ndimage.gaussian_filter(crop_shape.astype(np.float64), max(1.0, 0.004 * max(bw, bh)))
    (sym['shapeLr'], ax), (sym['shapeTb'], ay) = mirror_score(form), mirror_score(form.T)
    sym['axis'] = [round(ax / max(1, bw), 4), round(ay / max(1, bh), 4)]
    # and the plain lightness, which a mask that missed faint lines can't spoil
    light = ndimage.gaussian_filter(lab(crop_rgb.astype(np.float64))[..., 0], max(1.0, 0.004 * max(bw, bh)))
    sym['lightLr'], sym['lightTb'] = mirror_score(light)[0], mirror_score(light.T)[0]

    repeats = {}
    bands = None
    if win is not None:
        wx, wy, ww, wh = win
        bands = {'top': wy, 'left': wx, 'bottom': bh - (wy + wh), 'right': bw - (wx + ww)}
        top = gray[: max(2, wy), wx: wx + ww]
        left = gray[wy: wy + wh, : max(2, wx)]
        px = period_of(top, 1)
        py = period_of(left, 0)
        if px:
            repeats['x'] = px
        if py:
            repeats['y'] = py
    elif aspect >= 3.0:
        axis = 1 if bw >= bh else 0
        p = period_of(gray, axis)
        if p:
            repeats['x' if axis == 1 else 'y'] = p
    lat = lattice_of(gray) if win is None and aspect < 3.0 and coverage > 0.3 else None

    grid = np.array([[crop_shape[i * bh // 3:(i + 1) * bh // 3, j * bw // 3:(j + 1) * bw // 3].mean() for j in range(3)] for i in range(3)])
    kind, conf = guess_kind(bbox, win, coverage, aspect, lat, grid)

    rgb_small = small[..., :3]
    pal, _, _, _ = palette_of(rgb_small, shape)
    flat, ramp = flatness(rgb_small, shape)
    chroma_share, hues = hue_families(rgb_small, shape)
    carved = carved_lines(rgb_small, shape) if len(pal) <= 6 else None
    # a rough guess (hatched engraving reads as texture here); the reading by eye settles it
    rendering = 'shaded' if flat < 0.7 or ramp > 0.45 else 'flat'
    if chroma_share < 0.06:
        color_mode = 'one-ink' if rendering == 'flat' and len(pal) <= 3 else 'neutral'
    elif len(hues) <= 2 and all(20 <= hh <= 110 for hh in hues) and rendering == 'shaded':
        color_mode = 'neutral'        # one warm hue in shaded relief: gilding, bronze, wood
    else:
        color_mode = 'full'

    s = 1 / k   # back to source pixels
    scale = lambda v: round(v * s, 1)
    for key in repeats:
        repeats[key]['period'] = scale(repeats[key]['period'])
    if lat:
        lat['a'] = [scale(v) for v in lat['a']]
        lat['b'] = [scale(v) for v in lat['b']]
    return {
        'size': [w, h],
        'measuredAt': round(k, 4),
        'background': paper,
        'tilt': tilt,
        'leveled': leveled,
        'bbox': [scale(v) for v in bbox],
        'coverage': round(coverage, 3),
        'aspect': round(aspect, 2),
        'window': [scale(v) for v in win] if win else None,
        'windowFill': window_fill,
        'bands': {key: scale(v) for key, v in bands.items()} if bands else None,
        'symmetry': sym,
        'repeats': repeats,
        'lattice': lat,
        'palette': pal,
        'flatness': flat,
        'ramps': ramp,
        'chromaticShare': chroma_share,
        'hueFamilies': hues,
        'carvedLines': carved,
        'guess': {'kind': kind, 'confidence': conf, 'rendering': rendering, 'colorMode': color_mode},
    }
