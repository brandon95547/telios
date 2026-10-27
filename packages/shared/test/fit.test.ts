import { test } from 'node:test';
import assert from 'node:assert/strict';
import { axisPieces, frameCells, unitCount, borderCells, namespaceSvg, recolor, materialColor, lightnessOf } from '../src/index.ts';
import type { Layout } from '../src/index.ts';

const covers = (pieces: { dst: [number, number] }[], T: number) => {
  const sorted = [...pieces].sort((a, b) => a.dst[0] - b.dst[0]);
  assert.ok(Math.abs(sorted[0].dst[0]) < 1e-6, 'starts at 0');
  for (let i = 1; i < sorted.length; i++) assert.ok(Math.abs(sorted[i].dst[0] - sorted[i - 1].dst[1]) < 1e-6, `piece ${i} meets the one before`);
  assert.ok(Math.abs(sorted[sorted.length - 1].dst[1] - T) < 1e-6, 'ends at the target');
};

test('unitCount picks the count closest on a log scale', () => {
  assert.equal(unitCount(300, 100), 3);
  assert.equal(unitCount(340, 100), 3);
  assert.equal(unitCount(360, 100), 4);
  assert.equal(unitCount(50, 100), 1);
});

test('an axis at its own length is drawn as is', () => {
  assert.deepEqual(axisPieces(1000, 1000, 200, [450, 550], [250, 350]), [{ src: [0, 1000], dst: [0, 1000] }]);
});

test('with a kept middle: corners and middle whole, units eased by at most a fifth, halves mirrored', () => {
  const L = 1500, T = 2250, keep: [number, number] = [686, 814], unit: [number, number] = [275.5, 592];
  const pieces = axisPieces(L, T, 240, keep, unit);
  covers(pieces, T);
  const middle = pieces.find((p) => p.src[0] === keep[0])!;
  assert.equal(middle.dst[1] - middle.dst[0], keep[1] - keep[0]);
  assert.ok(Math.abs((middle.dst[0] + middle.dst[1]) / 2 - T / 2) < 1e-6, 'middle centered');
  const units = pieces.filter((p) => p.src[0] === unit[0] || p.src[1] === L - unit[0]);
  for (const u of units) {
    const k = (u.dst[1] - u.dst[0]) / (unit[1] - unit[0]);
    assert.ok(k > 0.8 && k < 1.25, `unit eased ${k}`);
  }
  assert.deepEqual(pieces[0], { src: [0, unit[0]], dst: [0, unit[0]] });
  const last = pieces[pieces.length - 1];
  assert.deepEqual(last.src, [L - unit[0], L]);
});

test('without a kept middle the units fill between the caps', () => {
  const pieces = axisPieces(1200, 3000, 0, undefined, [100, 300]);
  covers(pieces, 3000);
  assert.equal(pieces.length, 2 + unitCount(3000 - 100 - 900, 200));
});

test('a frame that cannot repeat stretches only its plain middle', () => {
  const pieces = axisPieces(1000, 1600, 200);
  covers(pieces, 1600);
  assert.equal(pieces[0].dst[1] - pieces[0].dst[0], 200);
  assert.equal(pieces[2].dst[1] - pieces[2].dst[0], 200);
});

test('a square frame on a landscape page gets more units along the top, none turned', () => {
  const layout: Layout = { form: 'frame', size: [1500, 1500], slice: 240, keep: { x: [686, 814], y: [686, 814] }, repeat: { x: [275.5, 592], y: [275.5, 592] } };
  const { T, cells } = frameCells(layout, 11, 8.5);
  assert.ok(Math.abs(T[1] - 1500) < 1e-6);
  assert.ok(T[0] > 1500);
  const topUnits = cells.filter((c) => c.src[1] === 0 && c.src[0] === 275.5).length;
  const sideUnits = cells.filter((c) => c.src[0] === 0 && Math.abs(c.src[1] - 275.5) < 1e-6).length;
  assert.ok(topUnits > sideUnits || sideUnits === 0);
  // every cell keeps the art's band depth across the edge: nothing is stretched across
  for (const c of cells) {
    if (c.src[1] === 0 || c.src[1] === 1500 - 240) assert.equal(c.dst[3], 240);
  }
});

test('a border repeats to any length', () => {
  const { T, cells } = borderCells({ form: 'border', size: [800, 120], repeat: { x: [100, 300] } }, 2000);
  assert.equal(T[0], 2000);
  covers(cells.map((c) => ({ dst: [c.dst[0], c.dst[0] + c.dst[2]] as [number, number] })), 2000);
});

test('ids are namespaced so copies can share a page', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="20" viewBox="0 0 10 20"><defs><clipPath id="c"><rect width="5" height="5"/></clipPath></defs><g clip-path="url(#c)"><use href="#c"/></g></svg>';
  const { inner, viewBox, width, height } = namespaceSvg(svg, 'p');
  assert.equal(viewBox, '0 0 10 20');
  assert.equal(width, 10);
  assert.equal(height, 20);
  assert.match(inner, /id="p-c"/);
  assert.match(inner, /url\(#p-c\)/);
  assert.match(inner, /href="#p-c"/);
});

test('recolor swaps palette colors in any case', () => {
  assert.equal(recolor('<path fill="#AABBCC" stroke="#112233"/>', { '#aabbcc': '#000000' }), '<path fill="#000000" stroke="#112233"/>');
});

test('materials map grays by lightness', () => {
  assert.ok(lightnessOf('#ffffff') > 0.99 && lightnessOf('#000000') < 0.01);
  const dark = materialColor('#202020', 'gilt'), light = materialColor('#e0e0e0', 'gilt');
  assert.ok(lightnessOf(dark) < lightnessOf(light));
});
