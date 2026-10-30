import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.TELIOS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'telios-appready-test-'));

const { appReady, failures, fitSheet, overflow, sizeCheck, thinShare } = await import('../src/engine/appready.ts');
const { runProgram } = await import('../src/sandbox/run.ts');
const { classOf, kindFor, TARGETS, TRIMS } = await import('@telios/shared');

const EXAMPLES = path.join(import.meta.dirname, '../src/engine/examples');
const FRAME = { kind: 'frame', repeats: { axis: 'edges' }, symmetry: 'mirror-x' } as any;
const OBJECT = { kind: 'ornament', repeats: { axis: 'none' }, symmetry: 'none' } as any;
const INK = [{ hex: '#1d1a17', name: 'Ink' }];
const status = (r: any) => Object.fromEntries(r.checks.map((c: any) => [c.id, c.ok]));

async function example(name: string) {
  const out: any = await runProgram(fs.readFileSync(path.join(EXAMPLES, `${name}.js`), 'utf8'));
  assert.ok(out.ok, out.error);
  const { svg, layout, palette } = out.output;
  return { svg: svg as string, layout, palette: Object.entries(palette).map(([name, hex]) => ({ name, hex: hex as string })) };
}
const doc = (w: number, h: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

// ── what is made for what ──

test('what a picture is made for decides how it is drawn, and "let it decide" keeps what the model read', () => {
  assert.deepEqual(TARGETS.map((t) => t.value), ['auto', 'frame', 'border', 'corner', 'pattern', 'object']);
  assert.equal(kindFor('auto', 'ornament'), 'ornament');
  assert.equal(kindFor(undefined, 'frame'), 'frame');
  assert.equal(kindFor('frame', 'ornament'), 'frame');
  assert.equal(kindFor('pattern', 'frame'), 'pattern');
  assert.equal(kindFor('object', 'initial'), 'initial', 'an object the model read as an initial stays one');
  assert.equal(kindFor('object', 'frame'), 'ornament', 'told it is an object, a frame is drawn whole');
  assert.deepEqual((['frame', 'border', 'corner', 'pattern', 'ornament', 'initial', 'other'] as const).map(classOf), ['frame', 'border', 'corner', 'tile', 'object', 'object', 'object']);
});

// ── the example frames, which are the standard ──

test('a frame built with frameKit on a square master passes every check, at all twelve book sizes', async () => {
  const f = await example('frame-kit');
  const r = await appReady(f.svg, f.layout, f.palette, FRAME);
  assert.equal(r.ok, true, failures(r).join('\n'));
  assert.deepEqual(Object.keys(status(r)), ['layout', 'clip', 'fit', 'seam', 'window', 'thin', 'palette', 'background']);
  assert.deepEqual(f.layout.slice, [220, 220]);
  assert.ok(f.layout.repeat.x[1] > f.layout.repeat.x[0] && f.layout.keep.x[0] < 900 && f.layout.keep.x[1] > 900, 'a unit, and a kept middle centered');
});

test('frameKit makes the layout from the parts, whatever lengths it is given', async () => {
  const f = await example('frame-kit');
  // the master is W wide, the head's units fill (W − keep) / 2 − slice in whole copies of one length
  const unit = f.layout.repeat.x[1] - f.layout.repeat.x[0];
  const half = (1800 - (f.layout.keep.x[1] - f.layout.keep.x[0])) / 2 - 220;
  assert.ok(Math.abs(half / unit - Math.round(half / unit)) < 1e-3, 'whole units');
  const out: any = await runProgram('function draw() { frameKit({ size: [100, 100], slice: 10 }); }');
  assert.equal(out.ok, false);
  assert.match(out.error, /frameKit needs corner, edgeX and edgeY/);
});

test('a portrait master is measured at every book size, and the ones it stretches too far say so', async () => {
  const f = await example('renaissance-moresque');
  const r = await appReady(f.svg, f.layout, f.palette, FRAME);
  assert.equal(status(r).fit, false);
  assert.match(r.checks.find((c) => c.id === 'fit')!.detail, /of the 12 book sizes .* beyond 0\.78–1\.3/);
  assert.equal(TRIMS.length, 12);
  const square = await example('persian-carpet');
  assert.equal((await appReady(square.svg, square.layout, square.palette, FRAME)).ok, true, 'a square master fits them all');
});

// ── what it caught in a drawing by a cheaper model ──

/** A tall frame of hairlines with a plume that runs off the top, and no fitting data: how a first try came out. */
function hairlineFrame() {
  const wave = (y: number) => `<path d="M60 ${y} ${Array.from({ length: 24 }, (_, i) => `Q${100 + i * 40} ${y + (i % 2 ? 14 : -14)} ${120 + i * 40} ${y}`).join(' ')}" fill="none" stroke="#1d1a17" stroke-width="1.2"/>`;
  const plume = Array.from({ length: 9 }, (_, i) => `<path d="M575 80 Q${540 + i * 10} 0 ${500 + i * 20} -60" fill="none" stroke="#1d1a17" stroke-width="2"/>`).join('');
  return doc(1150, 1790, `<rect x="20" y="20" width="1110" height="1750" fill="none" stroke="#1d1a17" stroke-width="1.2"/>${wave(60)}${wave(1730)}${plume}`);
}

test('a hairline frame with a plume off the top and no repeat fails what an app would hit', async () => {
  const r = await appReady(hairlineFrame(), { form: 'frame', size: [1150, 1790] }, INK, FRAME);
  const s = status(r);
  assert.equal(r.ok, false);
  assert.equal(s.layout, false);
  assert.equal(s.clip, false);
  assert.equal(s.fit, false);
  assert.equal(s.thin, false);
  assert.match(r.checks.find((c) => c.id === 'clip')!.detail, /top edge \(by \d+ units or more\)/);
  assert.match(r.checks.find((c) => c.id === 'layout')!.detail, /give repeat\.x and repeat\.y/);
  assert.ok(failures(r).every((l) => l.startsWith('App-ready, ')), 'each goes back to the model as a line');
});

test('what the canvas cuts off is measured by how far it runs past, not seen by eye', async () => {
  const o = await overflow(doc(400, 300, '<rect x="-30" y="100" width="200" height="40" fill="#000"/><rect x="100" y="100" width="100" height="400" fill="#000"/>'));
  assert.ok(Math.abs(o.left - 30) < 3, `left ${o.left}`);
  assert.ok(o.bottom > 70, `bottom ${o.bottom}`);   // measured as far as the margin it looks into
  assert.equal(Math.round(o.top), 0);
  assert.equal(Math.round(o.right), 0);
});

test('hairlines are measured: they are most of the ink of a thin drawing and none of a bold one', async () => {
  const lines = (w: number) => doc(1000, 1000, Array.from({ length: 12 }, (_, i) => `<path d="M60 ${80 + i * 70}H940" stroke="#000" stroke-width="${w}" fill="none"/>`).join(''));
  assert.ok(await thinShare(lines(1.5)) > 0.9);
  assert.ok(await thinShare(lines(14)) < 0.02);
});

// ── an object is not a frame ──

/** A flower with a leaf, drawn whole on a portrait canvas, nothing near the edge. */
const FLOWER = doc(900, 1400, `<g fill="#c0392b" stroke="#1d1a17" stroke-width="10">${Array.from({ length: 8 }, (_, i) => `<ellipse cx="450" cy="420" rx="70" ry="190" transform="rotate(${i * 45} 450 600)"/>`).join('')}</g><path d="M450 800 V1280" stroke="#1d1a17" stroke-width="22"/><ellipse cx="560" cy="1050" rx="120" ry="50" fill="#2e7d32" stroke="#1d1a17" stroke-width="10" transform="rotate(-30 560 1050)"/>`);

test('an object is checked for being whole, clean and flat, and not fitted like a frame', async () => {
  const r = await appReady(FLOWER, { form: 'whole', size: [900, 1400] }, [{ hex: '#c0392b', name: 'Red' }, { hex: '#1d1a17', name: 'Ink' }, { hex: '#2e7d32', name: 'Green' }], OBJECT);
  assert.equal(r.piece, 'object');
  assert.deepEqual(Object.keys(status(r)), ['layout', 'clip', 'thin', 'palette', 'background']);
  assert.equal(r.ok, true, failures(r).join('\n'));
});

test('an object with a background, cut off at the edge, or in too many colors fails those, and only those', async () => {
  const withGround = doc(900, 1400, `<rect width="900" height="1400" fill="#f4ead9"/>${FLOWER.replace(/<svg[^>]*>|<\/svg>/g, '')}`);
  const r = await appReady(withGround, { form: 'whole', size: [900, 1400] }, [{ hex: '#f4ead9', name: 'Paper' }, { hex: '#c0392b', name: 'Red' }, { hex: '#1d1a17', name: 'Ink' }, { hex: '#2e7d32', name: 'Green' }], OBJECT);
  assert.deepEqual(Object.entries(status(r)).filter(([, ok]) => !ok).map(([id]) => id), ['background']);
  const cut = await appReady(doc(900, 1400, '<circle cx="450" cy="1400" r="300" fill="#c0392b"/>'), { form: 'whole', size: [900, 1400] }, [{ hex: '#c0392b', name: 'Red' }], OBJECT);
  assert.deepEqual(Object.entries(status(cut)).filter(([, ok]) => !ok).map(([id]) => id), ['clip']);
  const nine = Array.from({ length: 9 }, (_, i) => ({ hex: `#${(i * 28).toString(16).padStart(2, '0')}4488`, name: `C${i}` }));
  assert.equal(status(await appReady(FLOWER, { form: 'whole', size: [900, 1400] }, nine, OBJECT)).palette, false);
});

test('a wrong layout form for the kind is said, for a frame and an object alike', async () => {
  assert.equal(status(await appReady(FLOWER, { form: 'frame', size: [900, 1400] }, INK, OBJECT)).layout, false);
  assert.equal(status(await appReady(FLOWER, null, INK, OBJECT)).layout, false);
});

// ── the sheet ──

test('the fit sheet shows a frame on every book size, and an object at three sizes on three grounds', async () => {
  const f = await example('frame-kit');
  const png = await fitSheet(f.svg, f.layout, 'frame');
  const sharp = (await import('sharp')).default;
  const m = await sharp(png).metadata();
  assert.ok(m.width! > 1000 && m.height! > 500, `${m.width} × ${m.height}`);
  const o = await sharp(await fitSheet(FLOWER, { form: 'whole', size: [900, 1400] }, 'object')).metadata();
  assert.ok(o.width! > 800);
});

test('the file size limit is the heaviest frames an app already carries: a 3.5 MB shaded frame passes, a 6 MB one does not', () => {
  assert.equal(sizeCheck(574 * 1024).ok, true);
  assert.equal(sizeCheck(3.5 * 1048576).ok, true);
  const big = sizeCheck(6 * 1048576);
  assert.equal(big.ok, false);
  assert.match(big.detail, /6\.0 MB \(at most 4 MB\)/);
});
