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

test('Trace is a type that only traces: neither ComfyUI nor a model draws it', () => {
  assert.equal(typeInfo('trace').label, 'Trace');
  assert.ok(typeInfo('trace').vector);
  assert.deepEqual(OUTPUT_TYPES.filter((t) => tracedOnly({ type: t.value as any })).map((t) => t.value), ['trace']);
});

test('a trace is one version, with no theme, and may keep the picture’s own ground', () => {
  const o = cleanOptions({ type: 'trace', variations: 3, theme: 'celtic', style: 'art-deco', background: 'original' });
  assert.equal(o.type, 'trace');
  assert.equal(o.variations, 1);
  assert.equal(o.theme, '');
  assert.equal(o.style, '');
  assert.equal(o.background, 'original');
  assert.equal(cleanOptions({ type: 'vector', background: 'original' }).background, 'transparent', 'a flat SVG has no ground to keep');
});

test('a trace is made for an object (the default), a pattern tile or a border: it has no fitting data for a frame or a corner', () => {
  assert.equal(cleanOptions({ type: 'trace' }).madeFor, 'object');
  assert.equal(cleanOptions({ type: 'trace', madeFor: 'pattern' }).madeFor, 'pattern');
  assert.equal(cleanOptions({ type: 'trace', madeFor: 'border' }).madeFor, 'border');
  assert.equal(cleanOptions({ type: 'trace', madeFor: 'repeat' }).madeFor, 'repeat', 'or a repeat still to be found');
  assert.equal(cleanOptions({ type: 'trace', madeFor: 'frame' }).madeFor, 'object');
  assert.equal(cleanOptions({ type: 'trace', madeFor: 'corner' }).madeFor, 'object');
  assert.equal(cleanOptions({ type: 'illustration', madeFor: 'pattern' }).madeFor, 'auto');
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

test('an object trace comes back as layered SVG in a few flat colors, near colors one, the margin cleared, with its preview', async () => {
  await makeResult('xtrace1');
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
  assert.equal(r.warning, undefined);
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

/** A half-drop pattern scan: motifs (a disc, a bar) in three colors that repeat every 64 × 96 px, on a pale margin, turned `deg` degrees. */
async function makePattern(id: string, deg = 0, over: Record<string, unknown> = {}) {
  const dir = resultDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const W = 360, H = 480, M = 40;
  const cw = 64, ch = 96;
  const raw = Buffer.alloc((W + 2 * M) * (H + 2 * M) * 3, 206);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x % cw, v = y % ch;
    let c = [132, 86, 52];
    for (const [cx, cy] of [[0, 0], [cw / 2, ch / 2]]) {
      const du = Math.min(Math.abs(u - cx), cw - Math.abs(u - cx)), dv = Math.min(Math.abs(v - cy), ch - Math.abs(v - cy));
      if (du * du + dv * dv < (cw * 0.17) ** 2) c = [60, 70, 120];
      else if (du < cw * 0.04 && dv < ch * 0.3) c = [200, 175, 125];
    }
    const i = ((y + M) * (W + 2 * M) + x + M) * 3;
    raw[i] = c[0]; raw[i + 1] = c[1]; raw[i + 2] = c[2];
  }
  let img = sharp(raw, { raw: { width: W + 2 * M, height: H + 2 * M, channels: 3 } });
  if (deg) img = sharp(await img.png().toBuffer()).rotate(deg, { background: '#cecabf' });
  fs.writeFileSync(path.join(dir, 'source.png'), await img.png().toBuffer());
  await sharp({ create: { width: 40, height: 30, channels: 3, background: '#fff' } }).webp().toFile(path.join(dir, 'original.webp'));
  saveResult({
    id, batchId: 'b1', inputId: 'i1', inputName: 'Lattice scan', folder: '', variation: 1, status: 'queued', createdAt: new Date().toISOString(),
    options: cleanOptions({ type: 'trace', madeFor: 'pattern', background: 'transparent', ...over }),
  });
}

test('a pattern tile is cut from the scan’s repeat: straightened, one exact cell, seamless, with its fitting data', async () => {
  await makePattern('xtile1', 1.4);
  await drawTrace('xtile1', new AbortController().signal);
  const r = getResult('xtile1')!;
  assert.equal(r.status, 'done', r.error ?? 'no error');
  const t = r.traced!.tile!;
  assert.ok(Math.abs(t.cell[0] - 64) / 64 < 0.02 && Math.abs(t.cell[1] - 96) / 96 < 0.02, `cell ${t.cell}`);
  assert.ok(Math.abs(Math.abs(t.tilt) - 1.4) < 0.35, `tilt ${t.tilt}`);
  assert.equal(t.lattice, 'half-drop');
  assert.ok(t.seam < 1.5, `seam ${t.seam}`);
  const svg = fs.readFileSync(path.join(resultDir('xtile1'), 'result.svg'), 'utf8');
  const [w, h] = r.size!;
  assert.match(svg, new RegExp(`viewBox="0 0 ${Math.round(t.cell[0] * 2)} ${Math.round(t.cell[1] * 2)}"`), 'the viewBox is the tile');
  const layout = JSON.parse(fs.readFileSync(path.join(resultDir('xtile1'), 'layout.json'), 'utf8'));
  assert.deepEqual([layout.form, layout.lattice], ['tile', 'half-drop']);
  assert.ok(r.files?.layout && r.files.fitsheet);
  assert.match(r.warning ?? '', /The pattern's background \(#[0-9a-f]{6}, \d+% of the tile\) was taken out/);
  assert.ok(w > 0 && h > 0);
  const rows = Object.fromEntries(settingRows(r).map((x) => [x.label, x.value]));
  assert.match(rows['Repeat found'], /half-drop/);
  assert.match(rows['Straightened'], /turned 1\.\d/);
  assert.match(rows['Seam'], /none/);
});

test('a pattern tile’s app package says it is a tile, with its layout and fit sheet', async () => {
  await makePattern('xtile2');
  await drawTrace('xtile2', new AbortController().signal);
  const r = getResult('xtile2')!;
  assert.ok(hasPackage(r));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'telios-pkg-'));
  const files = await writePackage(r, 'lattice-scan', work);
  const manifest = JSON.parse(fs.readFileSync(files.find((f) => f.name.endsWith('.json'))!.src, 'utf8'));
  assert.equal(manifest.piece, 'tile');
  assert.equal(manifest.kind, 'pattern');
  assert.equal(manifest.layout.form, 'tile');
  assert.equal(manifest.layout.lattice, 'half-drop');
  assert.deepEqual(manifest.size, manifest.layout.size);
  assert.equal(manifest.appReady, null, 'a trace is not measured for an app');
  assert.ok(files.some((f) => f.name.endsWith('.svg')) && files.some((f) => f.name.endsWith('.fitsheet.png')));
  assert.ok(!hasPackage({ files: { png: 'x', svg: 'x', thumb: '', view: '', original: '' } }), 'clip art is no package');
});

/** A border scan: a motif that repeats every 64 px along a strip 96 high and 448 long, on a pale margin, made vertical (as a book's plate gives it). */
async function makeBorder(id: string, over: Record<string, unknown> = {}) {
  const dir = resultDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const W = 448, H = 96, M = 30, cw = 64;
  const raw = Buffer.alloc((W + 2 * M) * (H + 2 * M) * 3, 206);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x % cw;
    let c = [150, 120, 85];
    if (y < H * 0.12 || y > H * 0.88) c = [60, 30, 25];
    else if ((u - cw * 0.5) ** 2 + (y - H / 2) ** 2 < (H * 0.28) ** 2) c = [170, 50, 40];
    else if (Math.abs(u - cw * 0.2) < 3 && Math.abs(y - H * 0.4) < H * 0.2) c = [40, 40, 40];
    const i = ((y + M) * (W + 2 * M) + x + M) * 3;
    raw[i] = c[0]; raw[i + 1] = c[1]; raw[i + 2] = c[2];
  }
  fs.writeFileSync(path.join(dir, 'source.png'), await sharp(raw, { raw: { width: W + 2 * M, height: H + 2 * M, channels: 3 } }).rotate(90).png().toBuffer());
  await sharp({ create: { width: 40, height: 30, channels: 3, background: '#fff' } }).webp().toFile(path.join(dir, 'original.webp'));
  saveResult({
    id, batchId: 'b1', inputId: 'i1', inputName: 'Palmette border', folder: '', variation: 1, status: 'queued', createdAt: new Date().toISOString(),
    options: cleanOptions({ type: 'trace', madeFor: 'border', background: 'transparent', ...over }),
  });
}

test('a border is cut to one exact unit along its length, turned to run level, with a border’s fitting data', async () => {
  await makeBorder('xborder1');
  await drawTrace('xborder1', new AbortController().signal);
  const r = getResult('xborder1')!;
  assert.equal(r.status, 'done', r.error ?? 'no error');
  const t = r.traced!.tile!;
  assert.equal(t.lattice, 'strip');
  assert.ok(Math.abs(t.cell[0] - 64) / 64 < 0.02, `unit ${t.cell}`);
  assert.ok(t.seam < 1.5, `seam ${t.seam}`);
  const layout = JSON.parse(fs.readFileSync(path.join(resultDir('xborder1'), 'layout.json'), 'utf8'));
  assert.equal(layout.form, 'border');
  assert.equal(layout.fit, 'tile');
  assert.deepEqual(layout.repeat, { x: [0, layout.size[0]] }, 'the whole unit is the repeat');
  assert.ok(layout.size[0] < layout.size[1] * 4 && layout.size[1] > 80, `size ${layout.size}`);
  assert.ok(r.files?.fitsheet && r.files.layout);
  const rows = Object.fromEntries(settingRows(r).map((x) => [x.label, x.value]));
  assert.match(rows['Repeat found'], /along the border/);
});

test('a border’s app package says it is a border, with its layout', async () => {
  await makeBorder('xborder2');
  await drawTrace('xborder2', new AbortController().signal);
  const r = getResult('xborder2')!;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'telios-pkg-'));
  const files = await writePackage(r, 'palmette-border', work);
  const manifest = JSON.parse(fs.readFileSync(files.find((f) => f.name.endsWith('.json'))!.src, 'utf8'));
  assert.equal(manifest.piece, 'border');
  assert.equal(manifest.kind, 'border');
  assert.equal(manifest.layout.form, 'border');
  assert.deepEqual(manifest.layout.repeat, { x: [0, manifest.size[0]] });
  assert.ok(files.some((f) => f.name.endsWith('.fitsheet.png')));
});

test('a border chosen as a pattern is told it is a border, in plain words', async () => {
  await makeBorder('xborder3', { madeFor: 'pattern' });
  await drawTrace('xborder3', new AbortController().signal);
  const r = getResult('xborder3')!;
  assert.equal(r.status, 'failed');
  assert.match(r.error ?? '', /it is a border, not a pattern tile\. Choose Repeats → In one direction/);
});

test('a picture that does not repeat is refused as a pattern, in plain words', async () => {
  await makeResult('xtile3', { madeFor: 'pattern' });
  await drawTrace('xtile3', new AbortController().signal);
  const r = getResult('xtile3')!;
  assert.equal(r.status, 'failed');
  assert.match(r.error ?? '', /No repeating pattern was found/);
  assert.doesNotMatch(r.error ?? '', /ValueError/);
});

test('Find it for me makes a border of a border and a pattern of a pattern, and the result says which it found', async () => {
  await makeBorder('xfind1', { madeFor: 'repeat' });
  await drawTrace('xfind1', new AbortController().signal);
  const border = getResult('xfind1')!;
  assert.equal(border.status, 'done', border.error ?? '');
  assert.equal(border.options.madeFor, 'border');
  assert.equal(border.traced?.tile?.lattice, 'strip');
  await makePattern('xfind2', 0, { madeFor: 'repeat' });
  await drawTrace('xfind2', new AbortController().signal);
  const pattern = getResult('xfind2')!;
  assert.equal(pattern.status, 'done', pattern.error ?? '');
  assert.equal(pattern.options.madeFor, 'pattern');
  assert.notEqual(pattern.traced?.tile?.lattice, 'strip');
});

test('Find it for me says plainly when the picture repeats neither way', async () => {
  await makeResult('xfind3', { madeFor: 'repeat' });
  await drawTrace('xfind3', new AbortController().signal);
  const r = getResult('xfind3')!;
  assert.equal(r.status, 'failed');
  assert.match(r.error ?? '', /No repeat was found in this picture: its design does not repeat across and down, or along its length/);
});

test('a trace that fails is told plainly and keeps nothing', async () => {
  await makeResult('xtrace5');
  fs.rmSync(path.join(resultDir('xtrace5'), 'source.png'));
  await drawTrace('xtrace5', new AbortController().signal);
  const r = getResult('xtrace5')!;
  assert.equal(r.status, 'failed');
  assert.ok(r.error);
});
