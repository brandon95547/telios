"""A cutout: a one-ink object on a plain ground, lifted off it. The ground becomes clear, a turned picture is set level,
the edges are cleaned up and a small scan is enlarged smoothly. No model and no redrawing: the picture's own shapes."""
import math

import numpy as np
from PIL import Image
from scipy import ndimage

from .common import load_rgba

TILT_MAX = 6.0
TILT_GAIN = 1.08
MAX_SIDE = 2400
MAX_ENLARGE = 3.0


def ink_of(gray, dark):
    """How much of each pixel is ink (0 to 1): its darkness against the ground around it, which may drift across a scan."""
    g = gray if dark else 255.0 - gray
    ground = ndimage.gaussian_filter(ndimage.maximum_filter(g, size=31), 25)
    return np.clip(1.0 - g / np.maximum(ground, 1.0), 0, 1)


def smoothstep(x, lo, hi):
    t = np.clip((x - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)


def tilt_of(alpha):
    """The angle (degrees, counterclockwise) the object is turned by, or 0 where no angle lines it up clearly better than none."""
    k = min(1.0, 700 / max(alpha.shape))
    small = ndimage.zoom(alpha, k, order=1) if k < 1 else alpha

    def score(d):
        r = ndimage.rotate(small, -d, reshape=False, order=1, mode='constant')
        return max(float(np.var(r.sum(axis=1))), float(np.var(r.sum(axis=0))))

    base = score(0.0)
    if base <= 0:
        return 0.0
    coarse = {d: score(d) for d in np.arange(-TILT_MAX, TILT_MAX + 1e-9, 0.5)}
    best = max(coarse, key=coarse.get)
    fine = {d: score(d) for d in np.arange(best - 0.5, best + 0.5 + 1e-9, 0.1)}
    best = max(fine, key=fine.get)
    return round(float(best), 1) if fine[best] > base * TILT_GAIN and abs(best) >= 0.3 else 0.0


def cutout(source, outdir, cleanup=1, straighten=True):
    import os
    im = load_rgba(source)
    bg = Image.new('RGBA', im.size, (255, 255, 255, 255))
    rgb = np.asarray(Image.alpha_composite(bg, im).convert('RGB'), dtype=np.float64)
    gray = rgb.mean(axis=2)
    if gray.std() < 3:
        raise ValueError('No object was found on the background.')
    edge = np.concatenate([gray[0], gray[-1], gray[:, 0], gray[:, -1]])
    dark = bool(np.median(edge) >= np.median(gray) - 1e-9 and np.median(edge) > 127)
    ink = ink_of(gray, dark)
    alpha = smoothstep(ink, 0.10, 0.70)
    pick = gray < np.percentile(gray, 4) if dark else gray > np.percentile(gray, 96)
    color = rgb[pick].mean(axis=0) * (0.6 if dark else 1.0)

    tilt = tilt_of(alpha) if straighten else 0.0
    if tilt:
        alpha = ndimage.rotate(alpha, -tilt, reshape=True, order=1, mode='constant', cval=0.0)
    if cleanup:
        alpha = ndimage.gaussian_filter(alpha, 0.5 if cleanup == 1 else 0.9)
    if cleanup == 2:
        labels, n = ndimage.label(alpha > 0.5)
        if n:
            sizes = ndimage.sum(np.ones_like(alpha), labels, range(1, n + 1))
            small = np.isin(labels, 1 + np.nonzero(sizes < max(6, alpha.size * 2e-6))[0])
            alpha[ndimage.binary_dilation(small, iterations=2)] = 0

    ys, xs = np.nonzero(alpha > 0.03)
    if not len(xs):
        raise ValueError('No object was found on the background.')
    pad = int(0.02 * max(xs.max() - xs.min(), ys.max() - ys.min())) + 2
    box = (max(0, xs.min() - pad), max(0, ys.min() - pad), min(alpha.shape[1], xs.max() + 1 + pad), min(alpha.shape[0], ys.max() + 1 + pad))
    alpha = alpha[box[1]:box[3], box[0]:box[2]]

    h, w = alpha.shape
    scale = min(MAX_ENLARGE, MAX_SIDE / max(h, w))
    if scale > 1.05 or scale < 1:
        a = Image.fromarray((alpha * 255).round().astype(np.uint8))
        a = a.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.BICUBIC)
        alpha = np.asarray(a, dtype=np.float64) / 255
        if scale > 1:
            # the enlarged edge is soft: steepen it so a line is as crisp as it was at its own size
            alpha = smoothstep(alpha, 0.5 - 0.5 / math.sqrt(scale), 0.5 + 0.5 / math.sqrt(scale))
    h, w = alpha.shape
    rgba = np.zeros((h, w, 4), np.uint8)
    rgba[..., :3] = np.clip(color, 0, 255).round().astype(np.uint8)
    rgba[..., 3] = (alpha * 255).round().astype(np.uint8)
    Image.fromarray(rgba).save(os.path.join(outdir, 'cutout.png'))
    return {
        'size': [w, h], 'tilt': tilt, 'ink': '#%02x%02x%02x' % tuple(int(c) for c in np.clip(color, 0, 255)),
        'light': not dark, 'clear': round(float((alpha < 0.02).mean()), 3), 'enlarged': round(float(scale), 2),
    }
