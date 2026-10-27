// The Telios API: uploads, designs and their readings, runs and their live events, downloads, and
// the built web app. Long work (measuring, reading, drawing, tracing) happens in the job worker
// this process forks; model-written code never runs here.

import { fork, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { KINDS } from '@telios/shared';
import type { Design, Reading, Run, RunEvent } from '@telios/shared';
import { DATA, DRAW_EFFORT, MAX_RENDERS, PORT, PYTHON, WEB_DIST } from './config.ts';
import { dataFile, designDir, getDesign, getRun, listDesigns, newId, readEvents, readJson, runIdFor, saveDesign, saveRun, updateDesign, writeJson, appendEvent } from './store.ts';
import { python } from './python.ts';
import { modelHealth, provider } from './engine/llm.ts';
import { exportRun, parseColors, type Format } from './export.ts';
import type { FromWorker, ToWorker } from './worker/main.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ── The job worker ──

let worker: ChildProcess;
const listeners = new Map<string, Set<Response>>();
function startWorker() {
  worker = fork(path.join(HERE, 'worker', 'main.ts'), [], { execArgv: ['--import', 'tsx'], stdio: 'inherit' });
  worker.on('message', (m: FromWorker) => {
    if (m.type === 'event') for (const res of listeners.get(m.runId) ?? []) res.write(`data: ${JSON.stringify(m.event)}\n\n`);
  });
  worker.on('exit', (code) => {
    console.error(`[api] job worker exited (${code}); restarting`);
    setTimeout(startWorker, 1000);
  });
}
const toWorker = (m: ToWorker) => worker.send(m);

// ── App ──

const app = express();
app.use(express.json({ limit: '2mb' }));
const upload = multer({ dest: fs.mkdtempSync(path.join(os.tmpdir(), 'telios-upload-')), limits: { fileSize: 80 * 1024 * 1024, files: 30 } });
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

const ACCEPT: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.tif': 'image/tiff', '.tiff': 'image/tiff', '.pdf': 'application/pdf', '.gif': 'image/gif', '.bmp': 'image/bmp' };

app.get('/api/health', wrap(async (req, res) => {
  const model = await modelHealth(req.query.force === '1');
  res.json({ ok: true, effort: DRAW_EFFORT, maxRenders: MAX_RENDERS, model: { ok: model.ok, provider: model.provider, label: model.label, name: model.model, error: model.error }, python: fs.existsSync(PYTHON) });
}));

function designSummary(d: Design) {
  const runs = d.runs.map((id) => getRun(id)).filter((r): r is Run => !!r);
  const last = runs[runs.length - 1];
  return { ...d, lastRun: last ? { id: last.id, mode: last.mode, status: last.status, stage: last.stage, preview: last.result?.files.preview } : null };
}

app.get('/api/designs', (req, res) => { res.json(listDesigns().map(designSummary)); });

app.post('/api/designs', upload.array('files', 30), wrap(async (req, res) => {
  const files = (req.files as Express.Multer.File[]) ?? [];
  if (!files.length) return res.status(400).json({ error: 'No files were uploaded.' });
  const created: Design[] = [];
  const errors: string[] = [];
  for (const file of files) {
    const ext = path.extname(file.originalname).toLowerCase();
    const base = path.basename(file.originalname, ext).replace(/[_-]+/g, ' ').trim() || 'Untitled';
    try {
      if (!ACCEPT[ext]) throw new Error(`${file.originalname}: not an image or PDF Telios reads (PNG, JPG, WebP, TIFF, PDF).`);
      if (ext === '.pdf') {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'telios-pdf-'));
        const { pages, total } = await python<{ pages: { page: number; file: string }[]; total: number }>(['pdfpages', file.path, tmp, '--max', '12']);
        for (const p of pages) created.push(createDesign(total > 1 ? `${base}, page ${p.page}` : base, p.file, '.png', 'image/png', p.page));
        if (total > pages.length) errors.push(`${file.originalname}: only the first ${pages.length} of ${total} pages were taken.`);
        fs.rmSync(tmp, { recursive: true, force: true });
      } else {
        created.push(createDesign(base, file.path, ext, ACCEPT[ext]));
      }
    } catch (e) {
      errors.push((e as Error).message);
    } finally {
      fs.rmSync(file.path, { force: true });
    }
  }
  res.status(created.length ? 201 : 400).json({ designs: created, errors });
}));

function createDesign(name: string, from: string, ext: string, type: string, page?: number): Design {
  const id = newId('d');
  const dir = designDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const file = `original${ext}`;
  fs.copyFileSync(from, path.join(dir, file));
  const design: Design = { id, name: name.slice(0, 120), createdAt: new Date().toISOString(), original: { file, type, bytes: fs.statSync(path.join(dir, file)).size, ...(page && { page }) }, status: 'ingesting', runs: [] };
  saveDesign(design);
  toWorker({ type: 'ingest', designId: id });
  return design;
}

const findDesign = (req: Request, res: Response) => {
  const d = /^[a-z0-9]+$/.test(String(req.params.id)) ? getDesign(String(req.params.id)) : null;
  if (!d) res.status(404).json({ error: 'No such design.' });
  return d;
};

app.get('/api/designs/:id', (req, res) => {
  const d = findDesign(req, res);
  if (!d) return;
  const dir = designDir(d.id);
  res.json({
    design: d,
    analysis: readJson(path.join(dir, 'analysis.json')),
    runs: d.runs.map((id) => getRun(id)).filter(Boolean),
  });
});

app.patch('/api/designs/:id', (req, res) => {
  const d = findDesign(req, res);
  if (!d) return;
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 120) : '';
  res.json(updateDesign(d.id, (x) => { if (name) x.name = name; }));
});

app.delete('/api/designs/:id', (req, res) => {
  const d = findDesign(req, res);
  if (!d) return;
  if (d.runs.some((id) => ['queued', 'running'].includes(getRun(id)?.status ?? ''))) return res.status(409).json({ error: 'Cancel its running work first.' });
  fs.rmSync(designDir(d.id), { recursive: true, force: true });
  res.json({ ok: true });
});

app.put('/api/designs/:id/reading', (req, res) => {
  const d = findDesign(req, res);
  if (!d) return;
  const r = req.body as Partial<Reading>;
  if (!d.reading) return res.status(409).json({ error: 'The design has not been read yet.' });
  if (r.kind && !KINDS.some((k) => k.value === r.kind)) return res.status(400).json({ error: 'Unknown kind.' });
  const reading: Reading = { ...d.reading, ...pickReading(r), confirmed: true };
  const saved = updateDesign(d.id, (x) => { x.reading = reading; });
  writeJson(path.join(designDir(d.id), 'reading.confirmed.json'), reading);
  res.json(saved);
});

function pickReading(r: Partial<Reading>): Partial<Reading> {
  const out: Partial<Reading> = {};
  const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : undefined);
  if (r.kind) out.kind = r.kind;
  if (r.rendering === 'flat' || r.rendering === 'shaded') out.rendering = r.rendering;
  if (r.colorMode === 'one-ink' || r.colorMode === 'neutral' || r.colorMode === 'full') out.colorMode = r.colorMode;
  if (typeof r.carvedLines === 'boolean') out.carvedLines = r.carvedLines;
  if (r.symmetry && ['none', 'mirror-x', 'mirror-y', 'four-way', 'rotational'].includes(r.symmetry)) out.symmetry = r.symmetry;
  if (r.repeats && typeof r.repeats === 'object') out.repeats = { axis: r.repeats.axis ?? 'none', description: str(r.repeats.description) ?? '', count: typeof r.repeats.count === 'number' ? r.repeats.count : null };
  if (Array.isArray(r.palette)) out.palette = r.palette.filter((c) => c && /^#[0-9a-f]{6}$/i.test(c.hex)).slice(0, 16).map((c) => ({ hex: c.hex.toLowerCase(), name: str(c.name, 60) || c.hex }));
  for (const k of ['colorReason', 'material', 'structure', 'motifs', 'style', 'leaveOut', 'plan'] as const) { const v = str(r[k]); if (v !== undefined) out[k] = v; }
  return out;
}

app.post('/api/designs/:id/runs', (req, res) => {
  const d = findDesign(req, res);
  if (!d) return;
  if (d.status !== 'ready' || !d.reading) return res.status(409).json({ error: 'The design is still being read.' });
  const mode = (['rebuild', 'reillustrate', 'trace'] as const).find((m) => m === req.body?.mode) ?? 'rebuild';
  const model = mode === 'reillustrate' ? provider().provider : null;
  if (mode === 'reillustrate' && !model) return res.status(409).json({ error: provider().error });
  const maxRenders = Math.max(2, Math.min(20, Number(req.body?.maxRenders) || MAX_RENDERS));
  const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 2000) : undefined;
  const run: Run = {
    id: runIdFor(d.id, d.runs.length + 1),
    designId: d.id,
    mode,
    status: 'queued',
    stage: 'queued',
    createdAt: new Date().toISOString(),
    options: { maxRenders, model: model ? `${model.label} ${model.model}` : '', effort: DRAW_EFFORT, ...(note && { note }) },
    reading: d.reading,
    iterations: [],
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 },
  };
  saveRun(run);
  appendEvent(run, { type: 'status', status: 'queued', stage: 'queued', message: 'Waiting for a free worker' });
  updateDesign(d.id, (x) => { x.runs.push(run.id); });
  toWorker({ type: 'run', runId: run.id });
  res.status(201).json(run);
});

const findRun = (req: Request, res: Response) => {
  const r = /^[a-z0-9]+$/.test(String(req.params.id)) ? getRun(String(req.params.id)) : null;
  if (!r) res.status(404).json({ error: 'No such run.' });
  return r;
};

app.get('/api/runs/:id', (req, res) => { const r = findRun(req, res); if (r) res.json(r); });

app.get('/api/runs/:id/events', (req, res) => {
  const r = findRun(req, res);
  if (!r) return;
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  for (const e of readEvents(r)) res.write(`data: ${JSON.stringify(e)}\n\n`);
  res.write(`event: caught-up\ndata: {}\n\n`);
  const set = listeners.get(r.id) ?? new Set();
  set.add(res);
  listeners.set(r.id, set);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => { clearInterval(ping); set.delete(res); });
});

app.post('/api/runs/:id/cancel', (req, res) => {
  const r = findRun(req, res);
  if (!r) return;
  toWorker({ type: 'cancel', runId: r.id });
  res.json({ ok: true });
});

app.get('/api/runs/:id/export', wrap(async (req, res) => {
  const r = findRun(req, res);
  if (!r) return;
  const format = String(req.query.format) as Format;
  if (!['svg', 'layered', 'pdf', 'png', 'layout'].includes(format)) return res.status(400).json({ error: 'format is svg, layered, pdf, png or layout.' });
  const design = getDesign(r.designId)!;
  const hidden = typeof req.query.hidden === 'string' && req.query.hidden ? req.query.hidden.split(',') : [];
  const out = await exportRun(r, format, { colors: parseColors(req.query.colors), width: req.query.width ? Number(req.query.width) : undefined, background: typeof req.query.background === 'string' ? req.query.background : undefined, hidden });
  const slug = design.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'telios';
  res.setHeader('Content-Type', out.type);
  if (req.query.download !== '0') res.setHeader('Content-Disposition', `attachment; filename="${slug}${out.ext}"`);
  res.send(out.body);
}));

// Stored files (uploads, renders, results), by their path inside the data folder.
app.get('/files/{*rest}', (req, res) => {
  const relPath = (req.params as any).rest?.join?.('/') ?? '';
  const file = dataFile(relPath);
  if (!file) return res.status(404).end();
  res.setHeader('Cache-Control', 'no-cache');
  if (file.endsWith('.svg')) res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  res.sendFile(file);
});

// The built web app.
if (fs.existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get('/{*rest}', (req, res, next) => (req.path.startsWith('/api/') ? next() : res.sendFile(path.join(WEB_DIST, 'index.html'))));
}

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  console.error('[api]', err);
  res.status(500).json({ error: err.message });
});

startWorker();
app.listen(PORT, '127.0.0.1', () => {
  console.log(`Telios is running at http://localhost:${PORT}  (data: ${DATA})`);
});

export type { RunEvent };
