"""Stage 6: a drawing's exact-palette tracing copy into one vector layer per color.

The tracing copy is the final drawing rendered at 2 px per design unit, every opaque pixel already
exactly one of the drawing's palette colors (the job worker quantizes it), so each pixel's layer
is simply its nearest palette color: two close colors (a cream ground and a white stem) are
never merged, as clustering might merge them.
"""
import os

import numpy as np
from PIL import Image
from scipy.cluster.vq import vq

from .analyze import carved_lines
from .common import lab, parse_hex
from .layers import build_layers, layered_svg, summary


def vectorize(trace_png, palette, outdir, width=None, height=None, title='Telios'):
    """palette: [{'hex', 'name'}]. Writes layered.svg; returns its layers and size."""
    im = np.asarray(Image.open(trace_png).convert('RGBA'))
    h, w = im.shape[:2]
    shape = im[..., 3] >= 128
    pal = np.array([parse_hex(p['hex']) for p in palette], float)
    order = np.argsort(lab(pal)[:, 0])
    pal = pal[order]
    names = [palette[i].get('name') for i in order]
    colors = ['#%02x%02x%02x' % tuple(int(v) for v in c) for c in pal]
    band = np.zeros((h, w), int)
    band[shape] = vq(im[..., :3][shape].astype(float), pal)[0]
    layers = build_layers(band, shape, colors, names)
    svg = layered_svg(layers, w, h, width, height, title)
    with open(os.path.join(outdir, 'layered.svg'), 'w') as f:
        f.write(svg)
    carved = carved_lines(im[..., :3], shape) if len(colors) <= 6 and max(h, w) <= 4000 else None
    return {'size': [w, h], 'layers': summary(layers), 'carvedLines': carved, 'bytes': len(svg)}
