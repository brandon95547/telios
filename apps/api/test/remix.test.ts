import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.TELIOS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'telios-remix-test-'));

process.env.TELIOS_PROVIDER = 'none';   // no model: nothing is described

const { REMIX_DENOISE, REMIX_STEPS, REMIX_STYLE, WHOLE_DENOISE, cleanOptions, denoiseOf, findStyle, mainFile, settingRows, styleChoices } = await import('@telios/shared');
const sharp = (await import('sharp')).default;
const { traceToSvg } = await import('../src/restyle/trace-svg.ts');
const { cleanAnswer } = await import('../src/restyle/read.ts');
const { readRemix } = await import('../src/restyle/remix.ts');
const { lookWords, restylePrompt } = await import('../src/restyle/prompt.ts');
const { restyleWorkflow } = await import('../src/comfy/workflows.ts');

const DESCRIBED = 'A black ink tattoo flash design of a hibiscus flower in tribal style, solid black on a plain white background, vertical composition. Thick tapering S-curves and spiral curls fill the lower two-thirds';

test('Remix is a style of an illustration only, named Remix, with no words of its own, and is not rotated through', () => {
  assert.equal(cleanOptions({ type: 'illustration', style: REMIX_STYLE }).style, REMIX_STYLE);
  for (const type of ['vector', 'trace', 'cutout']) assert.equal(cleanOptions({ type, style: REMIX_STYLE }).style, '', type);
  assert.equal(findStyle(REMIX_STYLE)?.label, 'Remix');
  assert.equal(findStyle(REMIX_STYLE)?.art, null);
  assert.ok(!styleChoices('illustration').includes(REMIX_STYLE));
  assert.deepEqual(lookWords(cleanOptions({ type: 'illustration', style: REMIX_STYLE })), [], 'no "In this style" sentence');
});

test('the prompt is the model\'s description of the picture, its ground in it, whatever ground is chosen; a theme and the user\'s words follow it', () => {
  for (const background of ['original', 'white', 'black']) {
    assert.equal(restylePrompt(cleanOptions({ type: 'illustration', style: REMIX_STYLE, background }), undefined, undefined, DESCRIBED), `${DESCRIBED}.`, background);
  }
  const p = restylePrompt(cleanOptions({ type: 'illustration', style: REMIX_STYLE, theme: 'egyptian', notes: 'thin lines' }), undefined, undefined, DESCRIBED);
  assert.ok(p.startsWith(`${DESCRIBED}. `), p);
  assert.match(p, /themed, with .* motifs and ornament\. thin lines\.$/);
  assert.doesNotMatch(p, /variation|In this style|Isolated/);
});

test('without a model nothing is described (the job refuses to draw it then)', async () => {
  assert.equal(await readRemix(Buffer.from('not a picture')), null);
});

test(`it is drawn on a blank canvas, without the picture, at ${REMIX_DENOISE} in ${REMIX_STEPS} steps whatever the quality or how closely it follows`, () => {
  assert.equal(REMIX_STEPS, 48);
  assert.equal(REMIX_DENOISE, 1);
  for (const closeness of ['close', 'balanced', 'loose']) assert.equal(denoiseOf(cleanOptions({ type: 'illustration', style: REMIX_STYLE, closeness })), 1, closeness);
  assert.deepEqual(['close', 'balanced', 'loose'].map((closeness) => denoiseOf(cleanOptions({ type: 'illustration', style: '', closeness }))), [0.4, 0.5, 0.6], 'other illustrations keep theirs');
  assert.equal(denoiseOf(cleanOptions({ type: 'illustration', style: REMIX_STYLE, whole: true })), WHOLE_DENOISE, 'Draw it whole is drawn as a whole figure');
  const flux = { unet: 'flux.gguf', t5: 't5', clipL: 'clip_l', vae: 'ae', guidance: 3.5, sampler: 'euler', scheduler: 'simple', easycache: 0 };
  const w = restyleWorkflow(flux as any, { prompt: DESCRIBED, width: 832, height: 1296, steps: 48, denoise: 1, seed: 1, blank: true });
  assert.deepEqual(w['7'], { class_type: 'EmptySD3LatentImage', inputs: { width: 832, height: 1296, batch_size: 1 } });
  assert.ok(!Object.values(w).some((n: any) => n.class_type === 'LoadImage'), 'no picture is loaded');
  assert.equal(w['8'].inputs.denoise, 1);

  const o = cleanOptions({ type: 'illustration', style: REMIX_STYLE, quality: 'fast' });
  assert.match(settingRows({ options: o } as any).find((r) => r.label === 'Drawn at')!.value, /, 48 steps$/);
  const settings = { model: 'flux', width: 832, height: 1296, steps: 48, denoise: 1, guidance: 3.5, sampler: 'euler', scheduler: 'simple', easycache: 0, remix: { description: DESCRIBED } };
  const rows = settingRows({ options: o, settings, seed: 1, size: [832, 1296] } as any);
  assert.equal(rows.find((r) => r.label === 'Drawn from')!.value, 'a description of the picture, on a blank canvas: denoise 1');
  assert.equal(rows.find((r) => r.label === 'Described as')!.value, DESCRIBED);
  assert.ok(!rows.some((r) => r.label === 'Follow the original'), 'how closely it follows does not apply');
});

test('a remix is taken as its SVG, with the drawing beside it; without an SVG (the trace failed) as the drawing', () => {
  const options = cleanOptions({ type: 'illustration', style: REMIX_STYLE, format: 'webp' });
  assert.deepEqual(mainFile({ options, files: { svg: 'x/result.svg' } }), { format: 'svg', also: 'webp' });
  assert.deepEqual(mainFile({ options, files: {} }), { format: 'webp' });
  const settings = { model: 'flux', width: 1024, height: 1024, steps: 48, denoise: 1, guidance: 3.5, sampler: 'euler', scheduler: 'simple', easycache: 0, vector: { colors: 1 } };
  assert.equal(settingRows({ options, settings, seed: 1 } as any).find((r) => r.label === 'Vector')!.value, 'the drawing traced into 1 flat color, one SVG layer each');
});

test('what ComfyUI drew (black ink on white) is traced into an SVG of its ink, the white cleared', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'telios-remix-trace-'));
  const drawn = path.join(dir, 'result.png');
  const ink = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="#fff"/><circle cx="120" cy="90" r="50" fill="none" stroke="#000" stroke-width="12"/><path d="M120 140 C 110 180 140 200 120 230" fill="none" stroke="#000" stroke-width="10"/></svg>');
  await sharp(ink).png().toFile(drawn);
  const traced = await traceToSvg(drawn, dir, cleanOptions({ type: 'illustration', style: REMIX_STYLE, background: 'white' }));
  const svg = fs.readFileSync(path.join(dir, 'layered.svg'), 'utf8');
  assert.match(svg, /^<\?xml|^<svg/);
  assert.ok(traced.layers.length >= 1, 'at least the ink');
  assert.ok(traced.layers.some((l) => /^#[0-3]/.test(l.color)), `a dark ink layer: ${traced.layers.map((l) => l.color)}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the model\'s answer is one run of prose: lines joined, quotes taken off, cut at a sentence when too long', () => {
  const read = 'A black ink line drawing of a lily with three open blooms on a plain white background';
  assert.equal(cleanAnswer(`"${read}."\n`, 400), `${read}.`);
  assert.equal(cleanAnswer('A drawing.\nOf a rose.', 400), 'A drawing. Of a rose.');
  assert.equal(cleanAnswer('  ', 400), null);
  assert.equal(cleanAnswer('First sentence here. Second one that runs on.', 30), 'First sentence here.');
});
