// Restyle's API, under /api/restyle: inputs (uploaded pictures, folders, zips, PDF pages, or
// designs already in Telios), results (drawn by the job worker), and downloads of the ones chosen,
// one at a time or as a zip.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { cleanOptions, findStyle, findTheme, typeInfo, type OutputFormat, type RestyleInput, type RestyleResult } from '@telios/shared';
import { python } from '../python.ts';
import { designDir, getDesign } from '../store.ts';
import type { ToWorker } from '../worker/main.ts';
import { getInput, getResult, inputDir, listInputs, listResults, newInputId, newResultId, removeInput, removeResult, resultDir, saveInput, saveResult } from './store.ts';

/** What an upload may be, by extension; a zip is opened, a PDF taken page by page. */
export const PICTURES = new Set(['png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff', 'gif', 'bmp', 'svg', 'eps', 'ps']);
const MAX_PDF_PAGES = 24;
const ZIPS = path.join(os.tmpdir(), 'telios-downloads');

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && /^[a-z0-9]+$/.test(x)) : []);
const cleanName = (s: string) => s.replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'picture';
const cleanFolder = (s: string) => s.split('/').filter((p) => p.trim() && p !== '.' && p !== '..').map(cleanName).join('/').slice(0, 200);

/** A picture in the format asked for: PNG as drawn; WebP keeps its transparency; JPEG has none,
 * so it goes on the result's own background color. */
export async function inFormat(png: string, format: OutputFormat, background: RestyleResult['options']['background']) {
  if (format === 'png') return fs.readFileSync(png);
  if (format === 'webp') return sharp(png).webp({ quality: 90, alphaQuality: 100 }).toBuffer();
  return sharp(png).flatten({ background: background === 'black' ? '#000000' : '#ffffff' }).jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
}
const EXT: Record<OutputFormat, string> = { png: 'png', webp: 'webp', jpeg: 'jpg' };

/** The folder a result goes in, in a zip organized by what it was made as. */
export function resultFolder(r: RestyleResult) {
  const parts = [typeInfo(r.options.type).label, findStyle(r.options.style)?.label, findTheme(r.options.theme)?.label].filter(Boolean);
  return [parts.join(' - '), r.folder].filter(Boolean).join('/');
}
export const resultName = (r: RestyleResult) => `${cleanName(r.inputName)}${r.options.variations > 1 ? `-v${r.variation}` : ''}`;

export function restyleRoutes(toWorker: (m: ToWorker) => void) {
  const router = express.Router();
  const upload = multer({ dest: fs.mkdtempSync(path.join(os.tmpdir(), 'telios-restyle-')), limits: { fileSize: 2 * 1024 ** 3, files: 1000 } });

  function addInput(name: string, folder: string, file: string, format: string): RestyleInput {
    const id = newInputId();
    fs.mkdirSync(inputDir(id), { recursive: true });
    fs.copyFileSync(file, path.join(inputDir(id), `original.${format}`));
    const input: RestyleInput = { id, name: cleanName(name), folder: cleanFolder(folder), createdAt: new Date().toISOString(), status: 'preparing', format };
    saveInput(input);
    toWorker({ type: 'prepare', inputId: id });
    return input;
  }

  /** One uploaded file as inputs: a picture is one, a zip each picture in it, a PDF each page. */
  async function take(file: string, original: string, folder: string, created: RestyleInput[], errors: string[]) {
    const ext = path.extname(original).slice(1).toLowerCase();
    const base = path.basename(original, path.extname(original));
    if (ext === 'zip') {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'telios-zip-'));
      try {
        const { files, skipped } = await python<{ files: { file: string; name: string; folder: string }[]; skipped: number }>(['unzip', file, tmp], 15 * 60_000);
        for (const f of files) await take(f.file, f.name, [folder, base, f.folder].filter(Boolean).join('/'), created, errors);
        if (!files.length) errors.push(`${original}: no pictures inside.`);
        else if (skipped) errors.push(`${original}: ${skipped} file${skipped === 1 ? '' : 's'} that are not pictures were left out.`);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    } else if (ext === 'pdf') {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'telios-pdf-'));
      try {
        const { pages, total } = await python<{ pages: { page: number; file: string }[]; total: number }>(['pdfpages', file, tmp, '--max', String(MAX_PDF_PAGES)]);
        for (const p of pages) created.push(addInput(total > 1 ? `${base} p${p.page}` : base, folder, p.file, 'png'));
        if (total > pages.length) errors.push(`${original}: only the first ${pages.length} of ${total} pages were taken.`);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    } else if (PICTURES.has(ext)) {
      created.push(addInput(base, folder, file, ext === 'jpeg' ? 'jpg' : ext === 'tif' ? 'tiff' : ext));
    } else {
      errors.push(`${original}: not a picture Telios takes (PNG, JPEG, WebP, TIFF, GIF, BMP, SVG, EPS, PDF or a zip of them).`);
    }
  }

  router.get('/', (req, res) => { res.json({ inputs: listInputs(), results: listResults() }); });

  router.post('/inputs', upload.array('files', 1000), wrap(async (req, res) => {
    const files = (req.files as Express.Multer.File[]) ?? [];
    // a dropped folder sends each file's path inside it, in order
    let paths: string[] = [];
    try { paths = JSON.parse(String(req.body?.paths ?? '[]')); } catch { /* none */ }
    const created: RestyleInput[] = [];
    const errors: string[] = [];
    for (const [n, file] of files.entries()) {
      const where = typeof paths[n] === 'string' ? path.posix.dirname(paths[n]) : '';
      try {
        await take(file.path, file.originalname, where === '.' ? '' : where, created, errors);
      } catch (e) {
        errors.push(`${file.originalname}: ${(e as Error).message}`);
      } finally {
        fs.rmSync(file.path, { force: true });
      }
    }
    res.status(created.length || !files.length ? 201 : 400).json({ inputs: created, errors });
  }));

  // Designs already in Telios (the vector redraw's library), added as inputs.
  router.post('/inputs/from-designs', (req, res) => {
    const created: RestyleInput[] = [];
    for (const id of ids(req.body?.ids)) {
      const d = getDesign(id);
      if (!d) continue;
      created.push(addInput(d.name, '', path.join(designDir(id), d.original.file), path.extname(d.original.file).slice(1).toLowerCase()));
    }
    res.status(201).json({ inputs: created, errors: [] });
  });

  router.post('/inputs/delete', (req, res) => {
    const gone = ids(req.body?.ids).filter((id) => getInput(id));
    gone.forEach(removeInput);
    res.json({ deleted: gone.length });
  });

  // Draw these inputs: one result per input and variation, queued for the worker.
  router.post('/results', wrap(async (req, res) => {
    const options = cleanOptions(req.body?.options);
    const inputs = ids(req.body?.inputIds).map(getInput).filter((i): i is RestyleInput => i?.status === 'ready');
    if (!inputs.length) return res.status(400).json({ error: 'Choose pictures that are ready to redraw.' });
    const batchId = newResultId();
    const created: RestyleResult[] = [];
    for (const input of inputs) {
      for (let v = 1; v <= options.variations; v++) {
        const id = newResultId();
        const dir = resultDir(id);
        fs.mkdirSync(dir, { recursive: true });
        const source = path.join(inputDir(input.id), 'source.png');
        fs.copyFileSync(source, path.join(dir, 'source.png'));
        await sharp(source).resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toFile(path.join(dir, 'original.webp'));
        const r: RestyleResult = { id, batchId, inputId: input.id, inputName: input.name, folder: input.folder, options, variation: v, status: 'queued', createdAt: new Date().toISOString() };
        saveResult(r);
        created.push(r);
      }
    }
    // oldest first, so the grid fills in the order it was asked for
    for (const r of created) toWorker({ type: 'restyle', resultId: r.id });
    res.status(201).json({ results: created });
  }));

  router.post('/results/stop', (req, res) => {
    const list = ids(req.body?.ids).filter((id) => ['queued', 'running'].includes(getResult(id)?.status ?? ''));
    toWorker({ type: 'stop', resultIds: list });
    res.json({ stopped: list.length });
  });

  router.post('/results/retry', (req, res) => {
    const again = ids(req.body?.ids).map(getResult).filter((r): r is RestyleResult => !!r && ['failed', 'canceled'].includes(r.status) && fs.existsSync(path.join(resultDir(r.id), 'source.png')));
    for (const r of again) {
      saveResult({ ...r, status: 'queued', error: undefined, stage: undefined, finishedAt: undefined, createdAt: r.createdAt });
      toWorker({ type: 'restyle', resultId: r.id });
    }
    res.json({ queued: again.length });
  });

  router.post('/results/delete', (req, res) => {
    const list = ids(req.body?.ids).filter((id) => getResult(id));
    toWorker({ type: 'stop', resultIds: list.filter((id) => ['queued', 'running'].includes(getResult(id)?.status ?? '')) });
    list.forEach(removeResult);
    res.json({ deleted: list.length });
  });

  // One result, in its format (or ?format=png|webp|jpeg|svg).
  router.get('/results/:id/download', wrap(async (req, res) => {
    const r = getResult(String(req.params.id));
    if (!r?.files) return res.status(404).json({ error: 'No such picture.' });
    const want = String(req.query.format ?? r.options.format);
    const name = resultName(r);
    if (want === 'svg') {
      if (!r.files.svg) return res.status(404).json({ error: 'This one has no SVG.' });
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}.svg"`);
      return res.type('image/svg+xml').send(fs.readFileSync(path.join(resultDir(r.id), 'result.svg')));
    }
    const format = (['png', 'webp', 'jpeg'].includes(want) ? want : 'png') as OutputFormat;
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}.${EXT[format]}"`);
    res.type(format === 'jpeg' ? 'image/jpeg' : `image/${format}`).send(await inFormat(path.join(resultDir(r.id), 'result.png'), format, r.options.background));
  }));

  // The chosen results as one zip: each in its format, with its SVG, in folders by type, style and
  // theme when asked. Made once, fetched once from the address it answers with, then deleted.
  router.post('/download', wrap(async (req, res) => {
    const chosen = ids(req.body?.ids).map(getResult).filter((r): r is RestyleResult => !!r?.files);
    if (!chosen.length) return res.status(400).json({ error: 'Choose finished pictures to download.' });
    fs.mkdirSync(ZIPS, { recursive: true });
    for (const f of fs.readdirSync(ZIPS)) if (Date.now() - fs.statSync(path.join(ZIPS, f)).mtimeMs > 3600_000) fs.rmSync(path.join(ZIPS, f), { recursive: true, force: true });
    const token = crypto.randomBytes(12).toString('hex');
    const work = path.join(ZIPS, `${token}.files`);
    fs.mkdirSync(work);
    const taken = new Set<string>();
    const unique = (name: string) => {
      let n = 1, out = name;
      while (taken.has(out.toLowerCase())) out = name.replace(/(\.[a-z]+)$/, `-${++n}$1`);
      taken.add(out.toLowerCase());
      return out;
    };
    const manifest: { src: string; name: string }[] = [];
    try {
      for (const r of chosen) {
        const dir = req.body?.subfolders ? `${resultFolder(r)}/` : '';
        const base = `${dir}${resultName(r)}`;
        const src = path.join(work, `${r.id}.${EXT[r.options.format]}`);
        fs.writeFileSync(src, await inFormat(path.join(resultDir(r.id), 'result.png'), r.options.format, r.options.background));
        manifest.push({ src, name: unique(`${base}.${EXT[r.options.format]}`) });
        if (r.files!.svg) manifest.push({ src: path.join(resultDir(r.id), 'result.svg'), name: unique(`${base}.svg`) });
      }
      fs.writeFileSync(path.join(work, 'manifest.json'), JSON.stringify(manifest));
      await python(['pack', path.join(work, 'manifest.json'), path.join(ZIPS, `${token}.zip`)], 15 * 60_000);
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
    res.json({ url: `/api/restyle/download/${token}`, files: manifest.length });
  }));

  router.get('/download/:token', (req, res) => {
    const token = String(req.params.token);
    const file = path.join(ZIPS, `${token}.zip`);
    if (!/^[a-f0-9]{24}$/.test(token) || !fs.existsSync(file)) return res.status(404).json({ error: 'That download has expired: download them again.' });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    res.download(file, `telios-${stamp}.zip`, () => fs.rmSync(file, { force: true }));
  });

  return router;
}
