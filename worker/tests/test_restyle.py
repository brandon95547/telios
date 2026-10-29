"""Restyle's picture work: a zip unpacked safely, a drawn background made clear (a frame's opening
too, the art's own white kept), and pictures packed for download."""
import os
import tempfile
import unittest
import zipfile

import numpy as np
from PIL import Image, ImageDraw

from telios_worker.restyle import key, pack, unzip, whiten


def png(color=(200, 30, 30), size=(8, 8)):
    from io import BytesIO
    b = BytesIO()
    Image.new('RGB', size, color).save(b, 'PNG')
    return b.getvalue()


class Unzip(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.zip = os.path.join(self.dir, 'art.zip')

    def test_only_pictures_come_out_each_under_a_fresh_name_with_its_folder(self):
        with zipfile.ZipFile(self.zip, 'w') as z:
            z.writestr('Frames/Gold/frame_01.png', png())
            z.writestr('../../escape.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>')
            z.writestr('__MACOSX/Frames/._frame_01.png', b'junk')
            z.writestr('Frames/.DS_Store', b'junk')
            z.writestr('readme.txt', b'hello')
            z.writestr('ornament.EPS', b'%!PS')
        out = os.path.join(self.dir, 'out')
        os.makedirs(out)
        got = unzip(self.zip, out)
        self.assertEqual([(f['name'], f['folder']) for f in got['files']], [('frame_01.png', 'Frames/Gold'), ('escape.svg', ''), ('ornament.EPS', '')])
        self.assertEqual(got['skipped'], 3)
        self.assertTrue(all(os.path.dirname(f['file']) == out for f in got['files']))
        self.assertEqual(sorted(os.listdir(self.dir)), ['art.zip', 'out'])

    def test_it_stops_at_the_limits(self):
        with zipfile.ZipFile(self.zip, 'w') as z:
            for i in range(5):
                z.writestr(f'p{i}.png', png())
        out = os.path.join(self.dir, 'out')
        os.makedirs(out)
        got = unzip(self.zip, out, max_files=3)
        self.assertEqual((len(got['files']), got['skipped']), (3, 2))


class Key(unittest.TestCase):
    def framed(self):
        """A dark frame with a white opening, a small white dot in its band, on white."""
        im = Image.new('RGB', (200, 200), 'white')
        d = ImageDraw.Draw(im)
        d.rectangle((20, 20, 179, 179), fill=(60, 40, 20))
        d.rectangle((50, 50, 149, 149), fill='white')     # the opening: enclosed, a quarter of it
        d.ellipse((28, 28, 38, 38), fill='white')          # the art's own white: enclosed, tiny
        return im

    def alpha(self, im, **kw):
        d = tempfile.mkdtemp()
        src, out = os.path.join(d, 'in.png'), os.path.join(d, 'out.png')
        im.save(src)
        key(src, out, **kw)
        return np.asarray(Image.open(out))[..., 3]

    def test_the_ground_and_a_frames_opening_go_and_the_arts_white_stays(self):
        a = self.alpha(self.framed())
        self.assertEqual(a[5, 5], 0)        # the ground
        self.assertEqual(a[100, 100], 0)    # the opening
        self.assertEqual(a[33, 33], 255)    # the dot
        self.assertEqual(a[30, 100], 255)   # the frame

    def test_line_art_keeps_only_its_ink_in_black(self):
        a = self.alpha(self.framed(), everything=True)
        self.assertEqual((a[33, 33], a[5, 5], a[30, 100]), (0, 0, 255))

    def test_a_black_ground(self):
        im = Image.new('RGB', (50, 50), 'black')
        ImageDraw.Draw(im).rectangle((10, 10, 39, 39), fill=(240, 200, 40))
        a = self.alpha(im, ground='black')
        self.assertEqual((a[2, 2], a[25, 25]), (0, 255))


class Whiten(unittest.TestCase):
    def run_on(self, im):
        d = tempfile.mkdtemp()
        src, out = os.path.join(d, 'in.png'), os.path.join(d, 'out.png')
        im.save(src)
        return whiten(src, out), np.asarray(Image.open(out))

    def test_gray_paper_turns_white_and_the_ink_stays_dark(self):
        im = Image.new('RGB', (100, 100), (150, 146, 140))
        ImageDraw.Draw(im).rectangle((40, 40, 60, 60), fill=(30, 30, 30))
        got, px = self.run_on(im)
        self.assertEqual(got['paper'], '#96928c')
        self.assertEqual(tuple(px[5, 5]), (255, 255, 255))
        self.assertLess(px[50, 50].max(), 60)

    def test_a_picture_with_no_paper_is_left_alone(self):
        im = Image.fromarray(np.random.default_rng(1).integers(0, 255, (60, 60, 3), dtype=np.uint8))
        got, px = self.run_on(im)
        self.assertIsNone(got['paper'])
        self.assertTrue((px == np.asarray(im)).all())


class Pack(unittest.TestCase):
    def test_files_go_in_under_their_names(self):
        d = tempfile.mkdtemp()
        a = os.path.join(d, 'a.png')
        with open(a, 'wb') as f:
            f.write(png())
        out = os.path.join(d, 'out.zip')
        pack([{'src': a, 'name': 'Clip art/frame.png'}, {'src': a, 'name': 'frame.svg'}], out)
        with zipfile.ZipFile(out) as z:
            self.assertEqual(z.namelist(), ['Clip art/frame.png', 'frame.svg'])
            self.assertEqual(z.getinfo('Clip art/frame.png').compress_type, zipfile.ZIP_STORED)


if __name__ == '__main__':
    unittest.main()
