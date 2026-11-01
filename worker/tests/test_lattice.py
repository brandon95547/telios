import unittest

import numpy as np

from telios_worker.analyze import lattice_of


def blobs(h, w, points, r=10):
    yy, xx = np.mgrid[0:h, 0:w]
    img = np.zeros((h, w))
    for (y, x) in points:
        img += np.exp(-(((yy - y) ** 2 + (xx - x) ** 2) / (2 * (r / 2) ** 2)))
    return img


class Lattice(unittest.TestCase):
    def test_a_staggered_pattern_is_half_drop_with_two_motifs_in_a_rectangular_cell(self):
        # motif centers every 100 across and 150 down, each row half a cell along: a centered lattice, cell 200 × 300
        pts = [(y, x) for y in range(30, 900, 150) for x in range(30, 600, 100) if ((y - 30) // 150 + (x - 30) // 100) % 2 == 0]
        lat = lattice_of(blobs(900, 600, pts))
        self.assertIsNotNone(lat)
        self.assertEqual(lat['kind'], 'half-drop')
        self.assertEqual(lat['perCell'], 2)
        self.assertLess(abs(lat['cell'][0] - 200), 4)
        self.assertLess(abs(lat['cell'][1] - 300), 4)

    def test_a_square_grid_is_a_grid_of_one_motif_a_cell(self):
        pts = [(y, x) for y in range(30, 900, 150) for x in range(30, 600, 100)]
        lat = lattice_of(blobs(900, 600, pts))
        self.assertIsNotNone(lat)
        self.assertEqual(lat['kind'], 'grid')
        self.assertEqual(lat['perCell'], 1)
        self.assertLess(abs(lat['cell'][0] - 100), 4)
        self.assertLess(abs(lat['cell'][1] - 150), 4)


if __name__ == '__main__':
    unittest.main()
