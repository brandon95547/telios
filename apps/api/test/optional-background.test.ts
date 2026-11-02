import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.TELIOS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'telios-background-test-'));
process.env.TELIOS_PROVIDER = 'none';

const { BACKGROUND_LABEL, DEFAULT_OPTIONS, cleanOptions, settingRows } = await import('@telios/shared');
const { restylePrompt } = await import('../src/restyle/prompt.ts');

test('with no background chosen an illustration keeps its own; a flat SVG always has one', () => {
  assert.equal(DEFAULT_OPTIONS.background, 'original');
  for (const type of ['illustration']) assert.equal(cleanOptions({ type, background: 'original' }).background, 'original', type);
  assert.equal(cleanOptions({ type: 'vector', background: 'original' }).background, 'transparent', 'a flat SVG has no ground of its own to keep');
  assert.equal(cleanOptions({}).background, 'original', 'the default type is an illustration');
  assert.equal(cleanOptions({ type: 'trace', background: 'original' }).background, 'original', 'a trace may keep the picture’s own ground');
  for (const background of ['transparent', 'white', 'black', 'green']) assert.equal(cleanOptions({ type: 'illustration', background }).background, background);
  assert.equal(cleanOptions({ type: 'illustration', background: 'purple' }).background, 'original', 'what is not understood is left at the default');
});

test('the prompt says nothing about the ground when the picture keeps its own, and asks for it bare when it is to be cut out', () => {
  const kept = restylePrompt(cleanOptions({ type: 'illustration', background: 'original' }));
  assert.equal(kept, 'Using the referenced image as inspiration, create a variation of it.');
  assert.doesNotMatch(kept, /Isolated|white background/);
  assert.match(restylePrompt(cleanOptions({ type: 'illustration', background: 'transparent' })), /Isolated on a plain pure white background, with no floor, no wall and no cast shadow\.$/);
  assert.match(restylePrompt(cleanOptions({ type: 'illustration', background: 'white' })), /Isolated on a plain pure white background\.$/);
  // a whole figure is drawn from nothing, so it is still asked for on a plain white ground, whatever is chosen
  const whole = restylePrompt(cleanOptions({ type: 'illustration', whole: true, background: 'original' }), undefined, 'A highly detailed full-length statue');
  assert.match(whole, /^A highly detailed full-length statue\. The whole figure is isolated on a plain, pure white background/);
});

test('the settings say that nothing was cut out when the original\'s ground is kept', () => {
  const settings = { model: 'flux', width: 624, height: 944, steps: 16, denoise: 0.5, guidance: 3.5, sampler: 'euler', scheduler: 'simple', easycache: 0.2 };
  const value = (background: string, extra: object = {}) => Object.fromEntries(settingRows({ options: { ...DEFAULT_OPTIONS, type: 'illustration', background }, settings: { ...settings, ...extra }, seed: 1, size: [624, 944] } as any).map((r) => [r.label, r.value])).Background;
  assert.equal(value('original'), 'kept as in the original: nothing cut out');
  assert.equal(value('white', { cutout: { by: 'model', with: 'birefnet.safetensors' } }), 'White, cut out by a model (birefnet.safetensors)');
  assert.equal(BACKGROUND_LABEL.original, 'Keep the original');
});
