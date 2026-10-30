import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.TELIOS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'telios-background-test-'));

const { BACKGROUND_HEX, BACKGROUND_LABEL, DEFAULT_OPTIONS, cleanOptions, settingRows } = await import('@telios/shared');
const sharp = (await import('sharp')).default;
const { subjectOnWhite } = await import('../src/restyle/job.ts');
const { restylePrompt } = await import('../src/restyle/prompt.ts');
const { inFormat } = await import('../src/restyle/routes.ts');

const W = 40, H = 60;
/** A dark "hallway" with a red "subject" in its middle, and a mask of the subject (white kept). */
async function scene() {
  const dark = { create: { width: W, height: H, channels: 3 as const, background: '#202020' } };
  const subject = await sharp({ create: { width: 20, height: 30, channels: 3, background: '#cc2222' } }).png().toBuffer();
  const picture = await sharp(dark).composite([{ input: subject, left: 10, top: 15 }]).png().toBuffer();
  const patch = await sharp({ create: { width: 20, height: 30, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const mask = await sharp({ create: { width: W, height: H, channels: 3, background: '#000000' } }).composite([{ input: patch, left: 10, top: 15 }]).png().toBuffer();
  return { picture, mask };
}
const pixel = async (png: Buffer, x: number, y: number) => [...(await sharp(png).removeAlpha().extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer())];

test('the subject is put on flat white: nothing of the background is left for the redraw to keep', async () => {
  const { picture, mask } = await scene();
  const on = await subjectOnWhite(picture, mask);
  assert.equal(on.cut, true);
  assert.deepEqual(await pixel(on.png, 2, 2), [255, 255, 255]);      // the hallway is gone
  assert.deepEqual(await pixel(on.png, 37, 57), [255, 255, 255]);
  assert.deepEqual(await pixel(on.png, 20, 30), [204, 34, 34]);      // the subject is as it was
  assert.equal((await sharp(on.png).metadata()).hasAlpha, false);
});

test('a mask that finds no subject, or all of the picture, leaves the picture as it is', async () => {
  const { picture } = await scene();
  const black = await sharp({ create: { width: W, height: H, channels: 3, background: '#000000' } }).png().toBuffer();
  const white = await sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } }).png().toBuffer();
  for (const mask of [black, white]) {
    const on = await subjectOnWhite(picture, mask);
    assert.equal(on.cut, false);
    assert.equal(on.png, picture);
  }
});

test('a mask of another size still fits the picture', async () => {
  const { picture, mask } = await scene();
  const small = await sharp(mask).resize(20, 30).png().toBuffer();
  const on = await subjectOnWhite(picture, small);
  assert.equal(on.cut, true);
  assert.deepEqual(await pixel(on.png, 2, 2), [255, 255, 255]);
});

test('Green is a background beside the others, filled with pure green', async () => {
  assert.equal(cleanOptions({ background: 'green' }).background, 'green');
  assert.equal(cleanOptions({ background: 'plaid' }).background, 'transparent');
  assert.deepEqual(Object.keys(BACKGROUND_LABEL), ['transparent', 'white', 'black', 'green']);
  assert.deepEqual(BACKGROUND_HEX, { white: '#ffffff', black: '#000000', green: '#00ff00' });
  // a picture with a green ground is kept as it is in every format, with no white put behind it
  const green = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#00ff00' } }).png().toBuffer();
  const file = path.join(process.env.TELIOS_DATA!, 'green.png');
  fs.writeFileSync(file, green);
  assert.deepEqual(await pixel(await inFormat(file, 'jpeg', 'green'), 1, 1).then((p) => p.map((v) => (v > 128 ? 255 : 0))), [0, 255, 0]);
  assert.deepEqual(await pixel(await inFormat(file, 'png', 'green'), 1, 1), [0, 255, 0]);
});

test('a green ground is drawn on white and flattened on green after the cutout, so its prompt asks for white', () => {
  const o = { ...DEFAULT_OPTIONS, type: 'render3d' as const, style: '', background: 'green' as const };
  const p = restylePrompt(o, 'x');
  assert.match(p, /^Using the referenced image as inspiration, create a 3D variation of it\. Isolated on a plain pure white background, with no floor/);
  assert.doesNotMatch(p, /green/i);
  // with no model to cut it out, the same ground is asked for as a flat key color, as for a clear one
  assert.match(restylePrompt(o, 'x', 'green'), /solid flat pure bright green \(#00FF00\) background/);
});

test('the preview says the subject was cut out first, and names every ground', () => {
  const settings = { model: 'flux', width: 768, height: 1360, steps: 20, denoise: 0.5, guidance: 3.5, sampler: 'euler', scheduler: 'simple', easycache: 0.2 };
  const rows = (o: object, extra: object = {}) => Object.fromEntries(settingRows({ options: { ...DEFAULT_OPTIONS, type: 'render3d', ...o }, settings: { ...settings, ...extra }, seed: 1, size: [768, 1360] } as any).map((r) => [r.label, r.value]));
  const cut = { by: 'model' as const, with: 'birefnet.safetensors' };
  assert.equal(rows({ background: 'white' }, { startCutout: true, cutout: cut })['Start picture'], 'the subject cut out of the picture, on flat white');
  assert.equal(rows({ background: 'white' }, { startCutout: true, cutout: cut }).Background, 'White, cut out by a model (birefnet.safetensors)');
  assert.equal(rows({ background: 'green' }, { cutout: cut }).Background, 'Green, cut out by a model (birefnet.safetensors)');
  assert.equal(rows({ background: 'green' }, { cutout: cut })['Start picture'], undefined);   // only said when it happened
  // a result made before any of this reads as it did
  assert.equal(rows({ background: 'white' }).Background, 'White');
  assert.equal(rows({ background: 'black' }).Background, 'Black');
  assert.equal(rows({ background: 'transparent' }).Background, 'Transparent');
});
