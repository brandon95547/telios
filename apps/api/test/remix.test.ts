import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.TELIOS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'telios-remix-test-'));
process.env.TELIOS_PROVIDER = 'none';   // no model: nothing is read

const { REMIX_STYLE, cleanOptions, findStyle, settingRows, styleChoices } = await import('@telios/shared');
const { readRemix } = await import('../src/restyle/remix.ts');
const { cleanAnswer } = await import('../src/restyle/read.ts');
const { lookWords, restylePrompt } = await import('../src/restyle/prompt.ts');

const READ = 'A black ink line drawing of a lily with three open blooms on a plain white background';

test('Remix is a style of an illustration only, named Remix, with no words of its own, and is not rotated through', () => {
  assert.equal(cleanOptions({ type: 'illustration', style: REMIX_STYLE }).style, REMIX_STYLE);
  for (const type of ['vector', 'trace', 'cutout']) assert.equal(cleanOptions({ type, style: REMIX_STYLE }).style, '', type);
  assert.equal(findStyle(REMIX_STYLE)?.label, 'Remix');
  assert.equal(findStyle(REMIX_STYLE)?.art, null);
  assert.ok(!styleChoices('illustration').includes(REMIX_STYLE));
  assert.deepEqual(lookWords(cleanOptions({ type: 'illustration', style: REMIX_STYLE })), [], 'no "In this style" sentence');
});

const REMIXED = 'Using the referenced image as inspiration, create a remix of it: a black ink line drawing of a lily with three open blooms on a plain white background.';

test('ComfyUI is told to remix the picture, then what it is as a drawing; a theme and the user\'s words follow', () => {
  const o = cleanOptions({ type: 'illustration', style: REMIX_STYLE });
  assert.equal(o.background, 'original');
  assert.equal(restylePrompt(o, undefined, undefined, READ), REMIXED, 'its own ground is in the sentence, and nothing is added');
  const themed = cleanOptions({ type: 'illustration', style: REMIX_STYLE, theme: 'egyptian', notes: 'thin lines' });
  const p = restylePrompt(themed, undefined, undefined, READ);
  assert.ok(p.startsWith(`${REMIXED} `), p);
  assert.match(p, /themed, with .* motifs and ornament\. thin lines\.$/);
  assert.doesNotMatch(p, /variation|In this style/);
});

test('with another ground chosen, the sentence leaves it out and the ground is asked for as for any illustration', () => {
  const o = cleanOptions({ type: 'illustration', style: REMIX_STYLE, background: 'white' });
  assert.equal(restylePrompt(o, undefined, undefined, 'A black ink line drawing of a lily'), 'Using the referenced image as inspiration, create a remix of it: a black ink line drawing of a lily. Isolated on a plain pure white background.');
});

test('not read (no model), it is still asked for as a remix of the picture, and the preview says so', async () => {
  assert.equal(await readRemix(Buffer.from('not a picture'), undefined, true), null);
  const o = cleanOptions({ type: 'illustration', style: REMIX_STYLE });
  assert.equal(restylePrompt(o), 'Using the referenced image as inspiration, create a remix of it.');
  const settings = { model: 'flux', width: 1024, height: 1024, steps: 32, denoise: 0.5, guidance: 3.5, sampler: 'euler', scheduler: 'simple', easycache: 0 };
  const unread = settingRows({ options: o, settings, seed: 1, size: [1024, 1024] } as any);
  assert.match(unread.find((r) => r.label === 'Read as')!.value, /^not read/);
  const read = settingRows({ options: o, settings: { ...settings, remix: { read: READ } }, seed: 1, size: [1024, 1024] } as any);
  assert.equal(read.find((r) => r.label === 'Read as')!.value, READ);
  assert.match(read.find((r) => r.label === 'Follow the original')!.value, /denoise 0\.5$/);
});

test('the model\'s answer is one run of prose: lines joined, quotes taken off, cut at a sentence when too long', () => {
  assert.equal(cleanAnswer(`"${READ}."\n`, 400), `${READ}.`);
  assert.equal(cleanAnswer('A drawing.\nOf a rose.', 400), 'A drawing. Of a rose.');
  assert.equal(cleanAnswer('  ', 400), null);
  assert.equal(cleanAnswer('First sentence here. Second one that runs on.', 30), 'First sentence here.');
});
