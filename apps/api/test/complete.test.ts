import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.TELIOS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'telios-complete-test-'));
process.env.TELIOS_PROVIDER = 'none';   // no model: the plain description is used

const { COMPLETE_SHARE, COMPLETE_SHARES, DEFAULT_OPTIONS, cleanOptions, isBust, settingRows } = await import('@telios/shared');
const sharp = (await import('sharp')).default;
const { CUT_OFF_SHARE, basePrompt, bottomContact, extendCanvas, growthOf, layBack, lowerHalfPrompt, parseReading, readLowerHalf } = await import('../src/restyle/complete.ts');

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
  assert.equal(growthOf(100, 0.4), 40);
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

/** A mask of a subject (white) in a black picture: columns [x0, x1) from row y0 down to row y1. */
const maskOf = (width: number, height: number, x0: number, x1: number, y0: number, y1: number) => {
  const raw = Buffer.alloc(width * height);
  for (let y = y0; y < y1; y++) raw.fill(255, y * width + x0, y * width + x1);
  return sharp(raw, { raw: { width, height, channels: 1 } }).png().toBuffer();
};

test('a figure is cut off when its mask runs out of the bottom edge, and not when its feet are in the picture', async () => {
  // a bust: shoulders across the bottom edge
  assert.ok(await bottomContact(await maskOf(100, 100, 20, 80, 10, 100)) >= 0.59);
  // a whole figure: its feet 4 rows above the edge, and the floor, a sign or a shadow are not the subject
  assert.equal(await bottomContact(await maskOf(100, 100, 20, 80, 10, 96)), 0);
  // a sliver touching the edge (a stray tail) is not a figure cut off
  assert.ok(await bottomContact(await maskOf(100, 100, 40, 42, 10, 100)) < CUT_OFF_SHARE);
  // a nothing
  assert.equal(await bottomContact(await maskOf(100, 100, 0, 0, 0, 0)), 0);
});

test('what the model says about a picture is read as how much is shown, then the sentence', () => {
  const sentence = 'The lower half of the same gilded statue: the body continues straight down to a base.';
  assert.deepEqual(parseReading(`CHEST\n${sentence}`), { shown: 'chest', sentence });
  assert.deepEqual(parseReading(`  waist.\n"${sentence}"`), { shown: 'waist', sentence }, 'a stray full stop and quotes are tolerated');
  assert.deepEqual(parseReading('WHOLE\n'), { shown: 'whole', sentence: null });
  assert.deepEqual(parseReading(`WHOLE\n${sentence}`), { shown: 'whole', sentence: null }, 'nothing is drawn for a whole figure');
  assert.deepEqual(parseReading('THIGHS'), { shown: 'thighs', sentence: null });
  // a model that only gave the sentence, as the first version asked: it is the sentence, and how much is shown is unknown
  assert.deepEqual(parseReading(sentence), { shown: null, sentence });
  assert.equal(parseReading('  \n '), null);
});

test('a head or a chest ends as a bust on a base, more of a figure is drawn on down, a whole one gets nothing', () => {
  for (const shown of ['head', 'chest'] as const) assert.ok(isBust(shown) && COMPLETE_SHARES[shown] < 0.25, shown);
  for (const shown of ['waist', 'thighs'] as const) assert.ok(!isBust(shown) && COMPLETE_SHARES[shown] > 0.3 && COMPLETE_SHARES[shown] <= 0.7, shown);
  assert.ok(COMPLETE_SHARES.waist > COMPLETE_SHARES.thighs, 'less shown, more drawn');
  assert.equal((COMPLETE_SHARES as Record<string, number>).whole, undefined);
  assert.equal(isBust(null), false);
  assert.equal(growthOf(100, COMPLETE_SHARES.chest), 18);
  const bust = basePrompt('in black granite');
  assert.match(bust, /^A low, plain rectangular base of the same material and color as the bust/);
  assert.match(bust, /nothing continues below it\. in black granite\. Matching the upper body exactly/);
  assert.doesNotMatch(bust, /feet|legs|lower half/, 'no body is asked for');
});

test('a smaller amount makes a shorter canvas', async () => {
  const size: [number, number] = [48, 128];
  const { picture, mask: m } = await extendCanvas(await subject(), size, COMPLETE_SHARES.chest);   // 40 × 100 grows to 40 × 118
  assert.deepEqual([(await sharp(picture).metadata()).width, (await sharp(picture).metadata()).height], size);
  const levels = (await mask(m)).filter((_, i) => i % size[0] === 24);
  // the new area is the bottom 18 of 118 rows of the canvas: 21 of 128
  const firstNew = levels.findIndex((v) => v === 255);
  assert.ok(Math.abs(firstNew - Math.round(128 * 100 / 118)) <= 2, `new area starts at ${firstNew}`);
});

test('the result says how much of the figure was shown, and whether it ended as a bust', () => {
  const settings = { model: 'flux', width: 624, height: 700, steps: 20, denoise: 0.5, guidance: 3.5, sampler: 'euler', scheduler: 'simple', easycache: 0.2 };
  const row = (completed: object) => Object.fromEntries(settingRows({ options: { ...DEFAULT_OPTIONS, type: 'render3d', complete: true }, settings: { ...settings, completed }, seed: 1, size: [624, 700] } as any).map((r) => [r.label, r.value]))['Complete the figure'];
  assert.equal(row({ share: 0.18, prompt: 'p', described: 'template', shown: 'chest' }), 'finished as a bust on a base (18% of the height added), the picture showing the head and chest, from a plain description');
  assert.equal(row({ share: 0.65, prompt: 'p', described: 'model', shown: 'waist' }), '65% of the height drawn below, the picture showing down to the waist, described by the model');
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
