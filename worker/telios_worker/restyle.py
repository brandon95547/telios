"""Restyle's picture work that Pillow and numpy do best: a zip's pictures unpacked, an EPS drawn
as pixels, a plain background made transparent, and the pictures chosen packed into a zip."""
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


def pack(manifest, out):
    """The files a manifest lists ([{src, name}], name its path in the zip) packed into one zip.
    Pictures are already compressed, so they are stored as they are; SVG is deflated."""
    with zipfile.ZipFile(out, 'w') as z:
        for item in manifest:
            kind = zipfile.ZIP_DEFLATED if item['name'].lower().endswith(('.svg', '.json', '.txt')) else zipfile.ZIP_STORED
            z.write(item['src'], item['name'], compress_type=kind)
    return {'files': len(manifest), 'bytes': os.path.getsize(out)}
