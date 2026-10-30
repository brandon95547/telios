"""Restyle's picture work that Pillow and numpy do best: a zip's pictures unpacked, an EPS drawn
as pixels, a plain or a key-color background made transparent, and the pictures chosen packed into a zip."""
import os
import zipfile

import numpy as np
from PIL import Image, ImageOps
from scipy import ndimage

from .common import load_rgba

# What an upload or a zip may hold (lowercase extensions). SVG is drawn by the API (sharp);
# EPS here, by Ghostscript; a PDF's pages by `pdfpages`.
PICTURES = {'.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff', '.gif', '.bmp', '.svg', '.eps', '.ps', '.pdf'}


def unzip(path, outdir, max_files=1000, max_bytes=4_000_000_000):
    """The pictures in a zip, each written under a fresh name (never the zip's own path, so
    nothing can land outside `outdir`), with its name and the folder it was in. Skips what is
    not a picture, macOS's resource forks and hidden files; stops at max_files or max_bytes
    unpacked, so a zip that inflates to terabytes cannot fill the disk."""
    found, skipped, total = [], 0, 0
    with zipfile.ZipFile(path) as z:
        for info in z.infolist():
            name = info.filename.replace('\\', '/')
            parts = [p for p in name.split('/') if p and p not in ('.', '..')]
            if info.is_dir() or not parts:
                continue
            base = parts[-1]
            ext = os.path.splitext(base)[1].lower()
            if '__MACOSX' in parts or base.startswith('.') or ext not in PICTURES:
                skipped += 1
                continue
            if len(found) >= max_files or total + info.file_size > max_bytes:
                skipped += 1
                continue
            target = os.path.join(outdir, f'{len(found):05d}{ext}')
            written = 0
            with z.open(info) as src, open(target, 'wb') as dst:
                while chunk := src.read(1 << 20):
                    written += len(chunk)
                    if total + written > max_bytes:   # the header lied about its size
                        break
                    dst.write(chunk)
            if total + written > max_bytes:
                os.remove(target)
                skipped += 1
                break
            total += written
            found.append({'file': target, 'name': base, 'folder': '/'.join(parts[:-1])})
    return {'files': found, 'skipped': skipped}


def eps(path, out, longest=2048):
    """An EPS (or PostScript) drawn as a PNG about `longest` pixels across, on white."""
    from PIL import EpsImagePlugin  # noqa: F401  (registers the reader; needs Ghostscript, `gs`)
    im = Image.open(path)
    w, h = im.size
    im.load(scale=max(1, min(16, round(longest / max(w, h, 1)))))
    im = im.convert('RGBA')
    flat = Image.new('RGB', im.size, 'white')
    flat.paste(im, mask=im.getchannel('A'))
    flat.thumbnail((longest, longest), Image.Resampling.LANCZOS)
    flat.save(out)
    return {'size': list(flat.size)}


def raster(path, out):
    """A picture Pillow reads and the API's sharp may not (BMP, an odd TIFF), as a PNG."""
    im = load_rgba(path)
    im.save(out)
    return {'size': list(im.size)}


def whiten(path, out, near=20, least=0.2):
    """A scan's paper made white: the most common light color, if it covers at least `least` of
    the picture, scaled to white, and every color with it (yellowed or gray paper redrawn would
    stay yellowed or gray). Anything else is written as it is."""
    im = ImageOps.exif_transpose(Image.open(path)).convert('RGB')
    rgb = np.asarray(im).astype(np.float64)
    luma = rgb @ np.array([0.299, 0.587, 0.114])
    light = rgb[luma > 120]
    paper = None
    if len(light) > least * luma.size:
        bins = (light // 8).astype(np.int64)
        keys = bins[:, 0] * 1024 + bins[:, 1] * 32 + bins[:, 2]
        top = np.bincount(keys).argmax()
        paper = np.median(light[keys == top], 0)
        if (np.linalg.norm(rgb - paper, axis=-1) < near).mean() < least or paper.min() >= 245:
            paper = None
    if paper is None:
        im.save(out)
        return {'paper': None}
    Image.fromarray(np.clip(rgb * (255.0 / np.maximum(paper, 1)), 0, 255).round().astype(np.uint8)).save(out)
    return {'paper': '#%02x%02x%02x' % tuple(int(round(c)) for c in paper)}


def key(path, out, ground='white', everything=False, tolerance=40, window=0.04):
    """The plain background of a drawn picture made transparent: the near-white (or near-black)
    that reaches the edges, and any enclosed patch of it bigger than `window` of the picture (a
    frame's opening); with `everything`, all of it, leaving line art's ink alone, in black. Edges are softened by how near
    each pixel is to the ground, and the ground's tint is taken out of what stays half-clear."""
    rgb = np.asarray(ImageOps.exif_transpose(Image.open(path)).convert('RGB')).astype(np.float64)
    h, w = rgb.shape[:2]
    if everything and ground == 'white':
        # line art: ink alone, black, as opaque as it is dark; the paper and any gray wash go
        luma = rgb @ np.array([0.299, 0.587, 0.114])
        alpha = np.clip((235 - luma) / 175, 0, 1)
        rgba = np.dstack([np.zeros((h, w, 3)), alpha * 255]).round().astype(np.uint8)
        Image.fromarray(rgba).save(out)
        return {'size': [w, h], 'clear': round(float((alpha < 0.02).mean()), 4)}
    far = (255 - rgb.min(axis=2)) if ground == 'white' else rgb.max(axis=2)   # 0 on the ground
    near = far < tolerance
    if everything:
        bg = near
    else:
        labels, n = ndimage.label(near)
        edge = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
        sizes = ndimage.sum(near, labels, index=np.arange(1, n + 1))
        keep = set(edge.tolist()) | {i + 1 for i, s in enumerate(sizes) if s > window * h * w}
        keep.discard(0)
        bg = np.isin(labels, list(keep))
    # a soft edge: on the ground, clear by how near a pixel is to it; off it, kept
    alpha = np.where(bg, np.clip((far - 8) / (tolerance - 8), 0, 1), 1.0)
    g = 255.0 if ground == 'white' else 0.0
    a = alpha[..., None]
    color = np.where(a > 0.02, (rgb - g * (1 - a)) / np.maximum(a, 0.02), rgb)
    rgba = np.dstack([np.clip(color, 0, 255), alpha * 255]).round().astype(np.uint8)
    Image.fromarray(rgba).save(out)
    return {'size': [w, h], 'clear': round(float(bg.mean()), 4)}


def _smooth(x, lo, hi):
    t = np.clip((x - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)


def pick_key(path):
    """The key color a picture can be cut out of: green, unless the picture has greens of its own
    (a green dress, leaves) that green would take with it, and then blue. Magenta was tried and
    turns skin pink. Chosen from the colors the picture already has."""
    hsv = np.asarray(ImageOps.exif_transpose(Image.open(path)).convert('RGB').convert('HSV')).astype(np.float64)
    hue, sat, val = hsv[..., 0] * 360 / 255, hsv[..., 1] / 255, hsv[..., 2] / 255
    colored = (sat > 0.3) & (val > 0.2)
    green = float(((hue > 75) & (hue < 170) & colored).mean())
    blue = float(((hue > 190) & (hue < 265) & colored).mean())
    return {'color': 'blue' if green > max(blue, 0.03) else 'green', 'green': round(green, 4), 'blue': round(blue, 4)}


def ground(path, out, color='#00ff00', least=0.01):
    """A picture's plain ground (the one color that fills its edges: white, black, any) painted in
    `color`: redrawn from a picture on white or black, FLUX keeps that ground whatever it is asked
    (a black one in the middle and a green frame round it comes out a murky teal), but it keeps
    any other. A picture whose edges are not one plain color has no ground to paint."""
    rgb = np.asarray(ImageOps.exif_transpose(Image.open(path)).convert('RGB')).astype(np.float64)
    edges = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    base = np.median(edges, axis=0)
    if (np.linalg.norm(edges - base, axis=1) < 30).mean() < 0.7:   # the edges are the art itself
        Image.fromarray(rgb.round().astype(np.uint8)).save(out)
        return {'ground': 0.0}
    away = np.linalg.norm(rgb - base, axis=2)
    labels, n = ndimage.label(away < 30)
    edge = set(np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]])).tolist()) - {0}
    region = np.isin(labels, list(edge)) if edge else np.zeros(away.shape, bool)
    if region.mean() < least or region.mean() > 0.97:   # none, or the whole picture is one color
        Image.fromarray(rgb.round().astype(np.uint8)).save(out)
        return {'ground': 0.0}
    amount = np.where(ndimage.binary_dilation(region, iterations=2), np.clip((50 - away) / 25, 0, 1), 0)[..., None]
    key = np.array([int(color[i:i + 2], 16) for i in (1, 3, 5)], np.float64)
    Image.fromarray((rgb * (1 - amount) + key * amount).round().astype(np.uint8)).save(out)
    return {'ground': round(float(region.mean()), 4)}


def chroma(path, out, color='green', island=0.0005, hole=0.001, reach=24):
    """A picture drawn on a flat key-color backdrop (green or blue) cut out of it. FLUX draws the
    backdrop with a gradient, a floor and a glow, so it is found by how far each pixel leans to the key
    color against its own brightness, with the thresholds set from the picture's own backdrop: a pale
    wall, a dark corner and a floor all go, orange hair, skin and black clothes stay. Along the cut a
    pixel is part backdrop: how much is worked out and taken out of its color, so a strand of hair
    comes out orange, not olive. A small enclosed patch that only looks like backdrop (a green
    reflection in an eye) is kept; a real gap (a hair loop, between an arm and the body) is cleared.
    Written with the backdrop's share in `clear` (0 when the picture has no such backdrop)."""
    rgb = np.asarray(ImageOps.exif_transpose(Image.open(path)).convert('RGB')).astype(np.float64)
    h, w = rgb.shape[:2]
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    if color == 'green':
        main, excess, wide = g, g - np.maximum(r, b), g - (r + b) / 2
    else:
        main, excess, wide = b, b - np.maximum(r, g), b - (r + g) / 2
    share = excess / np.maximum(main, 1) * np.clip(main / 40.0, 0, 1)   # a very dark pixel's color is noise
    leaning = share > 0.35
    if leaning.mean() < 0.02:
        Image.fromarray(rgb.round().astype(np.uint8)).save(out)
        return {'size': [w, h], 'clear': 0.0, 'partly': 0.0}
    typical = float(np.median(share[leaning]))
    lo, hi = float(np.clip(0.58 * typical, 0.25, 0.45)), float(np.clip(0.82 * typical, 0.38, 0.62))
    alpha = 1 - _smooth(share, lo, hi)
    # and by how much, in absolute terms: dark clothes in the backdrop's light lean to the key color by
    # ratio, because dark colors are small, but nowhere near as far as the wall does
    wall = float(np.median(excess[leaning]))
    alpha = np.maximum(alpha, 1 - _smooth(excess, 0.25 * wall, 0.5 * wall))

    def regions(mask):
        labels, n = ndimage.label(mask, structure=np.ones((3, 3)))
        sizes = ndimage.sum(np.ones(mask.shape), labels, index=np.arange(1, n + 1)) if n else []
        edge = set(np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]])).tolist())
        return labels, sizes, edge

    # specks of picture left in the backdrop go
    labels, sizes, _ = regions(alpha > 0.5)
    alpha = np.where(np.isin(labels, [i + 1 for i, a in enumerate(sizes) if a < island * h * w]), 0, alpha)
    # backdrop is what reaches the edge, or a real gap (as much the backdrop's color as the wall is).
    # An enclosed patch that is small, or that leans to the key color less than the wall does (a
    # reflection in an eye, clothes or skin tinted by the backdrop's light), is part of the picture
    labels, sizes, edge = regions(alpha < 0.5)
    ids = [i + 1 for i in range(len(sizes)) if (i + 1) not in edge]
    typical_in = dict(zip(ids, ndimage.median(share, labels, index=ids))) if ids else {}
    keep = [i for i in ids if sizes[i - 1] < hole * h * w or typical_in[i] < 0.85 * typical]
    alpha = np.where(np.isin(labels, keep), 1.0, alpha)
    clear = alpha < 0.5
    alpha = np.where(clear, 0.0, alpha)

    # along the cut: how much of a pixel is backdrop (how far it leans against the backdrop beside it),
    # and the backdrop's share taken out of its color
    zone = (ndimage.distance_transform_edt(~clear) <= reach) & ~clear
    weight = clear.astype(np.float64)[..., None]
    beside = ndimage.gaussian_filter(rgb * weight, (4, 4, 0)) / np.maximum(ndimage.gaussian_filter(weight, (4, 4, 0)), 1e-3)
    nearest = ndimage.distance_transform_edt(~clear, return_distances=False, return_indices=True)
    k = beside[nearest[0], nearest[1]]
    k_wide = (k[..., 1] - (k[..., 0] + k[..., 2]) / 2) if color == 'green' else (k[..., 2] - (k[..., 0] + k[..., 1]) / 2)
    covered = np.where(zone, np.clip((wide / np.maximum(k_wide, 30) - 0.1) / 0.9, 0, 1), 0)
    alpha = np.where(zone, np.minimum(alpha, 1 - covered), alpha)
    a = np.maximum(alpha, 0.05)[..., None]
    colors = np.where(zone[..., None], (rgb - (1 - a) * k) / a, rgb)
    # a pixel nearly all backdrop has too little of itself to unmix: the nearest solid pixel's color
    solid = ndimage.binary_erosion(alpha > 0.9, iterations=2)
    if solid.any():
        solid_at = ndimage.distance_transform_edt(~solid, return_distances=False, return_indices=True)
        colors = np.where((zone & (alpha < 0.4))[..., None], np.clip(colors, 0, 255)[solid_at[0], solid_at[1]], colors)
    # the backdrop's light on what stays: all of it taken out along the cut, 60% of it elsewhere (clothes
    # that are really navy would go dark green if it were all)
    cr, cg, cb = colors[..., 0], colors[..., 1], colors[..., 2]
    strength = np.where(zone, 1.0, 0.6)
    if color == 'green':
        colors = np.dstack([cr, cg - strength * (cg - np.minimum(cg, np.maximum(cr, cb))), cb])
        # skin and hair lit by the wall go olive: in a warm color, green over 90% of red is the wall's
        # light, so it is held there; a real green (green well over red) fades out of this
        warm = cr > 1.15 * cb
        ratio = colors[..., 1] / np.maximum(colors[..., 0], 1)
        held = 1 - _smooth(ratio, 1.15, 1.4)
        colors[..., 1] = np.where(warm, colors[..., 1] - held * (colors[..., 1] - np.minimum(colors[..., 1], 0.9 * cr)), colors[..., 1])
    else:
        colors = np.dstack([cr, cg, cb - strength * (cb - np.minimum(cb, np.maximum(cr, cg)))])
        # the same for blue: in a warm color, blue over 80% of red is the wall's light
        warm = (cr > cg) & (cr > 1.1 * np.minimum(cg, cb))
        ratio = colors[..., 2] / np.maximum(colors[..., 0], 1)
        held = 1 - _smooth(ratio, 1.2, 1.5)
        colors[..., 2] = np.where(warm, colors[..., 2] - held * (colors[..., 2] - np.minimum(colors[..., 2], 0.8 * cr)), colors[..., 2])
    # a small scrap against the edge of the picture, apart from the figure, is backdrop that got through
    labels, sizes, edge = regions(alpha > 0.5)
    if len(sizes) > 1:
        biggest = int(np.argmax(sizes)) + 1
        scraps = [i for i in edge if i and i != biggest and sizes[i - 1] < 0.05 * sizes[biggest - 1]]
        alpha = np.where(np.isin(labels, scraps), 0.0, alpha)
    Image.fromarray(np.dstack([np.clip(colors, 0, 255), alpha * 255]).round().astype(np.uint8)).save(out)
    return {'size': [w, h], 'clear': round(float((alpha < 0.02).mean()), 4), 'partly': round(float(((alpha >= 0.02) & (alpha <= 0.98)).mean()), 4)}


def pack(manifest, out):
    """The files a manifest lists ([{src, name}], name its path in the zip) packed into one zip.
    Pictures are already compressed, so they are stored as they are; SVG is deflated."""
    with zipfile.ZipFile(out, 'w') as z:
        for item in manifest:
            kind = zipfile.ZIP_DEFLATED if item['name'].lower().endswith(('.svg', '.json', '.txt')) else zipfile.ZIP_STORED
            z.write(item['src'], item['name'], compress_type=kind)
    return {'files': len(manifest), 'bytes': os.path.getsize(out)}
