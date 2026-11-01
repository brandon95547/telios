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
