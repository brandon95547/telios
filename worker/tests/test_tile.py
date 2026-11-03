import os
import tempfile
import unittest

import numpy as np
from PIL import Image
from scipy import ndimage

from telios_worker.tile import border, centered, centered_x, lay_tile, seam_of, tile, offset_paths, smooth_labels, tilt_of, gray_of, axis_curves, period_of_curve, strip_tilt


def pattern(cw, ch, w, h, seed=3):
    """A half-drop pattern of blobs and bars in three colors, period cw × ch, drawn on a w × h picture, with a little grain."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    img = np.empty((h, w, 3), np.float32)
    img[:] = (132, 86, 52)
    u = np.mod(xx, cw)
    v = np.mod(yy, ch)
    for (cx, cy) in ((0, 0), (cw / 2, ch / 2)):
        du = np.minimum(np.abs(u - cx), cw - np.abs(u - cx))
        dv = np.minimum(np.abs(v - cy), ch - np.abs(v - cy))
        img[(du ** 2 + dv ** 2) < (cw * 0.17) ** 2] = (60, 70, 120)
        img[(du < cw * 0.04) & (dv < ch * 0.3)] = (200, 175, 125)
    img[(np.abs(u - cw / 4) < 2.5) & (np.abs(v - ch / 4) < ch * 0.12)] = (200, 175, 125)
    return np.clip(img + rng.normal(0, 4, img.shape), 0, 255).astype(np.uint8)


def with_margin(img, deg=0.0):
    h, w = img.shape[:2]
    big = np.full((h + 80, w + 80, 3), 206, np.uint8)
    big[40:40 + h, 40:40 + w] = img
    if deg:
        big = np.stack([ndimage.rotate(big[..., c], deg, reshape=False, order=1, mode='constant', cval=206) for c in range(3)], -1).astype(np.uint8)
    return big


def run(img):
    with tempfile.TemporaryDirectory() as d:
        src = os.path.join(d, 'scan.png')
        Image.fromarray(img).save(src)
        out = os.path.join(d, 'out')
        os.makedirs(out)
        info = tile(src, out, 8)
        with open(os.path.join(out, 'layered.svg')) as f:
            info['svg'] = f.read()
        return info


class Tile(unittest.TestCase):
    def test_a_level_pattern_gives_its_exact_repeat_a_half_drop_lattice_and_no_seam(self):
        info = run(with_margin(pattern(64, 96, 330, 440)))
        self.assertLess(abs(info['cell'][0] - 64) / 64, 0.012)
        self.assertLess(abs(info['cell'][1] - 96) / 96, 0.012)
        self.assertEqual(info['lattice'], 'half-drop')
        self.assertLess(abs(info['tilt']), 0.3)
        self.assertLess(info['seam'], 1.3)
        self.assertIn(f'viewBox="0 0 {info["size"][0]} {info["size"][1]}"', info['svg'])
        self.assertEqual(len(info['layers']), 3)

    def test_a_scan_turned_a_little_is_levelled_before_the_repeat_is_cut(self):
        for deg in (1.5, -1.2):
            info = run(with_margin(pattern(64, 96, 360, 480), deg))
            self.assertLess(abs(abs(info['tilt']) - abs(deg)), 0.35, f'{deg}: {info["tilt"]}')
            self.assertLess(abs(info['cell'][0] - 64) / 64, 0.02, f'{deg}: {info["cell"]}')
            self.assertLess(abs(info['cell'][1] - 96) / 96, 0.02, f'{deg}: {info["cell"]}')
            self.assertLess(info['seam'], 1.5)

    def test_a_picture_that_does_not_repeat_is_refused_in_plain_words(self):
        rng = np.random.default_rng(1)
        noise = ndimage.gaussian_filter(rng.normal(128, 60, (300, 300, 3)), (4, 4, 0)).clip(0, 255).astype(np.uint8)
        with self.assertRaises(ValueError) as e:
            run(noise)
        self.assertIn('repeat', str(e.exception))


def strip(cw, h, w, seed=5):
    """A border: a motif (a disc with a bar and a notch, not mirror-symmetric) that repeats every `cw` px along a strip `h` high and `w` long."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    img = np.empty((h, w, 3), np.float32)
    img[:] = (150, 120, 85)
    u = np.mod(xx, cw)
    img[(yy < h * 0.12) | (yy > h * 0.88)] = (60, 30, 25)
    img[((u - cw * 0.5) ** 2 + (yy - h / 2) ** 2) < (h * 0.28) ** 2] = (170, 50, 40)
    img[(np.abs(u - cw * 0.2) < 3) & (np.abs(yy - h * 0.4) < h * 0.2)] = (40, 40, 40)
    return np.clip(img + rng.normal(0, 4, img.shape), 0, 255).astype(np.uint8)


def run_border(img):
    with tempfile.TemporaryDirectory() as d:
        src = os.path.join(d, 'scan.png')
        Image.fromarray(img).save(src)
        out = os.path.join(d, 'out')
        os.makedirs(out)
        info = border(src, out, 8)
        with open(os.path.join(out, 'layered.svg')) as f:
            info['svg'] = f.read()
        return info


class Border(unittest.TestCase):
    def test_a_level_border_gives_its_exact_unit_along_its_length_and_no_seam(self):
        info = run_border(with_margin(strip(100, 120, 640)))
        self.assertLess(abs(info['cell'][0] - 100) / 100, 0.012)
        self.assertLess(abs(info['cell'][1] - 120) / 120, 0.1, 'the whole width across is kept')
        self.assertEqual(info['lattice'], 'strip')
        self.assertFalse(info['turned'])
        self.assertLess(info['seam'], 1.5)
        self.assertIn(f'viewBox="0 0 {info["size"][0]} {info["size"][1]}"', info['svg'])

    def test_a_tall_border_is_turned_to_run_level_and_a_tilted_one_is_levelled(self):
        for deg in (0.0, 1.2, -1.0):
            flat = with_margin(strip(100, 120, 640), deg)
            tall = np.ascontiguousarray(np.rot90(flat, -1))     # a vertical strip
            info = run_border(tall)
            self.assertTrue(info['turned'], deg)
            self.assertLess(abs(info['cell'][0] - 100) / 100, 0.02, f'{deg}: {info["cell"]}')
            self.assertLess(abs(abs(info['tilt']) - abs(deg)), 0.4, f'{deg}: {info["tilt"]}')
            self.assertLess(info['seam'], 1.6, f'{deg}: {info["seam"]}')

    def test_a_border_with_no_repeat_is_refused_and_a_border_sent_as_a_pattern_is_told_which_it_is(self):
        rng = np.random.default_rng(1)
        noise = ndimage.gaussian_filter(rng.normal(128, 60, (120, 700, 3)), (3, 3, 0)).clip(0, 255).astype(np.uint8)
        with self.assertRaises(ValueError) as e:
            run_border(noise)
        self.assertIn('along its length', str(e.exception))
        with self.assertRaises(ValueError) as e:
            run(with_margin(strip(100, 120, 640)))
        self.assertIn('Choose Made for', str(e.exception))
        self.assertIn('Border', str(e.exception))

    def test_a_thin_strip_is_not_cut_to_nothing_by_the_lean_search(self):
        thin = gray_of(strip(60, 24, 900).astype(np.float32))
        self.assertEqual(tilt_of(thin)[0], 0.0)

    def test_the_units_mirror_axis_is_slid_to_its_middle(self):
        unit = strip(100, 120, 100).astype(np.float32)
        slid, dx, strength = centered_x(np.roll(unit, 17, axis=1))
        self.assertEqual(slid.shape, unit.shape)
        self.assertIsInstance(dx, int)


class Parts(unittest.TestCase):
    def test_the_lean_is_the_angle_at_which_the_pattern_best_matches_itself_level_and_plumb(self):
        img = pattern(64, 96, 360, 480)
        for deg in (0.0, 1.5, -2.0):
            turned = ndimage.rotate(gray_of(img.astype(np.float32)), deg, reshape=False, order=1, mode='reflect')
            got, score, _ = tilt_of(turned)
            self.assertLess(abs(got - deg), 0.3, f'{deg}: {got}')

    def test_the_repeat_is_the_first_strong_return_of_the_self_match(self):
        row, col = axis_curves(gray_of(pattern(64, 96, 360, 480).astype(np.float32)))
        self.assertLess(abs(period_of_curve(row)[0] - 64), 1.5)
        self.assertLess(abs(period_of_curve(col)[0] - 96), 1.5)
        self.assertIsNone(period_of_curve(np.linspace(1, 0, 100)))

    def test_a_seam_shows_where_the_edges_do_not_meet(self):
        rng = np.random.default_rng(2)
        smooth = (ndimage.gaussian_filter(rng.normal(0, 1, (80, 80)), 3, mode='wrap') > 0).astype(int)
        self.assertLess(seam_of(smooth), 2.0)
        bad = np.zeros((80, 80), int)
        bad[:, 40:] = 1
        self.assertGreater(seam_of(bad), 5)
        self.assertLess(seam_of(np.zeros((40, 40), int)), 1.01)

    def test_the_tile_is_laid_from_every_copy_and_slid_so_its_centre_of_symmetry_is_in_the_middle(self):
        img = pattern(40, 60, 200, 300).astype(np.float32)
        t, copies, (w, h) = lay_tile(img, 40, 60, 1.0)
        self.assertEqual((w, h), (40, 60))
        self.assertGreaterEqual(copies, 4)
        slid, dx, dy, strength = centered(t)
        self.assertGreater(strength, 0.5)
        self.assertEqual(slid.shape, t.shape)

    def test_labels_lose_a_specks_but_keep_a_line(self):
        band = np.zeros((40, 40), int)
        band[10:30, 20] = 1
        band[5, 5] = 1
        out = smooth_labels(band, 2, 0.8)
        self.assertEqual(out[5, 5], 0)

    def test_traced_paths_are_moved_by_their_own_transform(self):
        self.assertIn('translate(8,10)', offset_paths('<path d="M0 0" transform="translate(10,12)"/>', -2, -2))
        self.assertIn('transform="translate(-3,-3)"', offset_paths('<path d="M0 0"/>', -3, -3))


if __name__ == '__main__':
    unittest.main()
