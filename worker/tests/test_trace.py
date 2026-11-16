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


class ClearedPicture(unittest.TestCase):
    def test_the_picture_kept_beside_a_trace_is_clear_where_the_trace_is(self):
        # an ink outline round a white body, the body's top a faint cream (a drawn remix): all of the paper goes, inside and out,
        # not the tinted part kept and the plain part cleared
        import os
        import tempfile
        from PIL import Image
        from telios_worker.trace import trace
        yy, xx = np.mgrid[0:400, 0:400]
        body = np.hypot((xx - 200) / 1.4, yy - 200) < 110
        ring = (np.hypot((xx - 200) / 1.4, yy - 200) < 122) & ~body
        img = np.full((400, 400, 3), 255, np.uint8)
        img[body & (yy < 200)] = (247, 247, 239)
        img[ring] = 5
        with tempfile.TemporaryDirectory() as d:
            src = os.path.join(d, 's.png')
            Image.fromarray(img).save(src)
            trace(src, d, None, 'auto', False, 3, 'T', 20, 2, True, cleared=os.path.join(d, 'clear.png'))
            alpha = np.asarray(Image.open(os.path.join(d, 'clear.png')))[..., 3]
        self.assertEqual(alpha.shape, (400, 400))
        self.assertLess(alpha[150, 200], 10)    # the cream top
        self.assertLess(alpha[250, 200], 10)    # the white bottom
        self.assertLess(alpha[10, 10], 10)      # the paper round it
        self.assertGreater(alpha[200, 200 + 162], 245)   # the outline


class ClearedInside(unittest.TestCase):
    def test_a_large_gap_of_paper_inside_the_design_is_cleared_and_a_small_one_stays(self):
        from telios_worker.trace import cleared_inside
        shape = np.zeros((200, 200), bool)
        shape[20:180, 20:180] = True
        ink = shape.copy()
        ink[60:120, 60:120] = False        # a big gap between the vines
        ink[141, 141] = False      # a speck of highlight
        out = cleared_inside(shape, ink)
        self.assertFalse(out[90, 90])
        self.assertTrue(out[141, 141])
        self.assertTrue(out[30, 30])


class FlatWindow(unittest.TestCase):
    """A frame's window drawn as a flat panel is left open; a figure's own flat body is not a window (a remix's black silhouette
    on clear was traced into an empty SVG)."""

    def rgba(self, rgb, alpha):
        return np.dstack([rgb, alpha]).astype(np.uint8)

    def test_a_tinted_panel_ringed_by_its_frame_is_a_window(self):
        from telios_worker.analyze import find_paper, flat_window
        rgb = np.full((300, 300, 3), 255, np.uint8)
        rgb[30:270, 30:270] = (120, 70, 30)      # the frame
        rgb[70:230, 70:230] = (230, 220, 190)    # its tinted window
        _, ink = find_paper(self.rgba(rgb, np.full((300, 300), 255)))
        window = flat_window(rgb, ink=ink)
        self.assertIsNotNone(window)
        self.assertTrue(window[150, 150])

    def test_a_solid_figure_on_clear_is_not_a_window(self):
        from telios_worker.analyze import find_paper, flat_window
        from telios_worker.trace import segment
        yy, xx = np.mgrid[0:300, 0:300]
        body = np.hypot((xx - 150) / 1.6, yy - 150) < 70
        rgb = np.full((300, 300, 3), 250, np.uint8)
        rgb[body] = 10
        rgba = self.rgba(rgb, np.where(body, 255, 0))
        _, ink = find_paper(rgba)
        self.assertIsNone(flat_window(rgb, ink=ink))
        shape, _, _ = segment(rgba, 'full', clear_inside=True)
        self.assertGreater(shape[body].mean(), 0.95)

    def test_a_pale_figure_inside_its_outline_is_not_a_window(self):
        from telios_worker.analyze import flat_window
        yy, xx = np.mgrid[0:300, 0:300]
        # a body with legs: far from filling its box, as an opening does
        body = (np.hypot((xx - 150) / 2, yy - 120) < 45) | ((yy > 120) & (yy < 250) & ((abs(xx - 80) < 8) | (abs(xx - 220) < 8)))
        rgb = np.full((300, 300, 3), 255, np.uint8)
        outline = np.zeros_like(body)
        for dy in range(-6, 7):
            for dx in range(-6, 7):
                outline |= np.roll(np.roll(body, dy, 0), dx, 1)
        rgb[outline] = 0
        rgb[body] = 240
        self.assertIsNone(flat_window(rgb, ink=outline))
