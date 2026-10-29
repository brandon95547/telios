// An upload made ready to redraw: any picture Telios takes (PNG, JPEG, WebP, TIFF, GIF, BMP, SVG,
// EPS) drawn as source.png, at most 2048 pixels across, flattened on white, with a small screen
// copy for the grid. PDFs and zips are opened into their pages and pictures before this (routes.ts).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { python } from '../python.ts';
import { inputDir, updateInput } from './store.ts';

export const SOURCE_MAX = 2048;
export const THUMB = 360;

/** An SVG drawn so its longest side is about SOURCE_MAX pixels. */
async function svgPixels(file: string) {
  const meta = await sharp(file).metadata();   // its own size, at 72 dpi
  const longest = Math.max(meta.width ?? 512, meta.height ?? 512);
  const density = Math.max(18, Math.min(2400, Math.round((72 * SOURCE_MAX) / longest)));
  return sharp(file, { density }).png().toBuffer();
}

export async function prepareInput(id: string) {
  const dir = inputDir(id);
  const input = updateInput(id, (i) => { i.status = 'preparing'; delete i.error; });
  if (!input) return;
  try {
    const original = path.join(dir, `original.${input.format}`);
    let pixels: Buffer | string = original;
    if (input.format === 'svg') pixels = await svgPixels(original);
    else if (input.format === 'eps' || input.format === 'ps') {
      const tmp = path.join(os.tmpdir(), `telios-eps-${id}.png`);
      try {
        await python(['eps', original, tmp, '--longest', String(SOURCE_MAX)]);
      } catch (e) {
        throw new Error(/ghostscript|gs\b/i.test((e as Error).message) ? 'EPS needs Ghostscript (gs), which this server does not have.' : (e as Error).message);
      }
      pixels = fs.readFileSync(tmp);
      fs.rmSync(tmp, { force: true });
    } else if (!['png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff', 'gif'].includes(input.format)) {
      const tmp = path.join(os.tmpdir(), `telios-raster-${id}.png`);
      await python(['raster', original, tmp]);
      pixels = fs.readFileSync(tmp);
      fs.rmSync(tmp, { force: true });
    }
    const flat = sharp(pixels, { limitInputPixels: 200_000_000 }).rotate();
    const meta = await flat.metadata();
    const turned = (meta.orientation ?? 1) >= 5;   // EXIF says it is on its side
    const originalSize: [number, number] = turned ? [meta.height ?? 0, meta.width ?? 0] : [meta.width ?? 0, meta.height ?? 0];
    const source = await flat.flatten({ background: '#ffffff' })
      .resize({ width: SOURCE_MAX, height: SOURCE_MAX, fit: 'inside', withoutEnlargement: true })
      .png().toBuffer({ resolveWithObject: true });
    fs.writeFileSync(path.join(dir, 'source.png'), source.data);
    await sharp(source.data).resize({ width: THUMB, height: THUMB, fit: 'inside' }).webp({ quality: 80 }).toFile(path.join(dir, 'thumb.webp'));
    updateInput(id, (i) => { i.status = 'ready'; i.size = [source.info.width, source.info.height]; i.originalSize = originalSize; });
  } catch (e) {
    updateInput(id, (i) => { i.status = 'failed'; i.error = (e as Error).message; });
  }
}
