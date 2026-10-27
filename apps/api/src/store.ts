// Designs and runs on disk: data/designs/<id>/design.json, …/runs/<runId>/run.json and events.jsonl.
// Writes go through a temporary file and a rename, so a reader never sees half a file.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA } from './config.ts';
import type { Design, Run, RunEvent } from '@telios/shared';

export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
const SAFE = /^[a-z0-9]+$/;

export function designDir(id: string) {
  if (!SAFE.test(id)) throw new Error('bad design id');
  return path.join(DATA, 'designs', id);
}
export function runDir(designId: string, runId: string) {
  if (!SAFE.test(runId)) throw new Error('bad run id');
  return path.join(designDir(designId), 'runs', runId);
}

export function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 1));
  fs.renameSync(tmp, file);
}
export function readJson<T>(file: string): T | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return null; }
}

export const getDesign = (id: string) => readJson<Design>(path.join(designDir(id), 'design.json'));
export const saveDesign = (d: Design) => writeJson(path.join(designDir(d.id), 'design.json'), d);
export function updateDesign(id: string, change: (d: Design) => void): Design | null {
  const d = getDesign(id);
  if (!d) return null;
  change(d);
  saveDesign(d);
  return d;
}

export function listDesigns(): Design[] {
  const root = path.join(DATA, 'designs');
  return fs.readdirSync(root).filter((n) => SAFE.test(n))
    .map((n) => getDesign(n)).filter((d): d is Design => !!d)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** A run's id carries its design's: r<design>-<n>, so a run can be found from its id alone. */
export const runIdFor = (designId: string, n: number) => `${designId}r${n}`;
export function designOfRun(runId: string) {
  const i = runId.lastIndexOf('r');
  return i > 0 ? runId.slice(0, i) : '';
}

export const getRun = (runId: string) => {
  const designId = designOfRun(runId);
  return designId ? readJson<Run>(path.join(runDir(designId, runId), 'run.json')) : null;
};
export const saveRun = (r: Run) => writeJson(path.join(runDir(r.designId, r.id), 'run.json'), r);

export function appendEvent(run: Run, event: RunEvent) {
  fs.mkdirSync(runDir(run.designId, run.id), { recursive: true });
  fs.appendFileSync(path.join(runDir(run.designId, run.id), 'events.jsonl'), JSON.stringify(event) + '\n');
}
export function readEvents(run: Run): RunEvent[] {
  try {
    return fs.readFileSync(path.join(runDir(run.designId, run.id), 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch { return []; }
}

/** A file inside the data folder, by its path relative to it; null if it would leave the folder. */
export function dataFile(rel: string): string | null {
  const full = path.resolve(DATA, rel);
  return full.startsWith(DATA + path.sep) && fs.existsSync(full) && fs.statSync(full).isFile() ? full : null;
}
export const rel = (full: string) => path.relative(DATA, full).split(path.sep).join('/');
