"""Rebuild on a frame drawn here: a known diamond chain, printed badly (speckle, ink lost, a page
number below), must come back clean, symmetric, with its unit measured for fitting."""
import json
import os
import tempfile
import unittest

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

from telios_worker.rebuild import rebuild

BAND, UNIT, NX, NY = 40, 60, 14, 10
W, H = 2 * BAND + NX * UNIT, 2 * BAND + NY * UNIT
PAPER, INK = (232, 226, 214), (40, 38, 36)


def frame():
    """The true frame (a mask) and a bad print of it (an image)."""
    im = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(im)
    for x0, y0, x1, y1 in ((0, 0, W, BAND), (0, H - BAND, W, H), (0, 0, BAND, H), (W - BAND, 0, W, H)):
        d.rectangle((x0, y0, x1 - 1, y1 - 1), fill=255)
    m = BAND // 2

    def diamond(cx, cy, r):
        d.polygon([(cx - r, cy), (cx, cy - r * 0.6), (cx + r, cy), (cx, cy + r * 0.6)], fill=0)
    for i in range(NX):
        cx = BAND + UNIT * i + UNIT / 2
        diamond(cx, m, 22)
        diamond(cx, H - m, 22)
    for j in range(NY):
        cy = BAND + UNIT * j + UNIT / 2
        d.polygon([(m, cy - 22), (m + 13, cy), (m, cy + 22), (m - 13, cy)], fill=0)
        d.polygon([(W - m, cy - 22), (W - m + 13, cy), (W - m, cy + 22), (W - m - 13, cy)], fill=0)
    truth = np.asarray(im) > 127
    rng = np.random.default_rng(1)
    ink = truth & (rng.random(truth.shape) > 0.18)                                  # worn: ink lost
    ink |= ndimage.binary_dilation(truth, iterations=1) & (rng.random(truth.shape) < 0.25)   # spread
    ink |= (rng.random(truth.shape) < 0.002)                                        # specks on the paper
    page = Image.new('RGB', (W + 40, H + 90), PAPER)
    rgb = np.where(ink[..., None], np.array(INK), np.array(PAPER)).astype(np.uint8)
    page.paste(Image.fromarray(rgb), (20, 20))
    ImageDraw.Draw(page).rectangle((30, H + 50, 75, H + 72), fill=INK)          # a page number
    return truth, page


def parts(mask):
    return ndimage.label(mask)[1]


class RebuildTest(unittest.TestCase):
    def test_a_badly_printed_frame_comes_back_clean(self):
        truth, page = frame()
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, 'crop.png')
            page.save(src)
            reading = {'kind': 'frame', 'rendering': 'flat', 'colorMode': 'one-ink', 'symmetry': 'four-way',
                       'repeats': {'axis': 'edges'}, 'palette': [{'hex': '#28261f', 'name': 'Ink'}]}
            out = rebuild(src, tmp, reading, title='test')
            clean = np.asarray(Image.open(os.path.join(tmp, 'clean.png')))[..., 3] > 0
            with open(os.path.join(tmp, 'layered.svg')) as f:
                self.assertIn('inkscape:groupmode="layer"', f.read())
        notes = ' '.join(out['notes'])
        self.assertIn('Mirrored left–right', notes)
        self.assertIn('Mirrored top–bottom', notes)
        # the frame alone, the page number below it left out: its own size and a small margin
        self.assertAlmostEqual(out['size'][0], W + 8, delta=6)
        self.assertAlmostEqual(out['size'][1], H + 8, delta=6)
        layout = out['layout']
        self.assertEqual(layout['form'], 'frame')
        for ax in ('x', 'y'):
            a, b = layout['repeat'][ax]
            self.assertAlmostEqual(b - a, UNIT, delta=UNIT * 0.03, msg=ax)
        # clean: the true number of separate pieces of ink (the frame and its diamonds' gaps),
        # where the print has thousands of specks
        self.assertGreater(parts(np.asarray(page.convert('L')) < 128), 500)
        holes = parts(ndimage.binary_fill_holes(clean) & ~clean)
        self.assertEqual(parts(clean), 1)
        self.assertGreaterEqual(holes, 2 * (NX + NY) - 2)
        self.assertLessEqual(holes, 2 * (NX + NY) + 4)
        self.assertEqual(len(out['layers']), 1)


if __name__ == '__main__':
    unittest.main()
