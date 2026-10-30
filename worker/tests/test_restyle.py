"""Restyle's picture work: a zip unpacked safely, a drawn background made clear (a frame's opening
too, the art's own white kept), and pictures packed for download."""
import os
import tempfile
import unittest
import zipfile

import numpy as np
from PIL import Image, ImageDraw

from telios_worker.restyle import chroma, ground, key, pack, pick_key, unzip, whiten


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


class Chroma(unittest.TestCase):
    """A character drawn on a key-color backdrop the way FLUX draws one: a gradient wall, a lighter floor,
    green light on the subject, a green reflection in an eye, a strand of hair that is half backdrop."""

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.src = os.path.join(self.dir, 'drawn.png')
        self.out = os.path.join(self.dir, 'clear.png')

    def scene(self, wall=(60, 200, 70), dark=(30, 140, 40), floor=(70, 185, 80), cast=(27, 39, 28), reflection=(30, 150, 60)):
        h = w = 240
        rgb = np.zeros((h, w, 3), np.float64)
        t = np.linspace(0, 1, w)[None, :, None]
        rgb[:] = np.array(wall) * (1 - t) + np.array(dark) * t   # the wall's gradient, left to right
        rgb[190:] = floor                                        # the floor
        yy, xx = np.mgrid[:h, :w]
        disc = (yy - 100) ** 2 + (xx - 120) ** 2 < 55 ** 2
        rgb[disc] = (240, 140, 60)                               # orange hair
        rgb[(yy > 140) & (yy < 215) & (xx > 95) & (xx < 145)] = cast           # dark clothes in the backdrop's light
        rgb[(yy - 95) ** 2 + (xx - 120) ** 2 < 100] = (40, 160, 170)            # a teal iris
        rgb[(yy - 90) ** 2 + (xx - 114) ** 2 < 16] = reflection                 # the backdrop reflected in it
        for x in range(20, 70):                                  # a strand: half hair, half backdrop
            for y in (60 + x // 4, 61 + x // 4):
                rgb[y, x] = 0.5 * np.array((240, 140, 60)) + 0.5 * rgb[y, x]
        Image.fromarray(rgb.round().astype(np.uint8)).save(self.src)
        return rgb

    def alpha(self):
        return np.asarray(Image.open(self.out).convert('RGBA'))[..., 3]

    def test_the_backdrop_goes_whatever_its_gradient_and_the_character_stays(self):
        self.scene()
        got = chroma(self.src, self.out, 'green')
        a = self.alpha()
        self.assertTrue((a[:40, :40] == 0).all() and (a[:40, -40:] == 0).all())   # a pale and a dark corner
        self.assertTrue((a[200:, :] == 0)[:, :90].all())                           # the floor
        self.assertTrue((a[100, 100:140] == 255).all())                            # hair, face
        self.assertTrue((a[160:200, 105:135] >= 245).all())                        # dark clothes under green light
        self.assertGreater(got['clear'], 0.4)

    def test_a_green_reflection_in_an_eye_is_not_taken_for_the_backdrop(self):
        self.scene()
        chroma(self.src, self.out, 'green')
        self.assertEqual(self.alpha()[90, 114], 255)

    def test_a_scrap_against_the_edge_goes_but_a_piece_floating_beside_the_figure_stays(self):
        rgb = self.scene()
        rgb[234:240, 234:240] = (120, 120, 110)    # a gray scrap in the corner, touching the edge
        rgb[200:206, 20:26] = (240, 140, 60)       # a small piece apart from the figure, clear of the edges
        Image.fromarray(rgb.round().astype(np.uint8)).save(self.src)
        chroma(self.src, self.out, 'green')
        a = self.alpha()
        self.assertTrue((a[234:240, 234:240] == 0).all())
        self.assertTrue((a[200:206, 20:26] == 255).all())

    def test_a_strand_that_is_half_backdrop_comes_out_orange_not_olive(self):
        self.scene()
        chroma(self.src, self.out, 'green')
        rgba = np.asarray(Image.open(self.out).convert('RGBA')).astype(int)
        strand = rgba[60 + 40 // 4, 40]
        self.assertGreater(strand[3], 60)                    # kept, though part backdrop
        self.assertGreater(strand[0], strand[1] + 40)        # red well over green: orange, not olive

    def test_blue_works_the_same_way(self):
        self.scene(wall=(60, 70, 200), dark=(30, 40, 140), floor=(70, 80, 185), cast=(27, 28, 39), reflection=(30, 60, 150))
        got = chroma(self.src, self.out, 'blue')
        a = self.alpha()
        self.assertTrue((a[:40, :40] == 0).all() and (a[100, 100:140] == 255).all())
        self.assertGreater(got['clear'], 0.4)

    def test_a_picture_with_no_such_backdrop_is_left_whole_and_says_nothing_was_cleared(self):
        Image.new('RGB', (64, 64), (240, 140, 60)).save(self.src)
        got = chroma(self.src, self.out, 'green')
        self.assertEqual(got['clear'], 0.0)
        self.assertTrue((self.alpha() == 255).all())


class KeyChoice(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.src = os.path.join(self.dir, 'a.png')

    def test_green_unless_the_picture_has_greens_and_then_blue(self):
        Image.new('RGB', (64, 64), (240, 140, 60)).save(self.src)
        self.assertEqual(pick_key(self.src)['color'], 'green')
        Image.new('RGB', (64, 64), (40, 180, 70)).save(self.src)
        self.assertEqual(pick_key(self.src)['color'], 'blue')
        Image.new('RGB', (64, 64), (30, 60, 200)).save(self.src)   # a blue picture is cut from green
        self.assertEqual(pick_key(self.src)['color'], 'green')
        Image.new('RGB', (64, 64), (128, 128, 128)).save(self.src)
        self.assertEqual(pick_key(self.src)['color'], 'green')

    def test_the_white_ground_is_painted_in_the_key_color_and_the_art_is_not(self):
        im = Image.new('RGB', (80, 80), 'white')
        for x in range(30, 50):
            for y in range(30, 50):
                im.putpixel((x, y), (200, 30, 30))
        im.save(self.src)
        out = os.path.join(self.dir, 'g.png')
        self.assertGreater(ground(self.src, out, '#00ff00')['ground'], 0.8)
        got = Image.open(out)
        self.assertEqual(got.getpixel((2, 2)), (0, 255, 0))
        self.assertEqual(got.getpixel((40, 40)), (200, 30, 30))

    def test_a_black_ground_is_painted_too_and_the_dark_art_inside_it_is_not(self):
        im = Image.new('RGB', (80, 80), (4, 4, 6))
        for x in range(30, 50):
            for y in range(30, 50):
                im.putpixel((x, y), (220, 170, 40))   # a gold mask on black
        for x in range(38, 42):
            for y in range(38, 42):
                im.putpixel((x, y), (2, 2, 2))        # a dark eye inside it, not part of the ground
        im.save(self.src)
        out = os.path.join(self.dir, 'g.png')
        self.assertGreater(ground(self.src, out, '#00ff00')['ground'], 0.8)
        got = Image.open(out)
        self.assertEqual(got.getpixel((2, 2)), (0, 255, 0))
        self.assertEqual(got.getpixel((35, 35)), (220, 170, 40))
        self.assertEqual(got.getpixel((40, 40)), (2, 2, 2))   # enclosed, so not reached from the edges

    def test_a_picture_that_fills_its_frame_has_no_ground_to_paint(self):
        ramp = np.tile(np.linspace(0, 255, 60).astype(np.uint8), (60, 1))   # edges that are not one plain color
        Image.fromarray(np.dstack([ramp, ramp, ramp])).save(self.src)
        out = os.path.join(self.dir, 'g.png')
        self.assertEqual(ground(self.src, out)['ground'], 0.0)
        self.assertEqual(Image.open(out).getpixel((2, 2)), Image.open(self.src).getpixel((2, 2)))   # left as it was
        Image.new('RGB', (40, 40), (90, 40, 30)).save(self.src)         # one color all over: nothing to tell ground from art
        self.assertEqual(ground(self.src, out)['ground'], 0.0)
        # dark clothes that reach the bottom edge are not the black ground
        im = Image.new('RGB', (80, 80), (0, 0, 0))
        for x in range(25, 55):
            for y in range(20, 80):
                im.putpixel((x, y), (36, 34, 40))
        im.save(self.src)
        self.assertGreater(ground(self.src, out)['ground'], 0.4)
        got = Image.open(out)
        self.assertEqual(got.getpixel((3, 3)), (0, 255, 0))
        self.assertEqual(got.getpixel((40, 70)), (36, 34, 40))


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
