import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runProgram } from '../src/sandbox/run.ts';
import { checkSvg } from '../src/engine/svg.ts';

const ok = `function draw() {
  const W = 200, H = 100;
  console.log('size', W, H);
  return { svg: svgDoc(W, H, ring(W, H, 0, 10, '#123456') + place(path(petal(40, 10), { fill: '#ff0000' }), 100, 50, 30)), palette: { Ink: '#123456', Red: '#ff0000' }, layout: { form: 'whole', size: [W, H] } };
}`;

test('a drawing program runs with the library and returns its SVG, palette, layout and logs', async () => {
  const r = await runProgram(ok);
  assert.ok(r.ok, !r.ok ? r.error : '');
  if (!r.ok) return;
  assert.match(r.output.svg, /^<svg /);
  assert.deepEqual(r.output.palette, { Ink: '#123456', Red: '#ff0000' });
  assert.deepEqual(r.output.logs, ['size 200 100']);
});

test('the program cannot reach the host: no require, process, fetch or timers', async () => {
  const r = await runProgram(`function draw() { return { svg: [typeof require, typeof process, typeof fetch, typeof setTimeout, typeof globalThis.process].join() } }`);
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.output.svg, 'undefined,undefined,undefined,undefined,undefined');
});

test('code generation from strings is off, so constructor escapes fail', async () => {
  for (const p of [
    `function draw() { return { svg: eval('1') } }`,
    `function draw() { return { svg: new Function('return 1')() } }`,
    `function draw() { return { svg: String(svgDoc.constructor.constructor('return process')().env) } }`,
  ]) {
    const r = await runProgram(p);
    assert.equal(r.ok, false, p);
    if (!r.ok) assert.match(r.error, /Code generation from strings disallowed/);
  }
});

test('a runaway program is stopped', async () => {
  const r = await runProgram('function draw() { for (;;) {} }', { timeoutMs: 1500 });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /timed out|took longer/);
});

test('errors say what is wrong and where', async () => {
  const missing = await runProgram('const x = 1;');
  assert.ok(!missing.ok && /must define a function draw/.test(missing.error));
  const clash = await runProgram('const f = 2; function draw() { return { svg: "" } }');
  assert.ok(!clash.ok && /already been declared/.test(clash.error));
});

test('the SVG allowlist refuses scripts, images, outside references, text and gradients', () => {
  const doc = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">${body}</svg>`;
  assert.ok(checkSvg(doc('<path d="M0,0L10,10" fill="#000000"/>')).ok);
  for (const bad of [
    '<script>alert(1)</script>',
    '<image href="file:///etc/passwd" width="10" height="10"/>',
    '<use href="http://example.com/x.svg#a"/>',
    '<rect width="10" height="10" fill="url(http://example.com/p)"/>',
    '<rect width="10" height="10" onload="x()"/>',
    '<text x="0" y="10">A</text>',
    '<linearGradient id="g"/>',
    '<foreignObject/>',
  ]) assert.equal(checkSvg(doc(bad)).ok, false, bad);
  assert.equal(checkSvg('<!DOCTYPE svg [<!ENTITY x "y">]><svg width="100" height="100"/>').ok, false);
  assert.equal(checkSvg('<svg xmlns="http://www.w3.org/2000/svg" width="20000" height="100"/>').ok, false);
});
