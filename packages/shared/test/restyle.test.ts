import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanOptions, DEFAULT_OPTIONS, progressAt, settingRows } from '../src/index.ts';
import type { DrawSettings, RestyleOptions } from '../src/index.ts';

const drawn: DrawSettings = { model: 'flux1-dev-Q4_K_S.gguf', width: 912, height: 1152, steps: 20, denoise: 0.75, guidance: 3.5, sampler: 'euler', scheduler: 'simple', easycache: 0.2 };
const options = (o: Partial<RestyleOptions> = {}): RestyleOptions => ({ ...DEFAULT_OPTIONS, type: 'illustration', closeness: 'balanced', quality: 'standard', ...o });
const rowsOf = (rows: { label: string; value: string }[]) => Object.fromEntries(rows.map((r) => [r.label, r.value]));

test('the preview says what ComfyUI was given, in plain words', () => {
  const rows = rowsOf(settingRows({
    options: options({ style: 'fauvism', background: 'transparent', format: 'png', size: 'drawn' }), seed: 1222714756, size: [914, 1088],
    settings: { ...drawn, styleReference: { style: 'fauvism', weight: 0.5 }, cutout: { by: 'model', with: 'birefnet.safetensors' } },
  }));
  assert.equal(rows['Drawn at'], '912 × 1152 px, 20 steps (Standard)');
  assert.equal(rows['Follow the original'], 'Balanced, denoise 0.75');
  assert.equal(rows['Model'], 'flux1-dev-Q4_K_S.gguf');
  assert.equal(rows['Prompt strength'], 'guidance 3.5');
  assert.equal(rows['Sampler'], 'euler, simple, EasyCache 0.2');
  assert.equal(rows['Seed'], '1222714756');
  assert.equal(rows['Style picture'], 'Fauvism, strength 0.5');
  assert.equal(rows['Background'], 'Transparent, cut out by a model (birefnet.safetensors)');
  assert.equal(rows['Kept as'], 'PNG, as drawn, 914 × 1088 px');
});

test('a result from before the settings were kept says only what is known, and invents nothing', () => {
  const rows = rowsOf(settingRows({ options: options({ style: 'fauvism', background: 'transparent', format: 'webp', size: 'original' }), seed: 7, size: [373, 350] }));
  assert.equal(rows['Drawn at'], 'Standard: 1024 px, 32 steps');
  assert.equal(rows['Follow the original'], 'Balanced');
  assert.equal(rows['Seed'], '7');
  assert.equal(rows['Background'], 'Transparent');
  assert.equal(rows['Kept as'], 'WEBP, original size, 373 × 350 px');
  for (const absent of ['Model', 'Prompt strength', 'Sampler', 'Style picture']) assert.equal(rows[absent], undefined, absent);
});

test('the background says how it was made clear, or that it was not', () => {
  const bg = (o: Partial<RestyleOptions>, cutout: DrawSettings['cutout']) => rowsOf(settingRows({ options: options(o), settings: { ...drawn, cutout } }))['Background'];
  assert.equal(bg({ background: 'transparent' }, { by: 'color', with: 'a flat green backdrop' }), 'Transparent, cleared by color from a flat green backdrop');
  assert.equal(bg({ background: 'black' }, { by: 'model', with: 'birefnet.safetensors' }), 'Black, cut out by a model (birefnet.safetensors)');
  assert.equal(bg({ background: 'transparent' }, { by: 'none' }), 'Transparent, not cleared');
  assert.equal(bg({ background: 'white' }, undefined), 'White');
});

test('a style that wants a picture and had none says it was drawn from words alone; an enlargement is named', () => {
  const rows = rowsOf(settingRows({ options: options({ style: 'rococo', size: '2x' }), size: [1824, 2304], settings: { ...drawn, enlargedWith: '4x-UltraSharp.pth' } }));
  assert.equal(rows['Style picture'], 'none, drawn from words alone');
  assert.equal(rows['Kept as'], 'PNG, 2× as drawn, 1824 × 2304 px, enlarged with 4x-UltraSharp.pth');
  // a style with no picture to want has no such row
  assert.equal(rowsOf(settingRows({ options: options({ style: 'tonalism' }), settings: drawn }))['Style picture'], undefined);
});

test('progress eases through a stage and waits near its end, never passing it', () => {
  const at = '2026-10-30T12:00:00.000Z';
  const p = { from: 0.2, to: 0.6, at, seconds: 20 };
  const t0 = Date.parse(at);
  assert.equal(progressAt(p, t0), 0.2);
  assert.equal(progressAt(p, t0 - 5000), 0.2, 'a clock a little behind the server\'s does not move it back');
  const early = progressAt(p, t0 + 5000), onTime = progressAt(p, t0 + 20000), late = progressAt(p, t0 + 600000);
  assert.ok(0.2 < early && early < onTime && onTime < late, 'forward with time');
  assert.ok(onTime > 0.2 + 0.4 * 0.9 && onTime < 0.6, 'nearly through the stage by the time it usually ends');
  assert.ok(late <= 0.6 + 1e-9, 'a stage that runs long stops at its end');
});

test('a flat SVG says what it is made for, and nothing else is made for anything', () => {
  assert.equal(DEFAULT_OPTIONS.madeFor, 'auto');
  assert.equal(cleanOptions({ type: 'vector', madeFor: 'frame' }).madeFor, 'frame');
  assert.equal(cleanOptions({ type: 'vector', madeFor: 'object' }).madeFor, 'object');
  assert.equal(cleanOptions({ type: 'vector', madeFor: 'wall' }).madeFor, 'auto', 'a word it does not know falls back');
  assert.equal(cleanOptions({ type: 'clipart', madeFor: 'frame' }).madeFor, 'auto', 'ComfyUI types are not made for a kind');
  assert.equal(cleanOptions({}).madeFor, 'auto');
});

test('the preview says what a flat SVG was made for and whether it is app-ready', () => {
  const base = { options: { ...DEFAULT_OPTIONS, type: 'vector' as const, madeFor: 'frame' as const }, size: [200, 100] as [number, number] };
  const drawing = { runId: 'r', model: 'm', renders: 2, maxRenders: 6, costUsd: 0, kind: 'frame', colorMode: 'full', summary: 's' };
  const ok = rowsOf(settingRows({ ...base, drawing: { ...drawing, appReady: { piece: 'frame', ok: true, checks: [{ id: 'clip', label: 'Nothing cut off', ok: true, detail: '' }] } } }));
  assert.equal(ok['Made for'], 'Frame');
  assert.equal(ok['App-ready'], 'yes, all 1 checks pass');
  const bad = rowsOf(settingRows({ ...base, drawing: { ...drawing, appReady: { piece: 'frame', ok: false, checks: [{ id: 'fit', label: 'Fits every book size', ok: false, detail: '' }, { id: 'thin', label: 'Lines hold at small size', ok: false, detail: '' }] } } }));
  assert.equal(bad['App-ready'], 'no: fits every book size, lines hold at small size');
  assert.equal(rowsOf(settingRows({ ...base, options: { ...base.options, madeFor: 'auto' }, drawing }))['Made for'], undefined, 'let it decide has no row');
});
