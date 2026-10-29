// Restyle's inputs and results on disk:
//   data/restyle/inputs/<id>/   input.json, original.<ext> (as uploaded), source.png (≤ 2048 px, on
//                               white: what is redrawn), thumb.webp
//   data/restyle/results/<id>/  result.json, result.png, result.svg (clip art, line art),
//                               thumb.webp and view.webp (screen copies), original.webp (to compare),
//                               source.png (until it is drawn)
// Deleting either takes its whole folder: nothing of it is left anywhere.

import fs from 'node:fs';
import path from 'node:path';
import { DATA } from '../config.ts';
import { newId, readJson, writeJson } from '../store.ts';
export { rel } from '../store.ts';
import type { RestyleInput, RestyleResult } from '@telios/shared';

const SAFE = /^[a-z0-9]+$/;
const INPUTS = path.join(DATA, 'restyle', 'inputs');
const RESULTS = path.join(DATA, 'restyle', 'results');

export const newInputId = () => newId('i');
export const newResultId = () => newId('x');

export function inputDir(id: string) {
  if (!SAFE.test(id)) throw new Error('bad input id');
  return path.join(INPUTS, id);
}
export function resultDir(id: string) {
  if (!SAFE.test(id)) throw new Error('bad result id');
  return path.join(RESULTS, id);
}

export const getInput = (id: string) => (SAFE.test(id) ? readJson<RestyleInput>(path.join(inputDir(id), 'input.json')) : null);
export const saveInput = (i: RestyleInput) => writeJson(path.join(inputDir(i.id), 'input.json'), i);
export const getResult = (id: string) => (SAFE.test(id) ? readJson<RestyleResult>(path.join(resultDir(id), 'result.json')) : null);
export const saveResult = (r: RestyleResult) => writeJson(path.join(resultDir(r.id), 'result.json'), r);

// A change to a record deleted meanwhile is dropped: writing it would make its folder again.
export function updateResult(id: string, change: (r: RestyleResult) => void) {
  const r = getResult(id);
  if (!r) return null;
  change(r);
  if (!fs.existsSync(resultDir(id))) return null;
  saveResult(r);
  return r;
}
export function updateInput(id: string, change: (i: RestyleInput) => void) {
  const i = getInput(id);
  if (!i) return null;
  change(i);
  if (!fs.existsSync(inputDir(id))) return null;
  saveInput(i);
  return i;
}

// Lists are read often (the page asks every few seconds while work runs), so each record is
// kept in memory until its file changes.
const memo = new Map<string, { mtime: number; value: unknown }>();
function list<T extends { createdAt: string }>(root: string, file: string): T[] {
  const out: T[] = [];
  for (const id of fs.readdirSync(root)) {
    if (!SAFE.test(id)) continue;
    const f = path.join(root, id, file);
    let mtime: number;
    try { mtime = fs.statSync(f).mtimeMs; } catch { continue; }
    let hit = memo.get(f);
    if (!hit || hit.mtime !== mtime) {
      const value = readJson<T>(f);
      if (!value) continue;
      memo.set(f, (hit = { mtime, value }));
    }
    out.push(hit.value as T);
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export const listInputs = () => list<RestyleInput>(INPUTS, 'input.json');
export const listResults = () => list<RestyleResult>(RESULTS, 'result.json');

export function removeInput(id: string) {
  fs.rmSync(inputDir(id), { recursive: true, force: true, maxRetries: 3 });
  memo.delete(path.join(inputDir(id), 'input.json'));
}
export function removeResult(id: string) {
  fs.rmSync(resultDir(id), { recursive: true, force: true, maxRetries: 3 });
  memo.delete(path.join(resultDir(id), 'result.json'));
}
