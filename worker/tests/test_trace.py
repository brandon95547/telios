import unittest

import numpy as np

from telios_worker.trace import merged


class MergedColors(unittest.TestCase):
    def test_two_near_browns_are_one_at_their_weighted_mean(self):
        pal = merged(np.array([[128, 68, 40], [136, 86, 50], [43, 58, 103]], float), np.array([100, 300, 50], float), 20)
        self.assertEqual(len(pal), 2)
        brown = min(pal, key=lambda c: abs(c[0] - 134))
        self.assertAlmostEqual(brown[0], (128 * 100 + 136 * 300) / 400, places=3)

    def test_colors_that_are_apart_stay_and_a_color_nobody_uses_goes(self):
        pal = merged(np.array([[10, 10, 10], [250, 250, 250], [120, 60, 30]], float), np.array([5, 5, 0], float), 20)
        self.assertEqual(len(pal), 2)

    def test_zero_leaves_to_the_caller_and_one_color_is_kept(self):
        self.assertEqual(len(merged(np.array([[1, 2, 3]], float), np.array([9], float), 20)), 1)


if __name__ == '__main__':
    unittest.main()


class CleanUp(unittest.TestCase):
    def test_a_wobbling_edge_is_evened_out_by_the_clean_up_levels(self):
        import os
        import tempfile
        from PIL import Image
        from telios_worker.trace import smoothed, trace
        rng = np.random.default_rng(1)
        yy, xx = np.mgrid[0:400, 0:400].astype(np.float32)
        r = 120 + rng.normal(0, 1, 400)[(np.arctan2(yy - 200, xx - 200) * 200 / np.pi).astype(int) % 400] * 4
        img = np.full((400, 400, 3), 255, np.uint8)
        img[np.hypot(xx - 200, yy - 200) < r] = (40, 40, 60)

        def paths(level):
            with tempfile.TemporaryDirectory() as d:
                src = os.path.join(d, 's.png')
                Image.fromarray(img).save(src)
                trace(src, d, None, 'full', False, 3, 'T', 20, level)
                svg = open(os.path.join(d, 'layered.svg')).read()
            return len(svg)
        off, light, strong = paths(0), paths(1), paths(2)
        self.assertLess(light, off)
        self.assertLess(strong, light)

    def test_smoothing_keeps_what_is_not_art_outside_the_shape(self):
        from telios_worker.trace import smoothed
        band = np.zeros((20, 20), int)
        band[5:15, 5:15] = 1
        shape = band > 0
        out = smoothed(band, shape, 2, 1.5)
        self.assertTrue((out[~shape] == 0).all())
        self.assertTrue((out[8:12, 8:12] == 1).all())


class SingleInk(unittest.TestCase):
    def test_black_lines_on_white_are_one_ink_and_colored_art_is_not(self):
        from telios_worker.trace import single_ink
        a = np.full((200, 200, 3), 255, np.uint8)
        a[40:160, 60:70] = 5
        a[40:50, 60:140] = 5
        self.assertTrue(single_ink(np.dstack([a, np.full((200, 200), 255, np.uint8)])))
        b = a.copy()
        b[100:150, 100:150] = (200, 40, 40)
        b[60:90, 110:140] = (40, 80, 200)
        self.assertFalse(single_ink(np.dstack([b, np.full((200, 200), 255, np.uint8)])))
