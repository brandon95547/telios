import { test } from 'node:test';
import assert from 'node:assert/strict';

const { MAX_SCALE, MIN_ZOOM, ZOOM_STEP, clampZoom, drawnSize, fitScale, stepZoom, zoomLabel } = await import('../../web/src/restyle/zoom.ts');

test('a picture fits the window whole, and is never blown up to fit', () => {
  assert.equal(fitScale([2000, 1000], [1000, 800]), 0.5);
  assert.equal(fitScale([1000, 2000], [1000, 500]), 0.25, 'the tighter side decides');
  assert.equal(fitScale([200, 100], [1000, 800]), 1, 'a small picture is shown as it is');
  assert.equal(fitScale([0, 0], [1000, 800]), 1);
  assert.equal(fitScale([800, 600], [0, 0]), 1, 'before the window is measured');
});

test('zooming steps in and out, lands back on fit, and stays inside what can be drawn', () => {
  const fit = 0.5;
  const up = stepZoom(1, 1, fit);
  assert.equal(up, ZOOM_STEP);
  assert.equal(stepZoom(up, -1, fit), 1, 'one step out of one step in is fit again');
  assert.equal(stepZoom(1, -1, fit), 1 / ZOOM_STEP);
  assert.equal(stepZoom(MIN_ZOOM, -1, fit), MIN_ZOOM, 'no smaller than a quarter of fit');
  let z = 1;
  for (let n = 0; n < 40; n++) z = stepZoom(z, 1, fit);
  assert.equal(z * fit, MAX_SCALE, 'no more than 8 times the picture’s own pixels');
  assert.equal(clampZoom(100, 1), MAX_SCALE);
  assert.equal(clampZoom(5, 8), 1, 'a picture already drawn at its limit does not zoom in');
});

test('the drawn size and the percentage follow the zoom', () => {
  assert.deepEqual(drawnSize([2000, 1000], 0.5, 1), [1000, 500]);
  assert.deepEqual(drawnSize([2000, 1000], 0.5, 2), [2000, 1000]);
  assert.equal(zoomLabel(0.5, 1), '50%');
  assert.equal(zoomLabel(0.5, 2), '100%');
  assert.equal(zoomLabel(1, 1), '100%');
});
