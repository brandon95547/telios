#!/usr/bin/env node
// Telios's style catalog (packages/shared/src/catalog.ts), written from Talari's own lists so the
// two apps offer the same choices: the art styles, their substyles and the mediums of the book
// app's step 2 (Phansora's model.js, with the words the API draws each by, styles.py), and the
// Theme dropdown of its Artwork panel (art-filters.js). Telios keeps the result, so it also runs
// standalone, without either repository.
//
//   node scripts/sync-catalog.mjs           write it again from ../phansora and ../phansora-api
//   node scripts/sync-catalog.mjs --check   fail if it is out of date (when both are there)
//
// PHANSORA_DIR and PHANSORA_API_DIR point elsewhere.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.resolve(process.env.PHANSORA_DIR ?? path.join(ROOT, '..', 'phansora'));
const API = path.resolve(process.env.PHANSORA_API_DIR ?? path.join(ROOT, '..', 'phansora-api'));
const OUT = path.join(ROOT, 'packages', 'shared', 'src', 'catalog.ts');
const check = process.argv.includes('--check');

const model = path.join(APP, 'assets', 'js', 'products', 'talari', 'model.js');
const filters = path.join(APP, 'assets', 'js', 'products', 'talari', 'art-filters.js');
if (!fs.existsSync(model) || !fs.existsSync(path.join(API, 'src', 'phansora'))) {
  console.log(`Phansora's repositories are not at ${APP} and ${API}: the catalog stays as it is.`);
  process.exit(0);
}

const { ART_STYLES, SUBSTYLES, MEDIUMS } = await import(pathToFileURL(model).href);
const { ART_FACETS } = await import(pathToFileURL(filters).href);
const python = fs.existsSync(path.join(API, '.venv', 'bin', 'python')) ? path.join(API, '.venv', 'bin', 'python') : 'python3';
const words = JSON.parse(execFileSync(python, ['-c', [
  'import json',
  'from phansora.products.talari.styles import ART_STYLES, SUBSTYLES, MEDIUMS',
  'print(json.dumps({"art": ART_STYLES, "sub": {k: v[1] for k, v in SUBSTYLES.items()}, "medium": MEDIUMS}))',
].join('\n')], { cwd: API, env: { ...process.env, PYTHONPATH: path.join(API, 'src') } }).toString());

const missing = (what, id) => { throw new Error(`The API has no words for the ${what} "${id}" (styles.py).`); };
const catalog = {
  artStyles: ART_STYLES.map((a) => ({
    id: a.id,
    label: a.label,
    words: words.art[a.id] ?? missing('art style', a.id),
    substyles: (SUBSTYLES[a.id] ?? []).map((s) => ({ id: s.id, label: s.label, words: words.sub[s.id] ?? missing('substyle', s.id) })),
  })),
  mediums: MEDIUMS.filter((m) => m.id !== 'auto').map((m) => ({ id: m.id, label: m.label, words: words.medium[m.id] ?? missing('medium', m.id) })),
  themes: ART_FACETS.find((f) => f.id === 'theme').groups.map((g) => ({ label: g.label, options: g.options.map(([id, label]) => ({ id, label })) })),
};

const text = `// Written by scripts/sync-catalog.mjs from Talari's lists (Phansora's model.js and art-filters.js,
// and the API's styles.py). Do not edit by hand: change them there and run the script again.

export interface Look { id: string; label: string; words: string }
export interface Catalog {
  artStyles: (Look & { substyles: Look[] })[];
  mediums: Look[];
  themes: { label: string; options: { id: string; label: string }[] }[];
}

export const CATALOG: Catalog = ${JSON.stringify(catalog, null, 1)};
`;
if (check) {
  if (!fs.existsSync(OUT) || fs.readFileSync(OUT, 'utf8') !== text) {
    console.error('packages/shared/src/catalog.ts is out of date with Talari: run node scripts/sync-catalog.mjs');
    process.exit(1);
  }
  console.log('The catalog matches Talari.');
} else {
  fs.writeFileSync(OUT, text);
  console.log(`Wrote ${path.relative(ROOT, OUT)}: ${catalog.artStyles.length} art styles, ${catalog.artStyles.reduce((n, a) => n + a.substyles.length, 0)} substyles, ${catalog.mediums.length} mediums, ${catalog.themes.reduce((n, g) => n + g.options.length, 0)} themes.`);
}
