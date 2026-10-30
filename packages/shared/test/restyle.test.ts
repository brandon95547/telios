import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_OPTIONS, settingRows } from '../src/index.ts';
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
  assert.equal(rows['Drawn at'], 'Standard: 1024 px, 20 steps');
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
