import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.TELIOS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'telios-cutout-test-'));

const { cleanOptions, OUTPUT_TYPES, cutoutOnly, hasPackage, settingRows, typeInfo, workerOnly } = await import('@telios/shared');
const sharp = (await import('sharp')).default;
const { drawCutout } = await import('../src/restyle/cutout.ts');
const { getResult, resultDir, saveResult } = await import('../src/restyle/store.ts');

test('Cutout is a worker type: no ComfyUI, no model, one version, no theme, always transparent, WebP or PNG', () => {
  assert.equal(typeInfo('cutout').label, 'Cutout');
  assert.deepEqual(OUTPUT_TYPES.filter((t) => cutoutOnly({ type: t.value as any })).map((t) => t.value), ['cutout']);
  assert.ok(workerOnly({ type: 'cutout' as any }) && workerOnly({ type: 'trace' as any }) && !workerOnly({ type: 'illustration' as any }));
  const o = cleanOptions({ type: 'cutout', variations: 3, theme: 'celtic', style: 'art-deco', background: 'white', format: 'jpeg' });
  assert.equal(o.variations, 1);
  assert.equal(o.theme, '');
  assert.equal(o.style, '');
  assert.equal(o.background, 'transparent');
  assert.equal(o.format, 'webp');
  assert.equal(cleanOptions({ type: 'cutout', format: 'png' }).format, 'png');
});

// an engraving: black ink strokes on gray paper that is lighter toward one corner, 300 × 120
async function makeResult(id: string) {
  const dir = resultDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const W = 300, H = 120;
  const raw = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const paper = 205 + Math.round((x / W) * 30);
    const ink = (x >= 60 && x < 240 && y >= 50 && y < 56) || (x >= 100 && x < 104 && y >= 30 && y < 90);
    const v = ink ? 20 : paper;
    raw.set([v, v, v], (y * W + x) * 3);
  }
  await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toFile(path.join(dir, 'source.png'));
  await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).webp().toFile(path.join(dir, 'original.webp'));
  saveResult({
    id, batchId: 'b1', inputId: 'i1', inputName: 'Engraving', folder: '', variation: 1, status: 'queued', createdAt: new Date().toISOString(),
    options: cleanOptions({ type: 'cutout' }),
  });
}

test('a cutout makes the paper clear, keeps the ink, trims to the object and has no SVG or package', async () => {
  await makeResult('xcut1');
  await drawCutout('xcut1', new AbortController().signal);
  const r = getResult('xcut1')!;
  assert.equal(r.status, 'done', r.error ?? 'no error');
  assert.ok(r.files?.png && r.files.thumb && r.files.view && !r.files.svg);
  assert.ok(!hasPackage(r));
  const { data, info } = await sharp(path.join(resultDir('xcut1'), 'result.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual(r.size, [info.width, info.height]);
  assert.ok(info.width <= 2400 && info.width > 300, 'a small scan is enlarged, to at most 2400 px');
  assert.equal(data[3], 0, 'the corner, which was paper, is clear');
  const solid = data.filter((_, i) => i % 4 === 3 && data[i] === 255).length;
  assert.ok(solid > 100, 'the ink is solid');
  assert.match(r.cutout!.ink, /^#[0-9a-f]{6}$/);
  assert.ok(!fs.existsSync(path.join(resultDir('xcut1'), 'source.png')));
  const rows = Object.fromEntries(settingRows(r).map((x) => [x.label, x.value]));
  assert.match(rows['Cut out as'], /one ink/);
  assert.match(rows['Result'], /WEBP, transparent/);
  assert.equal(rows['Follow the original'], undefined);
});

test('a picture with no object on it fails in words', async () => {
  const dir = resultDir('xcut2');
  fs.mkdirSync(dir, { recursive: true });
  await sharp({ create: { width: 80, height: 80, channels: 3, background: '#d0d0d0' } }).png().toFile(path.join(dir, 'source.png'));
  saveResult({ id: 'xcut2', batchId: 'b1', inputId: 'i1', inputName: 'Blank', folder: '', variation: 1, status: 'queued', createdAt: new Date().toISOString(), options: cleanOptions({ type: 'cutout' }) });
  await drawCutout('xcut2', new AbortController().signal);
  const r = getResult('xcut2')!;
  assert.equal(r.status, 'failed');
  assert.match(r.error!, /No object was found/);
});
