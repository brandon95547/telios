// Downloads: the drawing's SVG, the layered SVG, a vector PDF, a PNG at a chosen width and the
// fitting data, each with the user's color changes applied.

import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import sharp from 'sharp';
import { recolor } from '@telios/shared';
import type { Run } from '@telios/shared';
import { DATA } from './config.ts';
import { sizeOf } from './engine/render.ts';

export type Format = 'svg' | 'layered' | 'pdf' | 'png' | 'layout';

export interface ExportOptions {
  colors: Record<string, string>;
  /** PNG width in pixels. */
  width?: number;
  /** PNG background; transparent when left out. */
  background?: string;
  /** Layers to leave out (by id), from the review's toggles. */
  hidden?: string[];
}

const HEX = /^#[0-9a-f]{6}$/i;

export function parseColors(raw: unknown): Record<string, string> {
  if (typeof raw !== 'string' || !raw) return {};
  try {
    const obj = JSON.parse(raw);
    return Object.fromEntries(Object.entries(obj).filter(([k, v]) => HEX.test(k) && typeof v === 'string' && HEX.test(v))) as Record<string, string>;
  } catch { return {}; }
}

const fileOf = (relPath: string) => path.join(DATA, relPath);

function hideLayers(svg: string, hidden: string[] = []) {
  let out = svg;
  for (const id of hidden) {
    if (!/^[\w-]+$/.test(id)) continue;
    out = out.replace(new RegExp(`<g id="${id}"[^>]*>[\\s\\S]*?</g>`), '');
  }
  return out;
}

export async function exportRun(run: Run, format: Format, opts: ExportOptions): Promise<{ body: Buffer | string; type: string; ext: string }> {
  const r = run.result;
  if (!r) throw new Error('This run has no result yet.');
  if (format === 'layout') {
    if (!r.files.layout) throw new Error('This piece has no fitting data (only frames and borders do).');
    return { body: fs.readFileSync(fileOf(r.files.layout)), type: 'application/json', ext: '-fitting.json' };
  }
  const layered = hideLayers(recolor(fs.readFileSync(fileOf(r.files.layered), 'utf8'), opts.colors), opts.hidden);
  if (format === 'layered') return { body: layered, type: 'image/svg+xml', ext: '-layers.svg' };
  // With layers hidden, only the layered drawing can leave them out.
  const drawing = opts.hidden?.length ? layered : recolor(fs.readFileSync(fileOf(r.files.drawing), 'utf8'), opts.colors);
  if (format === 'svg') return { body: drawing, type: 'image/svg+xml', ext: '.svg' };
  if (format === 'png') {
    const [w] = sizeOf(drawing);
    const width = Math.max(16, Math.min(10000, Math.round(opts.width ?? 2400)));
    let img = sharp(Buffer.from(drawing), { density: (72 * width) / w, unlimited: true, limitInputPixels: 500_000_000 });
    if (opts.background && HEX.test(opts.background)) img = img.flatten({ background: opts.background });
    return { body: await img.resize({ width }).png().toBuffer(), type: 'image/png', ext: `-${width}px.png` };
  }
  if (format === 'pdf') return { body: await pdfOf(drawing), type: 'application/pdf', ext: '.pdf' };
  throw new Error(`Unknown format ${format}`);
}

/** A one-page vector PDF the size of the drawing (a design unit as a CSS pixel: 0.75 pt). */
function pdfOf(svg: string): Promise<Buffer> {
  const [w, h] = sizeOf(svg);
  const pw = w * 0.75, ph = h * 0.75;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [pw, ph], margin: 0, info: { Title: 'Telios', Creator: 'Telios' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      SVGtoPDF(doc, svg, 0, 0, { width: pw, height: ph, preserveAspectRatio: 'xMidYMid meet', assumePt: false });
      doc.end();
    } catch (e) { reject(e); }
  });
}
