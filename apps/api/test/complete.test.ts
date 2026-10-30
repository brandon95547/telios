import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.TELIOS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'telios-complete-test-'));
process.env.TELIOS_PROVIDER = 'none';   // no model: the plain description is used

const { COMPLETE_SHARE, DEFAULT_OPTIONS, cleanOptions, settingRows } = await import('@telios/shared');
const sharp = (await import('sharp')).default;
const { extendCanvas, growthOf, layBack, lowerHalfPrompt, readLowerHalf } = await import('../src/restyle/complete.ts');

const W = 40, H0 = 100;
/** A red subject filling a white picture, as the cut-out subject is (flat white round it). */
const subject = () => sharp({ create: { width: W, height: H0, channels: 3, background: '#cc2222' } }).png().toBuffer();
const column = async (png: Buffer, x: number) => {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return Array.from({ length: info.height }, (_, y) => [data[(y * info.width + x) * 3], data[(y * info.width + x) * 3 + 1], data[(y * info.width + x) * 3 + 2]]);
};
const mask = async (png: Buffer) => [...(await sharp(png).greyscale().raw().toBuffer())];

test('the picture grows by 57% of its height, as it did in the tests', () => {
  assert.equal(COMPLETE_SHARE, 0.57);
  assert.equal(growthOf(700), 399);     // the bust: 400 pixels in the tests, 399 here
  assert.equal(growthOf(100), 57);
});

test('the picture sits at the top of a taller white canvas, with a mask of the new area that fades into it', async () => {
  const size: [number, number] = [48, 160];   // the drawn size: same shape as 40 × 157, in 16-pixel steps
  const { picture, mask: m } = await extendCanvas(await subject(), size);
  assert.deepEqual([(await sharp(picture).metadata()).width, (await sharp(picture).metadata()).height], size);
  assert.deepEqual([(await sharp(m).metadata()).width, (await sharp(m).metadata()).height], size);
  const col = await column(picture, 24);
  assert.deepEqual(col[2], [204, 34, 34]);             // the subject is at the top
  assert.deepEqual(col[size[1] - 2], [255, 255, 255]); // and white is below it
  const levels = (await mask(m)).filter((_, i) => i % size[0] === 24);
  assert.equal(levels[0], 0);                           // what was there is not redrawn
  assert.equal(levels.at(-1), 255);                     // what is new is
  assert.ok(levels.some((v) => v > 0 && v < 255), 'a soft join');
  for (let i = 1; i < levels.length; i++) assert.ok(levels[i] >= levels[i - 1], 'it only grows downward');
});

test('the original is laid back over what was there, and what is drawn is kept below', async () => {
  const size: [number, number] = [48, 160];
  const { picture, mask: m } = await extendCanvas(await subject(), size);
  const blue = await sharp({ create: { width: 48, height: 160, channels: 3, background: '#2222cc' } }).png().toBuffer();   // what the model drew, over everything
  const out = await layBack(blue, picture, m, size);
  const col = await column(out, 24);
  assert.deepEqual(col[5], [204, 34, 34]);               // the top is the original's pixel, not the model's
  assert.deepEqual(col[155], [34, 34, 204]);             // the new part is the model's
  const seam = col.find((p) => p[0] > 40 && p[0] < 200);
  assert.ok(seam, 'a blend at the join');
});

test('what the missing part is asked for: the description, the words, that it matches, on white', () => {
  const p = lowerHalfPrompt('The lower half of the same bronze statue: the body continues straight down to a base', 'ending in carved feet');
  assert.equal(p, 'The lower half of the same bronze statue: the body continues straight down to a base. ending in carved feet. Matching the upper body exactly, in the same light and materials. Isolated on a plain pure white background, with no floor, no wall and no cast shadow.');
  // with nothing from the model, a plain description of the same kind
  const plain = lowerHalfPrompt(null, '');
  assert.match(plain, /^The lower half of the same figure: its body continues straight down below the picture at the same width, in the same materials, colors and ornament, down to a flat base\. Matching the upper body exactly/);
  assert.match(plain, /pure white background, with no floor, no wall and no cast shadow\.$/);
  assert.equal(lowerHalfPrompt('   ', ''), plain);
});

test('without a model the missing part is described plainly: no call is made', async () => {
  assert.equal(await readLowerHalf(await subject()), null);
});

test('Complete the figure is for 2D and 3D illustrations only, and only when asked for', () => {
  assert.equal(DEFAULT_OPTIONS.complete, false);
  assert.equal(cleanOptions({ type: 'render3d', complete: true }).complete, true);
  assert.equal(cleanOptions({ type: 'illustration', complete: true }).complete, true);
  assert.equal(cleanOptions({ type: 'render3d' }).complete, false);
  assert.equal(cleanOptions({ type: 'render3d', complete: 'yes' }).complete, false);
  for (const type of ['clipart', 'lineart', 'vector']) assert.equal(cleanOptions({ type, complete: true }).complete, false, type);
});

test('the preview says how much was drawn below and what it was asked for', () => {
  const settings = { model: 'flux', width: 624, height: 1696, steps: 20, denoise: 0.5, guidance: 3.5, sampler: 'euler', scheduler: 'simple', easycache: 0.2 };
  const rows = (completed?: object) => Object.fromEntries(settingRows({ options: { ...DEFAULT_OPTIONS, type: 'render3d', complete: !!completed }, settings: { ...settings, ...(completed && { completed }) }, seed: 1, size: [624, 1696] } as any).map((r) => [r.label, r.value]));
  const r = rows({ share: 0.57, prompt: 'The lower half of the same statue.', described: 'model' });
  assert.equal(r['Complete the figure'], '57% of the height drawn below, described by the model');
  assert.equal(r['Missing part asked for'], 'The lower half of the same statue.');
  assert.equal(rows({ share: 0.57, prompt: 'p', described: 'template' })['Complete the figure'], '57% of the height drawn below, from a plain description');
  assert.equal(rows()['Complete the figure'], undefined);   // a result made without it says nothing about it
});
