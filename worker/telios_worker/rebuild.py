"""Rebuild: the design redrawn clean without a model, from what its measurements show.

A print is many copies of a few shapes: the halves of a mirrored design, the four corners of a
frame, every unit of a repeating band. Each copy carries its own flaws (speckle, broken lines,
ink spread, a scan's wobble) but not the same ones, so their average is cleaner than any copy.
Rebuild finds the copies, averages them and puts the clean version back in every place:

1. Segment: each pixel's share of each palette color (soft, from its Lab distance); the paper,
   the window and stray marks (a page number, a caption) left out.
2. Mirror: about the best axis near the middle, left to right and top to bottom as the reading
   says, when the halves really agree; the canvas is recentered on the axis.
3. Repeat: a frame's edges and a border's length are folded on their measured period when the
   copies agree (hand-drawn units that vary are left as drawn); the averaged unit is laid back
   whole, eased to fit exactly, and becomes the fitting data. A pattern is folded on its lattice.
4. Clean: smoothed, specks and pinholes removed, each color by the color rule, then traced into
   one vector layer per color.

It keeps the original's drawing (its proportions and its hand) and loses its damage; a model's
re-illustration is new drawing.
"""
import math
import os

import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.cluster.vq import kmeans2, vq

from .analyze import corr, mirror_score, period_of, reach
from .common import color_name, hex_color, lab, parse_hex
from .layers import build_layers, layered_svg, summary
from .trace import gray_of, palette_for, prepare, segment

SOFT = 9.0           # ΔE: how sharply a pixel's color decides its share of each palette color
ART = 0.4            # the share of art at which a pixel is drawn (below a half, so a part one copy lost survives)
MIRROR_MIN = 0.78    # how well the halves must agree (correlation) to be averaged; a relief lit
                     # from one side falls short, and averaging it would ghost its shadows
PERIODIC = 0.6       # how well one unit must match the next to count as repeating
COHERENT = 0.8       # how well the copies must agree with their average to be folded
CARVED = ('#f3e8cf', 'Carved lines')


def rebuild(source, outdir, reading, analysis=None, title='Telios'):
    im, k, (w0, h0) = prepare(source)
    rgba = np.asarray(im)
    mode = reading.get('colorMode', 'full')
    kind = reading.get('kind', 'ornament')
    shaded = reading.get('rendering') == 'shaded'
    notes = []

    # ── 1. Segment ──
    shape, window, paper = segment(rgba, mode, pinhole=12 * k * k, wider=2.5 if shaded else 1.0)
    if window is not None and kind == 'frame':
        shape = trim_strays(shape, window, notes)
    region = shape | (window if window is not None else False)
    if not region.any():
        raise ValueError('No design found in the image.')
    ys, xs = np.nonzero(region)
    m = max(2, round(0.004 * max(rgba.shape[:2])))
    y0, y1 = max(0, ys.min() - m), min(rgba.shape[0], ys.max() + 1 + m)
    x0, x1 = max(0, xs.min() - m), min(rgba.shape[1], xs.max() + 1 + m)
    rgb = rgba[y0:y1, x0:x1, :3].astype(np.float64)
    shape = shape[y0:y1, x0:x1]
    window = window[y0:y1, x0:x1] if window is not None else None
    one_ink = mode == 'one-ink'

    # shaded relief: the engraver's hatching read as the tone it stands for;
    # one ink printed as speckle (a worn block, a coarse scan) is read as its density
    blur = max(1.0, 0.0022 * max(rgb.shape[:2])) if shaded else max(0.8, 0.9 * k) if one_ink else 0.8
    if shaded and not one_ink:
        pal, names = tones(rgb, shape, blur, len(reading.get('palette') or []) or 5)
        notes.append(f'Shaded relief: its hatching and shading read as {len(pal)} flat tones.')
    else:
        labs = lab(ndimage.gaussian_filter(rgb, (0.8, 0.8, 0)))
        pal, names = palette_for(rgb, labs, shape, reading.get('palette'), paper)
        if not one_ink and paper['kind'] == 'paper':
            pal, names = with_paper(pal, names, labs, shape, paper, notes)
    F = memberships(rgb, shape, window, pal, paper, one_ink, blur)
    count = np.ones(shape.shape, np.float32)     # how many copies each pixel is the average of
    win = window.astype(np.float32) if window is not None else None
    tone_of = np.array([lab(np.array(parse_hex(paper['color']), float))[0] if paper['kind'] == 'paper' else 100.0]
                       + [lab(c)[0] for c in pal], np.float32)

    # ── 2. Mirror ──
    sym = reading.get('symmetry', 'none')
    measured = {}
    for axis, wanted in ((2, sym in ('mirror-x', 'four-way')), (1, sym in ('mirror-y', 'four-way'))):
        name = 'left–right' if axis == 2 else 'top–bottom'
        T = tone(F, tone_of)
        img = T if axis == 2 else T.T
        score, c = mirror_score(ndimage.gaussian_filter(img, max(1.0, 0.003 * max(img.shape))))
        measured['lr' if axis == 2 else 'tb'] = score
        if not wanted:
            continue
        if score < MIRROR_MIN:
            notes.append(f'The reading says the design is mirrored {name}, but its halves differ (agreement {score:.2f}), so they were not averaged.')
            continue
        F, count, win = mirror(F, count, win, int(round(2 * c)), axis)
        notes.append(f'Mirrored {name} (the halves agree {score:.2f}) and averaged.')
    if sym == 'rotational':
        T = tone(F, tone_of)
        score = corr(T, T[::-1, ::-1])
        measured['rot'] = round(score, 3)
        if score >= MIRROR_MIN:
            F = (F + F[:, ::-1, ::-1]) / 2
            count = count + count[::-1, ::-1]
            notes.append(f'Turned half a turn (agreement {score:.2f}) and averaged.')
        else:
            notes.append(f'The reading says the design repeats when turned, but it differs (agreement {score:.2f}), so it was not averaged.')
    sym_x, sym_y = any(n.startswith('Mirrored left') for n in notes), any(n.startswith('Mirrored top') for n in notes)

    # ── 3. Repeat ──
    h, w = F.shape[1:]
    layout = None
    axis = (reading.get('repeats') or {}).get('axis', 'none')
    if win is not None:
        # the window as found reaches into the gaps of the band round it; its true edge is inside
        inner = ndimage.binary_erosion(win > 0.5, iterations=reach(win.shape))
        win = inner if inner.any() else win > 0.5
    if kind == 'frame' and win is not None and win.any():
        layout = fold_frame(F, count, win, tone_of, sym_x, sym_y, axis != 'none', notes, k)
    elif kind == 'border' and axis != 'none':
        layout = fold_border(F, count, tone_of, sym_x, sym_y, notes, k)
    elif kind == 'pattern' and axis != 'none':
        F, count, layout = fold_pattern(F, count, tone_of, (analysis or {}).get('lattice'), k, notes)
        h, w = F.shape[1:]
    if layout is None:
        layout = {'form': {'frame': 'frame', 'border': 'border', 'corner': 'corner'}.get(kind, 'whole'), 'size': [w, h]}
        if kind == 'frame':
            ww = np.nonzero(win.any(0))[0] if win is not None else []
            wh = np.nonzero(win.any(1))[0] if win is not None else []
            if len(ww) and len(wh):
                layout['slice'] = [max(ww[0], w - 1 - ww[-1]), max(wh[0], h - 1 - wh[-1])]
        if kind == 'corner':
            layout['corner'] = 'top-left'

    # ── 4. Clean, color, trace ──
    if os.environ.get('TELIOS_DEBUG'):
        Image.fromarray(((1 - F[0]) * 255).clip(0, 255).astype(np.uint8)).save(os.path.join(outdir, 'share.png'))
    band = clean(F, count, max(h, w), one_ink and reading.get('carvedLines'))
    colors = [hex_color(gray_of(c)) if mode == 'neutral' else hex_color(c) for c in pal]
    if mode == 'neutral' and shaded and len(colors) > 1:
        # a scan's gray paper and worn ink squeeze a relief's tones; its base uses the whole range
        colors = spread(colors)
    names = [n or color_name(parse_hex(c)) for n, c in zip(names, colors)]
    if one_ink and reading.get('carvedLines'):
        colors.append(CARVED[0])
        names.append(CARVED[1])
    # layers go dark to light; band 0 is the ground
    order = np.argsort([lab(np.array(parse_hex(c), float))[0] for c in colors], kind='stable')
    rank = np.empty(len(order), int)
    rank[order] = np.arange(len(order))
    art = band > 0
    idx = np.zeros(band.shape, int)
    idx[art] = rank[band[art] - 1]
    colors = [colors[i] for i in order]
    names = [names[i] for i in order]
    layers = build_layers(idx, art, colors, names, speckle=int(4 * max(1, k)))

    W, H = w / k, h / k
    svg = layered_svg(layers, w, h, round(W, 2), round(H, 2), title)
    with open(os.path.join(outdir, 'layered.svg'), 'w') as f:
        f.write(svg)
    preview = np.full((h, w, 4), 0, np.uint8)
    for i, c in enumerate(colors):
        preview[art & (idx == i)] = [*parse_hex(c), 255]
    Image.fromarray(preview).save(os.path.join(outdir, 'clean.png'))
    return {
        'size': [round(W, 2), round(H, 2)],
        'tracedAt': [w, h],
        'layers': summary(layers),
        'palette': [{'hex': c, 'name': n} for c, n in zip(colors, names)],
        'layout': in_units(layout, k),
        'symmetry': measured,
        'notes': notes,
        'bytes': len(svg),
    }


# ── Segmenting ──

def trim_strays(shape, window, notes):
    """A frame without what lies beyond a clear gap outside it: a page number, a caption, a
    neighbor's edge. Scanning out from the window on each side, the first run of empty rows (or
    columns) ends the frame."""
    h, w = shape.shape
    ys, xs = np.nonzero(window)
    if not len(ys):
        return shape
    gap = max(3, round(0.003 * max(h, w)))
    out = shape.copy()
    cut = []
    for side, prof, start, step in (('below', shape.sum(1), ys.max() + 1, 1), ('above', shape.sum(1), ys.min() - 1, -1),
                                    ('right', shape.sum(0), xs.max() + 1, 1), ('left', shape.sum(0), xs.min() - 1, -1)):
        quiet = prof <= max(1, 0.002 * (w if side in ('below', 'above') else h))
        run, i = 0, start
        while 0 <= i < len(prof):
            run = run + 1 if quiet[i] else 0
            if run >= gap:
                edge = i - step * (gap - 1)
                beyond = slice(edge, None) if step > 0 else slice(0, edge + 1)
                removed = int(prof[beyond].sum())
                if removed:
                    if side in ('below', 'above'):
                        out[beyond] = False
                    else:
                        out[:, beyond] = False
                    if removed > max(60, 0.0001 * h * w):    # more than a scan's specks
                        cut.append(side)
                break
            i += step
    if cut:
        notes.append(f'Left out marks beyond a gap {", ".join(cut)} the frame (a page number or caption).')
    return out


def with_paper(pal, names, labs, shape, paper, notes):
    """Color and shaded art often uses the paper itself (a highlight, an uncolored ground): when a
    fair share of the design is the paper's color and no palette color is near it, it joins the
    palette."""
    pl = lab(np.array(parse_hex(paper['color']), float))
    if not shape.any() or (np.linalg.norm(labs[shape] - pl, axis=-1) < 8).mean() < 0.05:
        return pal, names
    if len(pal) and min(np.linalg.norm(lab(c) - pl) for c in pal) < 8:
        return pal, names
    notes.append('The paper shows through as part of the design, so its color is the lightest one.')
    rgb = np.array(parse_hex(paper['color']), float)
    pal = np.vstack([pal, rgb[None]]) if len(pal) else rgb[None]
    names = list(names) + ['Paper']
    order = np.argsort(lab(pal)[:, 0])
    return pal[order], [names[i] for i in order]


def tones(rgb, shape, blur, n):
    """A relief's flat tones: the main colors of its smoothed image, where hatching has become
    the tone it stands for, dark to light, three to five."""
    smooth = ndimage.gaussian_filter(rgb, (blur, blur, 0))[shape]
    smooth = smooth[np.random.default_rng(0).choice(len(smooth), min(len(smooth), 60_000), replace=False)]
    pts = lab(smooth)
    n = max(3, min(5, n))
    centers, _ = kmeans2(pts, n, minit='++', seed=0, iter=30)
    near = vq(pts, centers)[0]
    pal = np.array([smooth[near == i].mean(0) for i in range(n) if (near == i).any()])
    pal = pal[np.argsort(lab(pal)[:, 0])]
    words = {3: ['Shadow', 'Ground', 'Face'], 4: ['Shadow', 'Ground', 'Face', 'Highlight'], 5: ['Line', 'Shadow', 'Ground', 'Face', 'Highlight']}
    return pal, words.get(len(pal), [None] * len(pal))


def memberships(rgb, shape, window, pal, paper, one_ink, blur):
    """Each pixel's share of the ground (channel 0) and of each palette color (1..K), float32."""
    h, w = shape.shape
    L = lab(ndimage.gaussian_filter(rgb, (blur, blur, 0))).astype(np.float32)
    protos = [lab(c).astype(np.float32) for c in pal]
    if one_ink:
        # near the ink, paper and ink compete: the line's own edge decides, not a threshold
        region = ndimage.binary_dilation(shape, iterations=2)
        protos = [lab(np.array(parse_hex(paper['color']), float)).astype(np.float32)] + protos if paper['kind'] == 'paper' else protos
    else:
        region = shape
    d2 = np.stack([((L - p) ** 2).sum(-1) for p in protos])
    d2 -= d2.min(0, keepdims=True)
    e = np.exp(-d2 / (2 * SOFT ** 2))
    e /= e.sum(0, keepdims=True)
    F = np.zeros((len(pal) + 1, h, w), np.float32)
    if one_ink and paper['kind'] == 'paper':
        F[0] = e[0]
        F[1:] = e[1:]
    else:
        F[1:] = e
    edge = ndimage.gaussian_filter(region.astype(np.float32), 0.7)
    if window is not None:
        edge *= ~window
    F[1:] *= edge
    F[0] = 1 - F[1:].sum(0)
    return F


def tone(F, tone_of):
    """A gray image of the memberships: each pixel's lightness."""
    return np.tensordot(tone_of, F, axes=1)


# ── Mirroring ──

def mirror(F, count, win, n2, axis):
    """Average with the mirror image about the pixel-edge position n2 / 2 along `axis` (2: x,
    1: y), each side weighted by how many copies it already holds. The canvas grows on the short
    side so the axis is its middle; a pixel only one side has is taken from that side."""
    size = F.shape[axis]
    before, after = max(0, size - n2), max(0, n2 - size)

    def pad(a, ax, fill=0.0):
        widths = [(0, 0)] * a.ndim
        widths[ax] = (before, after)
        return np.pad(a, widths, constant_values=fill)

    Fp = pad(F, axis)
    Vp = pad(count, axis - 1)
    Fm = np.flip(Fp, axis)
    Vm = np.flip(Vp, axis - 1)
    tot = Vp + Vm
    Fn = (Fp * Vp + Fm * Vm) / np.maximum(tot, 1e-6)
    Fn[0] = np.where(tot > 0, Fn[0], 1)
    W = None
    if win is not None:
        Wp = pad(win, axis - 1)
        W = (Wp * Vp + np.flip(Wp, axis - 1) * Vm) / np.maximum(tot, 1e-6)
    return Fn.astype(np.float32), tot.astype(np.float32), W


def remirror(F, axis):
    """Make F exactly its own mirror image again, its first half copied onto the second."""
    n = F.shape[axis]
    first = [slice(None)] * F.ndim
    second = [slice(None)] * F.ndim
    first[axis] = slice(0, n // 2)
    second[axis] = slice(n - n // 2, n)
    F[tuple(second)] = np.flip(F[tuple(first)], axis)


# ── Repeats ──

def local_periodicity(T, P):
    """For each x: how well the block [x, x + P) matches the next one, [x + P, x + 2P)."""
    d, L = T.shape
    n = L - 2 * P
    if n <= 0:
        return np.zeros(0)
    A, B = T[:, :L - P].astype(np.float64), T[:, P:].astype(np.float64)
    cols = [c.sum(0) for c in (A, B, A * A, B * B, A * B)]
    win = []
    for c in cols:
        cs = np.concatenate([[0], np.cumsum(c)])
        win.append(cs[P:P + n] - cs[:n])
    sa, sb, saa, sbb, sab = win
    N = d * P
    var = (saa - sa * sa / N) * (sbb - sb * sb / N)
    return np.where(var > 1e-9, (sab - sa * sb / N) / np.sqrt(np.maximum(var, 1e-12)), 0.0)


def copies(T, a, p, n, offsets=None):
    """The n copies of the unit [a + i·p, a + (i+1)·p) of a strip, each resampled to Q columns."""
    d, L = T.shape
    Q = int(math.ceil(p))
    t = (np.arange(Q) + 0.5) * p / Q - 0.5
    out = np.empty((n, d, Q), np.float32)
    rows = np.arange(d)[:, None]
    for i in range(n):
        x = np.clip(a + i * p + t + (offsets[i] if offsets is not None else 0), 0, L - 1)
        x0 = np.floor(x).astype(int)
        x1 = np.minimum(x0 + 1, L - 1)
        f = (x - x0).astype(np.float32)
        out[i] = T[rows, x0] * (1 - f) + T[rows, x1] * f
    return out


def coherence(cs):
    mean = cs.mean(0)
    return float(np.mean([corr(c, mean) for c in cs])), mean


def fold_strip(S, tone_of, mirrored, lead, fixed=None):
    """Fold a band (channels × depth × length) on its period. Returns the geometry it found,
    {a, p, n, end, keep, coherence}, with S rewritten in place; or None when it doesn't repeat
    cleanly. `fixed` reuses another strip's geometry (the foot of a frame whose head was folded)."""
    K, d, L = S.shape
    # only what changes along the band can show a repeat: rules and grounds that run its whole
    # length match any shift, so they are taken out before copies are compared
    T = np.tensordot(tone_of, S, axes=1)
    T = T - T.mean(1, keepdims=True)
    if fixed is None:
        est = period_of(T, 1)
        if not est or est['strength'] < 0.3 or L / est['period'] < 4:
            return None
        p = est['period']
        P = int(round(p))
        s = local_periodicity(T, P)
        good = s > PERIODIC
        # the longest stretch that repeats, allowing short breaks
        runs, start, gapn = [], None, 0
        for x, g in enumerate(good):
            if g:
                start = x if start is None else start
                gapn = 0
            elif start is not None:
                gapn += 1
                if gapn > P // 4:
                    runs.append((start, x - gapn))
                    start, gapn = None, 0
        if start is not None:
            runs.append((start, len(good) - 1 - gapn))
        if not runs:
            return None
        r0, r1 = max(runs, key=lambda r: r[1] - r[0])
        span = (r0, r1 + 2 * P)
        if span[1] - span[0] < 3 * p:
            return None
        a = span[0]
        if a < lead:
            a += math.ceil((lead - a) / p) * p
        keep = None
        if mirrored and not (span[0] < L / 2 - p and span[1] > L / 2 + p):
            # the units turn round in the middle: the first half repeats up to a kept middle
            end = min(span[1], L / 2)
            n = int((end - a) // p)
            if n < 2:
                return None
            keep = [a + n * p, L - (a + n * p)]
            if keep[1] - keep[0] < 1:
                keep = None
            end = a + n * p
        else:
            end = L - a if mirrored else min(span[1], L - lead)
            n = int(round((end - a) / p))
            if n < 2:
                return None
        # the period that makes the copies agree best
        best = max(np.linspace(p * 0.98, p * 1.02, 41), key=lambda q: coherence(copies(T, a, q, n))[0])
        p = float(best)
        if keep is None and mirrored:
            # units placed symmetrically about the middle, as many as fit after the corners
            n = int((L - 2 * lead) // p)
            a = (L - n * p) / 2
            end = L - a
        elif keep is None:
            end = a + n * p
        if n < 4 or n * p < 0.3 * (L - 2 * lead):
            return None   # a short stretch that happens to repeat, not the edge's own unit
    else:
        a, p, n, keep, end = fixed['a'], fixed['p'], fixed['n'], fixed['keep'], fixed['end']
    # each copy's own small shift (a scan's wobble)
    offsets = np.zeros(n)
    for _ in range(2):
        cs = copies(T, a, p, n, offsets)
        mean = cs.mean(0)
        for i in range(n):
            offsets[i] += max(np.arange(-2, 2.01, 0.25), key=lambda o: corr(copies(T, a + i * p + offsets[i] + o, p, 1)[0], mean))
    c, _ = coherence(copies(T, a, p, n, offsets))
    if c < COHERENT:
        return None
    # the clean unit, every channel
    Q = int(math.ceil(p))
    unit = np.stack([copies(S[j], a, p, n, offsets).mean(0) for j in range(K)])   # K × d × Q
    # laid back whole: in a symmetric band the units fill [a, L − a] exactly (eased); else [a, end)
    stop = end if keep is not None or not mirrored else L - a
    each = (stop - a) / n
    x = np.arange(math.floor(a), min(L, math.ceil(stop)))
    phase = ((x + 0.5 - a) / each) % 1.0
    idx = phase * Q - 0.5
    i0 = np.floor(idx).astype(int) % Q
    i1 = (i0 + 1) % Q
    f = (idx - np.floor(idx)).astype(np.float32)
    inside = (x + 0.5 >= a) & (x + 0.5 < stop)
    xs, i0, i1, f = x[inside], i0[inside], i1[inside], f[inside]
    S[:, :, xs] = unit[:, :, i0] * (1 - f) + unit[:, :, i1] * f
    return {'a': float(a), 'p': float(p), 'n': n, 'each': float(each), 'end': float(stop), 'keep': keep, 'coherence': round(c, 3)}


def fold_frame(F, count, window, tone_of, sym_x, sym_y, repeats, notes, k=1.0):
    """A frame's four edges folded on their units; its layout (slice, keep, repeat) from them.
    k: traced pixels per design unit, for the notes."""
    K, h, w = F.shape
    ww = np.nonzero(window.any(0))[0]
    wh = np.nonzero(window.any(1))[0]
    left, right, top, bottom = ww[0], w - 1 - ww[-1], wh[0], h - 1 - wh[-1]
    layout = {'form': 'frame', 'size': [w, h], 'slice': [max(left, right), max(top, bottom)]}
    if not repeats:
        return layout
    sx, sy = layout['slice']
    found = {}
    # x: the head (and the foot when it isn't the head's mirror image)
    head = np.ascontiguousarray(F[:, :top, :])
    gx = fold_strip(head, tone_of, sym_x, sx)
    if gx:
        F[:, :top, :] = head
        count[:top, folded(gx, w)] *= gx['n']
        if sym_y:
            remirror(F, 1)
            remirror(count[None], 1)
        else:
            foot = np.ascontiguousarray(F[:, h - bottom:, :])
            if fold_strip(foot, tone_of, sym_x, sx, fixed=gx):
                F[:, h - bottom:, :] = foot
                count[h - bottom:, folded(gx, w)] *= gx['n']
            else:
                notes.append('The foot does not repeat like the head, so it was left as drawn; fitted sizes may show it.')
        found['x'] = gx
    # y: the sides
    side = np.ascontiguousarray(F[:, :, :left].transpose(0, 2, 1))
    gy = fold_strip(side, tone_of, sym_y, sy)
    if gy:
        F[:, :, :left] = side.transpose(0, 2, 1)
        count[folded(gy, h), :left] *= gy['n']
        if sym_x:
            remirror(F, 2)
            remirror(count[None], 2)
        else:
            other = np.ascontiguousarray(F[:, :, w - right:].transpose(0, 2, 1))
            if fold_strip(other, tone_of, sym_y, sy, fixed=gy):
                F[:, :, w - right:] = other.transpose(0, 2, 1)
                count[folded(gy, h), w - right:] *= gy['n']
        found['y'] = gy
    if sym_x and gx:
        remirror(F, 2)
        remirror(count[None], 2)
    if sym_y and gy:
        remirror(F, 1)
        remirror(count[None], 1)
    if sym_x and sym_y:
        corner_diagonal(F, count, gx, gy, sx, sy, tone_of, notes)
    for ax, g in found.items():
        layout.setdefault('repeat', {})[ax] = [g['a'], g['a'] + g['each']]
        if g['keep']:
            layout.setdefault('keep', {})[ax] = g['keep']
        edge = 'top and bottom edges' if ax == 'x' else 'sides'
        notes.append(f'The {edge} repeat a unit {g["each"] / k:.0f} px long: {g["n"]} copies averaged (they agree {g["coherence"]:.2f}) and laid back whole{", with a kept middle" if g["keep"] else ""}.')
    if not found:
        notes.append('The edges do not repeat cleanly enough to average (hand-drawn units vary), so they were kept as drawn and the frame fits by its corners.')
    return layout


def folded(g, L):
    """The positions a fold rewrote."""
    return slice(int(math.floor(g['a'])), min(L, int(math.ceil(g['end']))))


def corner_diagonal(F, count, gx, gy, sx, sy, tone_of, notes):
    """A square frame corner where the head and the sides are one band is its own mirror image
    across the diagonal: its two halves are averaged too, then put back in all four corners."""
    K, h, w = F.shape
    c = int(min(gx['a'] if gx else sx, gy['a'] if gy else sy, w // 2, h // 2))
    if c < 8 or abs(sx - sy) > 0.08 * max(sx, sy):
        return
    block = F[:, :c, :c]
    T = np.tensordot(tone_of, block, axes=1)
    score = corr(T, T.T)
    if score < MIRROR_MIN:
        return
    F[:, :c, :c] = (block + block.transpose(0, 2, 1)) / 2
    count[:c, :c] *= 2
    for ax in (2, 1):
        remirror(F, ax)
        remirror(count[None], ax)
    notes.append(f'The corners mirror across their diagonal (agreement {score:.2f}), so their halves were averaged too.')


def fold_border(F, count, tone_of, sym_x, sym_y, notes, k=1.0):
    K, h, w = F.shape
    if h > w:
        S = np.ascontiguousarray(F.transpose(0, 2, 1))
        g = fold_strip(S, tone_of, sym_y, 0)
        if g:
            F[:] = S.transpose(0, 2, 1)
            count[folded(g, h), :] *= g['n']
            notes.append(f'A unit {g["each"] / k:.0f} px long repeats down the border: {g["n"]} copies averaged and laid back whole. Turn it a quarter to fit it as a horizontal border.')
        return {'form': 'whole', 'size': [w, h]}
    g = fold_strip(F, tone_of, sym_x, 0)
    if g:
        count[:, folded(g, w)] *= g['n']
    if not g:
        notes.append('The border does not repeat cleanly enough to average, so it was kept as drawn.')
        return {'form': 'border', 'size': [w, h]}
    notes.append(f'A unit {g["each"] / k:.0f} px long repeats along the border: {g["n"]} copies averaged (they agree {g["coherence"]:.2f}) and laid back whole.')
    return {'form': 'border', 'size': [w, h], 'repeat': {'x': [g['a'], g['a'] + g['each']]}}


def fold_pattern(F, count, tone_of, lattice, k, notes):
    """A surface pattern folded on its lattice into one tile (a rectangle that repeats on a grid)."""
    K, h, w = F.shape
    if not lattice:
        notes.append('No lattice was measured, so the pattern was kept as drawn.')
        return F, count, None
    (ax, ay), (bx, by) = [np.array(v, float) * k for v in (lattice['a'], lattice['b'])]
    if abs(ay) > 1.5 or abs(ax) < 4 or abs(by) < 4:
        notes.append('The pattern\'s lattice is slanted, so it was kept as drawn.')
        return F, count, None
    ax, by = abs(ax), abs(by)
    # the rectangle that repeats on a plain grid: one cell, or two when rows are offset
    rows = 1 if abs(bx) < 1.5 or abs(abs(bx) - ax) < 1.5 else 2
    tw, th = ax, by * rows
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    Qx, Qy = int(math.ceil(tw)), int(math.ceil(th))
    u = np.floor(((xx + 0.5) % tw) / tw * Qx).astype(int)
    v = np.floor(((yy + 0.5) % th) / th * Qy).astype(int)
    cell = (v * Qx + u).ravel()
    counts = np.bincount(cell, minlength=Qx * Qy).astype(np.float32)
    if counts.min() < 2:
        notes.append('The image holds less than two whole repeats, so the pattern was kept as drawn.')
        return F, count, None
    tile = np.stack([np.bincount(cell, weights=F[j].ravel(), minlength=Qx * Qy) / counts for j in range(K)]).reshape(K, Qy, Qx)
    T = np.tensordot(tone_of, F, axes=1)
    Tt = np.tensordot(tone_of, tile, axes=1)
    r2 = corr(T.ravel(), Tt.ravel()[cell])
    if r2 < COHERENT:
        notes.append(f'The repeats differ too much to average (agreement {r2:.2f}), so the pattern was kept as drawn.')
        return F, count, None
    notes.append(f'One tile {tw / k:.0f} × {th / k:.0f} px, averaged over {counts.mean():.0f} repeats (they agree {r2:.2f}).')
    return tile.astype(np.float32), counts.reshape(Qy, Qx), {'form': 'tile', 'size': [Qx, Qy], 'lattice': 'grid'}


# ── Cleaning ──

def clean(F, count, long, carved=False):
    """The memberships as one color per pixel (0: ground), smooth, without specks or pinholes.
    `count`: how many copies each pixel averages, which says how faint a line can be and still
    be told from noise."""
    K = F.shape[0]
    # smoother where few copies were averaged: their speckle is still in them
    few = np.clip((16 - count) / 15, 0, 1)
    F = np.stack([ndimage.gaussian_filter(c, 1.0) * (1 - few) + ndimage.gaussian_filter(c, 2.5) * few for c in F])
    A = 1 - F[0]
    sharp = A + 1.5 * (A - ndimage.gaussian_filter(A, 3.0))
    # a fine line many copies agree on, though faint in each (worn type, a sparse speckle)
    rise = A - ndimage.grey_opening(A, size=(7, 7))
    noise = 0.3 / np.sqrt(np.maximum(count, 1))
    art = (sharp >= ART) | ((rise > noise) & (A > 1.5 * noise))
    band = np.where(art, 1 + F[1:].argmax(0), 0)
    # a 5-pixel majority vote, then specks under a minimum size handed to their surroundings
    votes = np.stack([ndimage.uniform_filter((band == i).astype(np.float32), 5) for i in range(K)])
    band = votes.argmax(0)
    least = max(6, int((0.002 * long) ** 2))
    for c in range(K):
        parts, n = ndimage.label(band == c)
        if not n:
            continue
        sizes = ndimage.sum(np.ones_like(parts), parts, range(1, n + 1))
        small = np.isin(parts, 1 + np.nonzero(sizes < least)[0])
        band[small] = -1
    lost = band < 0
    if lost.any():
        _, (iy, ix) = ndimage.distance_transform_edt(lost, return_indices=True)
        band = band[iy, ix]
    if carved:
        # light lines cut in the ink: the paper enclosed by it, in its own color
        ink = band == 1
        holes = ndimage.binary_fill_holes(ink) & (band == 0)
        parts, n = ndimage.label(holes)
        if n:
            sizes = ndimage.sum(np.ones_like(parts), parts, range(1, n + 1))
            band[np.isin(parts, 1 + np.nonzero(sizes < 0.01 * band.size)[0])] = K
    return band


def spread(grays, lo=24.0, hi=93.0):
    """Grays spaced over lightness lo to hi, keeping their order and relative steps."""
    L = np.array([lab(np.array(parse_hex(c), float))[0] for c in grays])
    a, b = L.min(), L.max()
    out = []
    for v in L:
        t = lo + (v - a) / (b - a) * (hi - lo) if b > a else v
        y = ((t + 16) / 116) ** 3 if t > 8 else t / 903.3
        g = 12.92 * y if y <= 0.0031308 else 1.055 * y ** (1 / 2.4) - 0.055
        out.append(hex_color([round(max(0, min(1, g)) * 255)] * 3))
    return out


def in_units(layout, k):
    """The layout from traced pixels to the drawing's units (the upload's pixels)."""
    if not layout:
        return None
    s = lambda v: round(v / k, 2)
    out = dict(layout)
    out['size'] = [s(v) for v in layout['size']]
    if 'slice' in layout:
        out['slice'] = [s(v) for v in layout['slice']]
    for key in ('repeat', 'keep'):
        if key in layout:
            out[key] = {ax: [s(v) for v in r] for ax, r in layout[key].items()}
    return out
