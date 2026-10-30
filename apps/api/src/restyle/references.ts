// The reference pictures of the styles that are drawn with one (STYLE_REFERENCES): files in the
// data folder, `style-references/<style id>.webp` (or .png, .jpg), kept out of the repository and
// the Docker image, so they can be changed without a deploy. USO reads a picture as a 384-pixel
// square from its center, so one is made small before it goes to ComfyUI, whatever was dropped in.

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { STYLE_REFERENCES } from '@telios/shared';
import { DATA } from '../config.ts';

export const REFERENCE_DIR = path.join(DATA, 'style-references');
const EXTENSIONS = ['webp', 'png', 'jpg', 'jpeg'];
const MAX_SIDE = 768;

function fileOf(style: string, dir: string) {
  return EXTENSIONS.map((e) => path.join(dir, `${style}.${e}`)).find((f) => fs.existsSync(f)) ?? null;
}

/** The ids of the styles that take a reference and have its picture in the folder. */
export function availableReferences(dir = REFERENCE_DIR) {
  return Object.keys(STYLE_REFERENCES).filter((id) => fileOf(id, dir));
}

const made = new Map<string, { at: number; png: Buffer }>();

/** A style's reference: its picture as a PNG for ComfyUI, and how strongly to apply it. Null when
 * the style is not drawn with one, or its picture is not in the folder. */
export async function referenceFor(style: string, dir = REFERENCE_DIR) {
  const known = STYLE_REFERENCES[style];
  const file = known && fileOf(style, dir);
  if (!known || !file) return null;
  const at = fs.statSync(file).mtimeMs;
  let png = made.get(file);
  if (!png || png.at !== at) {
    png = { at, png: await sharp(file).rotate().flatten({ background: '#ffffff' }).resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true }).png().toBuffer() };
    made.set(file, png);
  }
  return { png: png.png, weight: known.weight };
}
