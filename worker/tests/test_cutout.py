import os
import tempfile
import unittest

import numpy as np
from PIL import Image

from telios_worker.cutout import cutout, ink_of, tilt_of


def engraving(w=320, h=140, drift=True):
    """Black strokes on gray paper that is lighter toward the right."""
    a = np.zeros((h, w), np.uint8)
    paper = np.tile(np.linspace(200, 235, w) if drift else np.full(w, 220.0), (h, 1))
    a[:] = paper
    a[60:66, 40:280] = 20
    a[30:100, 90:95] = 20
    return a


def run(arr, **kw):
    d = tempfile.mkdtemp()
    src = os.path.join(d, 's.png')
    Image.fromarray(arr).save(src)
    info = cutout(src, d, **kw)
    return info, np.asarray(Image.open(os.path.join(d, 'cutout.png')))


class Cutout(unittest.TestCase):
    def test_paper_goes_clear_whatever_its_drift_and_ink_stays_solid(self):
        info, rgba = run(engraving())
        self.assertEqual(rgba.shape[2], 4)
        self.assertEqual(rgba[0, 0, 3], 0)
        self.assertGreater((rgba[..., 3] == 255).sum(), 200)
        self.assertLess(rgba[rgba[..., 3] == 255][:, :3].max(), 40)
        self.assertFalse(info['light'])

    def test_a_small_scan_is_enlarged_but_never_past_the_cap(self):
        info, rgba = run(engraving())
        self.assertGreater(info['enlarged'], 1.5)
        self.assertLessEqual(max(rgba.shape[:2]), 2400)

    def test_a_turned_picture_is_set_level_and_a_level_one_is_left(self):
        level = engraving(drift=False)
        self.assertEqual(tilt_of(ink_of(level.astype(float), True)), 0.0)
        turned = np.asarray(Image.fromarray(level).rotate(2.5, resample=Image.BILINEAR, fillcolor=220))
        t = tilt_of(ink_of(turned.astype(float), True))
        self.assertAlmostEqual(t, 2.5, delta=0.7)

    def test_a_plain_picture_has_no_object(self):
        with self.assertRaises(ValueError):
            run(np.full((60, 60), 200, np.uint8))

    def test_light_ink_on_a_dark_ground_is_cut_in_its_own_light_color(self):
        info, rgba = run(255 - engraving(drift=False))
        self.assertTrue(info['light'])
        self.assertGreater(rgba[rgba[..., 3] == 255][:, :3].min(), 150)

    def test_strong_clean_up_drops_specks(self):
        a = engraving(drift=False)
        a[10, 10] = 20
        _, plain = run(a, cleanup=0)
        _, strong = run(a, cleanup=2)
        self.assertLess((strong[..., 3] > 128).sum(), (plain[..., 3] > 128).sum())


if __name__ == '__main__':
    unittest.main()
