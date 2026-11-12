import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.TELIOS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'telios-remix-test-'));

const { REMIX_STEPS, REMIX_STYLE, WHOLE_DENOISE, cleanOptions, denoiseOf, findStyle, settingRows, styleChoices } = await import('@telios/shared');
const { cleanAnswer } = await import('../src/restyle/read.ts');
const { lookWords, restylePrompt } = await import('../src/restyle/prompt.ts');

const REMIX = 'Create a similar image inspired by the attached image with a white background.';

test('Remix is a style of an illustration only, named Remix, with no words of its own, and is not rotated through', () => {
  assert.equal(cleanOptions({ type: 'illustration', style: REMIX_STYLE }).style, REMIX_STYLE);
  for (const type of ['vector', 'trace', 'cutout']) assert.equal(cleanOptions({ type, style: REMIX_STYLE }).style, '', type);
  assert.equal(findStyle(REMIX_STYLE)?.label, 'Remix');
  assert.equal(findStyle(REMIX_STYLE)?.art, null);
  assert.ok(!styleChoices('illustration').includes(REMIX_STYLE));
  assert.deepEqual(lookWords(cleanOptions({ type: 'illustration', style: REMIX_STYLE })), [], 'no "In this style" sentence');
});

test('the prompt only asks for a similar picture inspired by it, on white, whatever ground is chosen; a theme and the user\'s words follow it', () => {
  for (const background of ['original', 'white', 'black']) {
    assert.equal(restylePrompt(cleanOptions({ type: 'illustration', style: REMIX_STYLE, background })), REMIX, background);
  }
  const p = restylePrompt(cleanOptions({ type: 'illustration', style: REMIX_STYLE, theme: 'egyptian', notes: 'thin lines' }));
  assert.ok(p.startsWith(`${REMIX} `), p);
  assert.match(p, /themed, with .* motifs and ornament\. thin lines\.$/);
  assert.doesNotMatch(p, /variation|In this style|Isolated/);
});

test(`it is drawn in ${REMIX_STEPS} steps whatever the quality, and the preview says so`, () => {
  assert.equal(REMIX_STEPS, 16);
  const o = cleanOptions({ type: 'illustration', style: REMIX_STYLE, quality: 'high' });
  assert.match(settingRows({ options: o } as any).find((r) => r.label === 'Drawn at')!.value, /, 16 steps$/);
  const settings = { model: 'flux', width: 1024, height: 1024, steps: 16, denoise: 0.8, guidance: 3.5, sampler: 'euler', scheduler: 'simple', easycache: 0 };
  const rows = settingRows({ options: o, settings, seed: 1, size: [1024, 1024] } as any);
  assert.match(rows.find((r) => r.label === 'Drawn at')!.value, /16 steps/);
  assert.match(rows.find((r) => r.label === 'Follow the original')!.value, /denoise 0\.8$/);
  assert.ok(!rows.some((r) => r.label === 'Read as'), 'the picture is not read');
});

test('a remix is drawn at its own denoise: 0.6 Closely, 0.8 Balanced, 0.85 Loosely; other illustrations keep theirs', () => {
  const at = (closeness: string, style = REMIX_STYLE, whole = false) => denoiseOf(cleanOptions({ type: 'illustration', style, closeness, whole }));
  assert.deepEqual(['close', 'balanced', 'loose'].map((c) => at(c)), [0.6, 0.8, 0.85]);
  assert.deepEqual(['close', 'balanced', 'loose'].map((c) => at(c, '')), [0.4, 0.5, 0.6]);
  assert.equal(at('balanced', REMIX_STYLE, true), WHOLE_DENOISE, 'Draw it whole is drawn from nothing');
});

test('the model\'s answer is one run of prose: lines joined, quotes taken off, cut at a sentence when too long', () => {
  const read = 'A black ink line drawing of a lily with three open blooms on a plain white background';
  assert.equal(cleanAnswer(`"${read}."\n`, 400), `${read}.`);
  assert.equal(cleanAnswer('A drawing.\nOf a rose.', 400), 'A drawing. Of a rose.');
  assert.equal(cleanAnswer('  ', 400), null);
  assert.equal(cleanAnswer('First sentence here. Second one that runs on.', 30), 'First sentence here.');
});
