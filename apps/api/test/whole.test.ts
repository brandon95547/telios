import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.TELIOS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'telios-whole-test-'));
process.env.TELIOS_PROVIDER = 'none';   // no model: nothing is described

const { DEFAULT_OPTIONS, WHOLE_ASPECT, WHOLE_DENOISE, cleanOptions, settingRows } = await import('@telios/shared');
const { parseWhole, readWholeFigure } = await import('../src/restyle/whole.ts');
const { restylePrompt } = await import('../src/restyle/prompt.ts');
const { wholeSizes } = await import('../src/restyle/job.ts');

test('Draw it whole is for 2D and 3D illustrations only, off by default, and instead of Complete the figure', () => {
  assert.equal(DEFAULT_OPTIONS.whole, false);
  assert.equal(cleanOptions({ type: 'render3d', whole: true }).whole, true);
  assert.equal(cleanOptions({ type: 'illustration', whole: true }).whole, true);
  assert.equal(cleanOptions({ type: 'render3d', whole: 'yes' }).whole, false);
  for (const type of ['clipart', 'lineart', 'vector']) assert.equal(cleanOptions({ type, whole: true }).whole, false, type);
  const both = cleanOptions({ type: 'render3d', whole: true, complete: true });
  assert.deepEqual([both.whole, both.complete], [true, false], 'one or the other: the whole figure is drawn, nothing is added to the picture');
  assert.equal(cleanOptions({ type: 'render3d', complete: true }).complete, true);
});

test('the model\'s paragraph is its lines joined, without quotes, and cut at a sentence if it is too long', () => {
  assert.equal(parseWhole('"A full-length statue of a pharaoh stands facing right."\n'), 'A full-length statue of a pharaoh stands facing right.');
  assert.equal(parseWhole('\n  A highly detailed statue.\nHe wears a collar.  \n'), 'A highly detailed statue. He wears a collar.');
  assert.equal(parseWhole('   '), null);
  const long = Array.from({ length: 80 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
  const cut = parseWhole(long)!;
  assert.ok(cut.length <= 1400 && cut.endsWith('is here.'), 'cut at the end of a sentence');
  assert.equal(parseWhole('x'.repeat(2000))!.length, 1400, 'with no sentence to cut at, at the limit');
});

test('without a model nothing is described: no call is made', async () => {
  assert.equal(await readWholeFigure(Buffer.from('not a picture')), null);
});

test('the sentence is the redraw\'s opening, with the style, theme and extra words still after it', () => {
  const o = cleanOptions({ type: 'render3d', whole: true, theme: 'egyptian', notes: 'black granite' });
  const p = restylePrompt(o, 'ignored', undefined, 'A full-length statue of a pharaoh standing in profile, ending in bare feet on a low base');
  assert.match(p, /^A full-length statue of a pharaoh standing in profile, ending in bare feet on a low base\. /);
  assert.doesNotMatch(p, /referenced image|variation/, 'it does not ask for a variation of the picture');
  assert.match(p, /black granite\./);
  assert.match(p, /The whole figure is isolated on a plain, pure white background, with no floor, no wall, no scenery and no cast shadow, evenly lit so that its edges separate cleanly from the white\.$/);
  // without it, the type's own opening and ground, as before
  assert.match(restylePrompt(o, 'ignored'), /Isolated on a plain pure white background, with no floor, no wall and no cast shadow\.$/);
  assert.match(restylePrompt(o, 'ignored'), /^Using the referenced image as inspiration, create a 3D variation of it\./);
});

test('a whole figure is drawn on a 2:3 canvas, whatever shape the picture was, and kept at the size asked for', () => {
  const o = { type: 'render3d', quality: 'fast', size: 'drawn' } as const;
  const drawn = wholeSizes(o, [622, 350]);
  assert.ok(Math.abs(drawn.w / drawn.h - WHOLE_ASPECT) < 0.03, `${drawn.w} × ${drawn.h}`);
  assert.deepEqual([drawn.tw, drawn.th], [drawn.w, drawn.h]);
  assert.deepEqual([drawn.w % 16, drawn.h % 16], [0, 0], 'in 16-pixel steps');
  const original = wholeSizes({ ...o, size: 'original' }, [622, 350]);   // the longer side of the picture it came from
  assert.equal(original.th, 622);
  assert.ok(Math.abs(original.tw / original.th - drawn.w / drawn.h) < 0.01, 'the same shape');
  assert.equal(wholeSizes({ ...o, size: '2x' }, [622, 350]).tw, drawn.w * 2);
  assert.equal(WHOLE_DENOISE, 1, 'from nothing: a close-up cropped into a tall canvas keeps being a close-up at 0.9');
});

test('the preview says it was drawn whole, and from what sentence', () => {
  const settings = { model: 'flux', width: 416, height: 624, steps: 16, denoise: WHOLE_DENOISE, guidance: 3.5, sampler: 'euler', scheduler: 'simple', easycache: 0.2, whole: { prompt: 'A full-length statue.' } };
  const rows = Object.fromEntries(settingRows({ options: { ...DEFAULT_OPTIONS, type: 'render3d', whole: true }, settings, seed: 1, size: [416, 624] } as any).map((r) => [r.label, r.value]));
  assert.match(rows['Draw it whole'], /^the whole figure, described by the model and drawn from that sentence alone on a taller canvas/);
  assert.equal(rows['Figure asked for'], 'A full-length statue.');
  const plain = Object.fromEntries(settingRows({ options: { ...DEFAULT_OPTIONS, type: 'render3d' }, settings: { ...settings, whole: undefined }, seed: 1, size: [416, 624] } as any).map((r) => [r.label, r.value]));
  assert.equal(plain['Draw it whole'], undefined);
});
