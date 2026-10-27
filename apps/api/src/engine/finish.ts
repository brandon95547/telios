// Stage 6: the finished drawing (a model's, a rebuild or a fast trace) into its result files: the
// drawing's own SVG, a layered SVG with one layer per color, a preview, the comparison and the
// fitting data.

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { lightnessOf } from '@telios/shared';
import type { ColorMode, Design, Iteration, Layout, PaletteColor, Reading, Run, RunEvent, RunResult } from '@telios/shared';
import { TRACE } from '../config.ts';
import { python } from '../python.ts';
import { rel } from '../store.ts';
import { compare, fitCheck, render, traceCopy, unitCheck } from './render.ts';
import { finalizeSvg } from './svg.ts';
import type { Drawing } from './draw.ts';

const darkFirst = (p: PaletteColor[]) => [...p].sort((a, b) => lightnessOf(a.hex) - lightnessOf(b.hex));

export async function finishDrawing(design: Design, reading: Reading, runDir: string, cropPng: string, d: Drawing): Promise<RunResult> {
  const dir = path.join(runDir, 'result');
  fs.mkdirSync(dir, { recursive: true });
  const svg = finalizeSvg(d.svg, design.name);
  const size = d.layout?.size ?? [0, 0];
  const palette = darkFirst(d.palette);
  fs.writeFileSync(path.join(dir, 'drawing.svg'), svg);
  fs.writeFileSync(path.join(dir, 'program.js'), d.program);
  const scale = Math.min(TRACE, 7000 / Math.max(...size));
  fs.writeFileSync(path.join(dir, 'trace.png'), await traceCopy(svg, palette, scale));
  const traced = await python<{ layers: RunResult['layers']; size: [number, number]; carvedLines: unknown }>(
    ['vectorize', path.join(dir, 'trace.png'), dir, '--palette', JSON.stringify(palette), '--width', String(size[0]), '--height', String(size[1]), '--title', design.name],
    10 * 60_000,
  );
  const preview = await render(svg, { long: 1400 });
  fs.writeFileSync(path.join(dir, 'preview.png'), preview);
  fs.writeFileSync(path.join(dir, 'compare.png'), await compare(cropPng, preview));
  const layout: Layout | null = d.layout;
  if (layout) fs.writeFileSync(path.join(dir, 'layout.json'), JSON.stringify(fittingData(layout, scale), null, 1));
  return {
    size: size as [number, number],
    layers: traced.layers,
    layout,
    palette,
    summary: [d.summary, d.colorRule, d.uncertain && `Unsure: ${d.uncertain}`].filter(Boolean).join(' '),
    colorMode: reading.colorMode,
    files: {
      drawing: rel(path.join(dir, 'drawing.svg')),
      layered: rel(path.join(dir, 'layered.svg')),
      preview: rel(path.join(dir, 'preview.png')),
      compare: rel(path.join(dir, 'compare.png')),
      program: rel(path.join(dir, 'program.js')),
      layout: layout ? rel(path.join(dir, 'layout.json')) : undefined,
    },
  };
}

/** The layout as a download: in the drawing's units, with what each field means. */
function fittingData(layout: Layout, traceScale: number) {
  return {
    ...layout,
    units: 'The SVG\'s user units (drawing.svg\'s viewBox; the layered SVG has the same width and height, its viewBox ' + traceScale + '× these).',
    about: {
      slice: 'How far the corners reach in: drawn whole.',
      keep: 'A middle ornament on the top and bottom edges (x) or the sides (y): drawn whole, centered.',
      repeat: 'One unit of the top and bottom edges (x) and of the sides (y): repeated whole as many times as the page needs, each eased by at most about a fifth; the second half of each edge mirrors the first.',
    },
  };
}

/** Rebuild: the upload cleaned and regularized without a model (worker/telios_worker/rebuild.py),
 * then checked like a drawing: the seam check of its repeating units and the fit check. */
export async function finishRebuild(design: Design, run: Run, runDir: string, designDir: string, cropPng: string, emit: (e: RunEvent) => void, save: () => void): Promise<RunResult> {
  const dir = path.join(runDir, 'result');
  fs.mkdirSync(dir, { recursive: true });
  const reading = run.reading;
  const out = await python<{ size: [number, number]; tracedAt: [number, number]; layers: RunResult['layers']; layout: Layout | null; palette: PaletteColor[]; symmetry: { lr?: number; tb?: number }; notes: string[] }>(
    ['rebuild', path.join(designDir, 'crop.png'), dir, '--reading', JSON.stringify(reading), '--analysis', path.join(designDir, 'analysis.json'), '--title', design.name],
    10 * 60_000,
  );
  for (const text of out.notes) emit({ type: 'note', text });
  emit({ type: 'status', status: 'running', stage: 'critique', message: 'Checking the seams and the fit' });
  const layered = fs.readFileSync(path.join(dir, 'layered.svg'), 'utf8');
  fs.writeFileSync(path.join(dir, 'drawing.svg'), layered);
  const preview = await render(layered, { long: 1400 });
  fs.writeFileSync(path.join(dir, 'preview.png'), preview);
  fs.writeFileSync(path.join(dir, 'compare.png'), await compare(cropPng, preview));
  const files: RunResult['files'] = { drawing: rel(path.join(dir, 'drawing.svg')), layered: rel(path.join(dir, 'layered.svg')), preview: rel(path.join(dir, 'preview.png')), compare: rel(path.join(dir, 'compare.png')) };
  const layout = out.layout;
  const warnings: string[] = [];
  if (layout) {
    fs.writeFileSync(path.join(dir, 'layout.json'), JSON.stringify(fittingData(layout, +(out.tracedAt[0] / out.size[0]).toFixed(4)), null, 1));
    files.layout = rel(path.join(dir, 'layout.json'));
    try {
      const u = await unitCheck(layered, layout);
      if (u) { fs.writeFileSync(path.join(dir, 'unitcheck.png'), u); files.unitcheck = rel(path.join(dir, 'unitcheck.png')); }
      const f = await fitCheck(layered, layout);
      if (f) { fs.writeFileSync(path.join(dir, 'fitcheck.png'), f); files.fitcheck = rel(path.join(dir, 'fitcheck.png')); }
    } catch (e) {
      warnings.push(`The seam or fit check could not be drawn: ${(e as Error).message}`);
    }
  }
  // one entry in the timeline, like a drawing's render
  const iteration: Iteration = {
    n: run.iterations.length + 1,
    at: new Date().toISOString(),
    ok: true,
    notes: 'Rebuilt from the upload: mirrored halves and repeating units averaged, specks and pinholes removed, one layer per color.',
    files: { render: files.preview, compare: files.compare, unitcheck: files.unitcheck, fitcheck: files.fitcheck, drawing: files.drawing },
    checks: { size: out.size, palette: out.palette, offPalette: 0, symmetry: out.symmetry.lr !== undefined ? { lr: out.symmetry.lr, tb: out.symmetry.tb ?? 0 } : undefined, warnings },
  };
  run.iterations.push(iteration);
  emit({ type: 'iteration', iteration });
  save();
  return {
    size: out.size,
    layers: out.layers,
    layout,
    palette: out.palette,
    summary: `Rebuilt from the upload without a model, as ${out.layers.length} flat color layer${out.layers.length === 1 ? '' : 's'}${reading.colorMode === 'neutral' ? ' on a neutral grayscale base' : ''}. It keeps the original's drawing and loses its damage where copies of a shape could be averaged; what appears only once stays as clear as the scan.`,
    notes: out.notes,
    colorMode: reading.colorMode,
    files,
  };
}

export async function finishTrace(design: Design, reading: Reading, runDir: string, designDir: string, cropPng: string): Promise<RunResult> {
  const dir = path.join(runDir, 'result');
  fs.mkdirSync(dir, { recursive: true });
  const mode: ColorMode = reading.colorMode;
  const traced = await python<{ layers: RunResult['layers']; size: [number, number] }>(
    ['trace', path.join(designDir, 'crop.png'), dir, '--mode', mode, '--title', design.name, ...(reading.palette.length ? ['--palette', JSON.stringify(reading.palette)] : [])],
    10 * 60_000,
  );
  const layered = fs.readFileSync(path.join(dir, 'layered.svg'), 'utf8');
  fs.writeFileSync(path.join(dir, 'drawing.svg'), layered);
  const preview = await render(layered, { long: 1400 });
  fs.writeFileSync(path.join(dir, 'preview.png'), preview);
  fs.writeFileSync(path.join(dir, 'compare.png'), await compare(cropPng, preview));
  const meta = await sharp(cropPng).metadata();
  return {
    size: [meta.width!, meta.height!],
    layers: traced.layers,
    layout: null,
    palette: traced.layers.map((l) => ({ hex: l.color, name: l.name })),
    summary: `Traced from the upload into ${traced.layers.length} color layer${traced.layers.length === 1 ? '' : 's'}${mode === 'neutral' ? ', converted to a neutral grayscale base' : ''}. A trace keeps the original's flaws; re-illustrate for new art.`,
    colorMode: mode,
    files: { drawing: rel(path.join(dir, 'drawing.svg')), layered: rel(path.join(dir, 'layered.svg')), preview: rel(path.join(dir, 'preview.png')), compare: rel(path.join(dir, 'compare.png')) },
  };
}
