"""Per-color layers: a band image (each pixel the index of its color, dark to light) traced into
one vector layer per color, written as a layered SVG Illustrator and Inkscape open as layers.

Each layer is its own color, reaching two pixels under the lighter colors drawn over it, so no
seam shows between neighbors, and a fine pattern in one color is traced once, not again in every
layer under it.
"""
import io
import re

import numpy as np
import vtracer
from PIL import Image
from scipy import ndimage

from .common import hex_color

INKSCAPE = 'http://www.inkscape.org/namespaces/inkscape'


def trace_mask(mask, speckle=6):
    img = Image.fromarray(np.where(mask, 0, 255).astype(np.uint8)).convert('RGB')
    buf = io.BytesIO()
    img.save(buf, 'PNG')
    svg = vtracer.convert_raw_image_to_svg(buf.getvalue(), img_format='png', colormode='binary', filter_speckle=speckle,
                                           corner_threshold=80, length_threshold=5.0, splice_threshold=45,
                                           path_precision=1, mode='spline')
    paths = []
    for p in re.findall(r'<path[^>]*/>', svg):
        p = re.sub(r'\s*fill="[^"]*"', '', p)
        paths.append(p)
    return ''.join(paths)


def slug(name, i):
    s = re.sub(r'[^a-z0-9]+', '-', (name or '').lower()).strip('-')
    return f'layer-{i + 1}' + (f'-{s}' if s else '')


def build_layers(band, shape, colors, names=None, speckle=6, reach=2):
    """band: int array of color indices (0 = darkest); shape: where there is art; colors: hex per
    index. Returns the layers (index, color, name, paths, share) dark to light."""
    names = names or [None] * len(colors)
    layers = []
    total = max(1, int(shape.sum()))
    for i, color in enumerate(colors):
        own = shape & (band == i)
        if own.sum() < 4:
            continue
        layer = ndimage.binary_dilation(own, iterations=reach) & shape & (band >= i) if reach else own
        paths = trace_mask(layer, speckle)
        if not paths:
            continue
        layers.append({'index': i, 'color': color, 'name': names[i] or f'Color {i + 1}', 'paths': paths,
                       'share': round(float(own.sum()) / total, 4)})
    return layers


def layered_svg(layers, w, h, width=None, height=None, title='Telios'):
    width = width or w
    height = height or h
    groups = []
    for n, l in enumerate(layers):
        lid = slug(l['name'], n)
        label = l['name'].replace('&', 'and').replace('"', "'").replace('<', '').replace('>', '')
        groups.append(f'<g id="{lid}" inkscape:groupmode="layer" inkscape:label="{label}" fill="{l["color"]}">{l["paths"]}</g>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="{INKSCAPE}" width="{fmt(width)}" height="{fmt(height)}" '
            f'viewBox="0 0 {w} {h}"><title>{title}</title>{"".join(groups)}</svg>\n')


def fmt(v):
    return ('%.3f' % v).rstrip('0').rstrip('.') if isinstance(v, float) else str(v)


def summary(layers):
    return [{'id': slug(l['name'], n), 'color': l['color'], 'name': l['name'], 'share': l['share']} for n, l in enumerate(layers)]


def mean_color(rgb, where):
    sel = rgb[where]
    return hex_color(sel.mean(0)) if len(sel) else '#808080'
