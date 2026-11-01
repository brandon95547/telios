import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { bestSlide, classify, overlayCheck, roll } from '../src/engine/overlay.ts';

const palette = [{ hex: '#d03030', name: 'red' }, { hex: '#30a040', name: 'green' }, { hex: '#3050c0', name: 'blue' }];

/** Horizontal bands of flat color, top to bottom. */
const bands = (colors: string[], width = 200, height = 300) => {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    const c = colors[Math.min(colors.length - 1, Math.floor((y / height) * colors.length))];
    for (let x = 0; x < width; x++) for (let k = 0; k < 3; k++) raw[(y * width + x) * 3 + k] = parseInt(c.slice(1 + 2 * k, 3 + 2 * k), 16);
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
};

test('each cell is given the original’s nearest palette color', () => {
  const raw = Buffer.from([200, 40, 40, 40, 160, 60, 50, 80, 190]);
  assert.deepEqual([...classify(raw, [[208, 48, 48], [48, 160, 64], [48, 80, 192]])], [0, 1, 2]);
});

test('a drawing in the same places as the original agrees, and says no region is far off', async () => {
  const o = await overlayCheck(await bands(['#d03030', '#30a040', '#3050c0']), await bands(['#d03030', '#30a040', '#3050c0'], 400, 600), palette);
  assert.ok(o);
  assert.ok(o.agreement > 0.97, `agreement ${o.agreement}`);
  assert.match(o.report, /No region is far off/);
  assert.match(o.report, /red 33% → 33%/);
});

test('a drawing with the colors in the wrong places is told where, and what is there instead', async () => {
  const o = await overlayCheck(await bands(['#d03030', '#30a040', '#3050c0']), await bands(['#3050c0', '#30a040', '#d03030']), palette);
  assert.ok(o);
  assert.ok(o.agreement < 0.4, `agreement ${o.agreement}`);
  assert.match(o.report, /Least alike: top \(all across; 0% match; mostly red in the original, mostly blue in yours\)/);
  assert.match(o.report, /bottom \(all across; 0% match; mostly blue in the original, mostly red in yours\)/);
});

test('the picture lays the original’s edges, in red, over the drawing, at the height asked', async () => {
  const o = await overlayCheck(await bands(['#ffffff', '#202020']), await bands(['#ffffff', '#ffffff']), palette, { height: 300 });
  assert.ok(o);
  const m = await sharp(o.panel).metadata();
  assert.deepEqual([m.width, m.height], [200, 300]);
  const { data } = await sharp(o.panel).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (y: number) => [data[(y * 200 + 100) * 3], data[(y * 200 + 100) * 3 + 1], data[(y * 200 + 100) * 3 + 2]];
  assert.ok(at(150)[0] > 150 && at(150)[1] < 120, `the edge is red: ${at(150)}`);
  assert.deepEqual(at(40), [255, 255, 255], 'away from an edge the drawing shows as it is');
});

test('nothing is compared where the drawing is not the original’s shape, and the numbers wait for a palette', async () => {
  assert.equal(await overlayCheck(await bands(['#d03030', '#3050c0']), await bands(['#d03030', '#3050c0'], 300, 300), palette), null);
  const o = await overlayCheck(await bands(['#d03030', '#3050c0']), await bands(['#d03030', '#3050c0']), [{ hex: '#d03030' }]);
  assert.ok(o);
  assert.equal(o.report, '');
  assert.ok(o.panel.length > 0);
});

/** A tile of dots in a 2 × 2 grid, started at an offset: the same pattern as one started at 0, slid round the edges. */
async function dots(offsetX: number, offsetY: number, size = 200) {
  const raw = Buffer.alloc(size * size * 3, 255);
  const half = size / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = ((x + offsetX) % half + half) % half, py = ((y + offsetY) % half + half) % half;
    const inDot = (px - half / 2) ** 2 + (py - half / 2) ** 2 < (half * 0.22) ** 2;
    if (inDot) { raw[(y * size + x) * 3] = 208; raw[(y * size + x) * 3 + 1] = 48; raw[(y * size + x) * 3 + 2] = 48; }
  }
  return sharp(raw, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
}

test('rolling and sliding: the best slide puts one grid onto the other, round the edges', () => {
  const w = 8, h = 6;
  const a = new Uint8Array(w * h); a[2 * w + 3] = 1; a[4 * w + 6] = 2;
  const b = roll(a, w, h, 2, 1);
  assert.equal(b[3 * w + 5], 1);
  assert.equal(b[5 * w + 0], 2, 'round the edge');
  const s = bestSlide(a, b, w, h);
  assert.deepEqual(s, { dx: 2, dy: 1 });
});

test('a tile that starts elsewhere in the repeat is the same pattern once slid, and is told how far', async () => {
  const ref = await dots(0, 0), drawn = await dots(25, 10, 400);
  const plain = await overlayCheck(ref, drawn, [{ hex: '#d03030', name: 'red' }, { hex: '#ffffff', name: 'white' }]);
  const wrapped = await overlayCheck(ref, drawn, [{ hex: '#d03030', name: 'red' }, { hex: '#ffffff', name: 'white' }], { wrap: true });
  assert.ok(plain && wrapped);
  assert.ok(plain.agreement < 0.9, `without sliding it looks wrong: ${plain.agreement}`);
  assert.ok(wrapped.agreement > 0.95, `slid, it agrees: ${wrapped.agreement}`);
  assert.match(wrapped.report, /slid \d+% across and \d+% down/);
  assert.doesNotMatch(plain.report, /slid/);
});
