import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.TELIOS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'telios-trace-test-'));

const { cleanOptions, OUTPUT_TYPES, hasPackage, settingRows, tracedOnly, typeInfo } = await import('@telios/shared');
const sharp = (await import('sharp')).default;
const { drawTrace } = await import('../src/restyle/trace.ts');
const { writePackage } = await import('../src/restyle/package.ts');
const { getResult, resultDir, saveResult } = await import('../src/restyle/store.ts');

// ── The type ──

test('Trace is a Vector type that only traces: neither ComfyUI nor a model draws it', () => {
  assert.equal(typeInfo('trace').label, 'Trace');
  assert.equal(typeInfo('trace').group, 'Vector');
  assert.ok(typeInfo('trace').vector);
  assert.deepEqual(OUTPUT_TYPES.filter((t) => tracedOnly(t.value)).map((t) => t.value), ['trace']);
});

test('a trace is one version, with no theme, and may keep the picture’s own ground', () => {
  const o = cleanOptions({ type: 'trace', variations: 3, theme: 'celtic', style: 'art-deco', background: 'original' });
  assert.equal(o.type, 'trace');
  assert.equal(o.variations, 1);
  assert.equal(o.theme, '');
  assert.equal(o.style, '');
  assert.equal(o.background, 'original');
  assert.equal(cleanOptions({ type: 'clipart', background: 'original' }).background, 'transparent', 'clip art is still cut out of its ground');
});

test('a trace is made for an object (the default) or a pattern tile: it has no fitting data for a frame, a border or a corner', () => {
  assert.equal(cleanOptions({ type: 'trace' }).madeFor, 'object');
  assert.equal(cleanOptions({ type: 'trace', madeFor: 'pattern' }).madeFor, 'pattern');
  assert.equal(cleanOptions({ type: 'trace', madeFor: 'frame' }).madeFor, 'object');
  assert.equal(cleanOptions({ type: 'clipart', madeFor: 'pattern' }).madeFor, 'auto');
});

// ── Tracing one ──

/** A scan: a pale margin round a design of two near browns (the print's grain), a dark blue disc and a cream stripe. */
async function makeResult(id: string, over: Record<string, unknown> = {}) {
  const dir = resultDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const W = 240, H = 180;
  const raw = Buffer.alloc(W * H * 3);
  const put = (x: number, y: number, [r, g, b]: number[]) => { const i = (y * W + x) * 3; raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let c = [206, 202, 191];                                             // the paper
    if (x >= 20 && x < W - 20 && y >= 20 && y < H - 20) {
      c = x < W / 2 ? [128, 68, 40] : [136, 86, 50];                      // two browns that are one color
      if ((x - 120) ** 2 + (y - 90) ** 2 < 30 ** 2) c = [43, 58, 103];     // a blue disc
      if (y >= 40 && y < 52) c = [199, 175, 129];                         // a cream stripe
    }
    put(x, y, c);
  }
  await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toFile(path.join(dir, 'source.png'));
  await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).webp().toFile(path.join(dir, 'original.webp'));
  saveResult({
    id, batchId: 'b1', inputId: 'i1', inputName: 'Lattice scan', folder: '', variation: 1, status: 'queued', createdAt: new Date().toISOString(),
    options: cleanOptions({ type: 'trace', background: 'transparent', ...over }),
  });
}

test('a trace comes back as layered SVG in a few flat colors, near colors one, the margin cleared, with its preview', async () => {
  await makeResult('xtrace1', { madeFor: 'pattern' });
  await drawTrace('xtrace1', new AbortController().signal);
  const r = getResult('xtrace1')!;
  assert.equal(r.status, 'done', r.error ?? 'no error');
  assert.ok(r.files?.svg && r.files.png && r.files.thumb && r.files.view);
  const svg = fs.readFileSync(path.join(resultDir('xtrace1'), 'result.svg'), 'utf8');
  assert.match(svg, /inkscape:groupmode="layer"/);
  assert.equal(r.traced!.colors.length, 3, `the two browns are one: ${r.traced!.colors.join(' ')}`);
  assert.deepEqual(r.size, [240, 180]);
  const png = await sharp(path.join(resultDir('xtrace1'), 'result.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(png.data[3], 0, 'the paper margin is clear');
  assert.match(r.warning ?? '', /exact repeat/, 'a pattern says it may not tile');
  assert.ok(!fs.existsSync(path.join(resultDir('xtrace1'), 'source.png')), 'the source is not kept');
});

test('a trace made for an object has no warning, and its settings are told in plain words', async () => {
  await makeResult('xtrace2');
  await drawTrace('xtrace2', new AbortController().signal);
  const r = getResult('xtrace2')!;
  assert.equal(r.warning, undefined);
  const rows = Object.fromEntries(settingRows(r).map((x) => [x.label, x.value]));
  assert.match(rows['Traced as'], /3 flat colors/);
  assert.match(rows['Made for'], /Object/);
  assert.equal(rows['Follow the original'], undefined, 'nothing is redrawn');
});

test('a trace that keeps the original’s ground keeps the margin too', async () => {
  await makeResult('xtrace3', { background: 'original' });
  await drawTrace('xtrace3', new AbortController().signal);
  const png = await sharp(path.join(resultDir('xtrace3'), 'result.png')).ensureAlpha().raw().toBuffer();
  assert.equal(png[3], 255, 'the corner is paper, drawn');
});

test('a trace has an app package, and a pattern’s says it is a tile', async () => {
  await makeResult('xtrace4', { madeFor: 'pattern' });
  await drawTrace('xtrace4', new AbortController().signal);
  const r = getResult('xtrace4')!;
  assert.ok(hasPackage(r));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'telios-pkg-'));
  const files = await writePackage(r, 'lattice-scan', work);
  const manifest = JSON.parse(fs.readFileSync(files.find((f) => f.name.endsWith('.json'))!.src, 'utf8'));
  assert.equal(manifest.piece, 'tile');
  assert.equal(manifest.kind, 'pattern');
  assert.equal(manifest.layers.length, 3);
  assert.deepEqual(manifest.size, [480, 360], 'the size of the SVG’s viewBox: a small picture is traced at twice its size');
  assert.equal(manifest.appReady, null, 'a trace is not measured for an app');
  assert.ok(files.some((f) => f.name.endsWith('.svg')));
  assert.ok(!hasPackage({ files: { png: 'x', svg: 'x', thumb: '', view: '', original: '' } }), 'clip art is no package');
});

test('a trace that fails is told plainly and keeps nothing', async () => {
  await makeResult('xtrace5');
  fs.rmSync(path.join(resultDir('xtrace5'), 'source.png'));
  await drawTrace('xtrace5', new AbortController().signal);
  const r = getResult('xtrace5')!;
  assert.equal(r.status, 'failed');
  assert.ok(r.error);
});
