// Telling a picture already added from a new one: by its content (SHA-256 of the file's bytes), so
// the same picture under another name still counts, and a different one with the same name does not.
// A picture added before this was kept is hashed from its saved original the first time it is asked.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { inputDir, listInputs, updateInput } from './store.ts';

export function fileHash(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (chunk) => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
  });
}

/** Every picture in the inputs, by hash, with the name it was added under. */
export async function knownHashes(): Promise<Map<string, string>> {
  const known = new Map<string, string>();
  for (const input of listInputs()) {
    let hash = input.hash;
    if (!hash) {
      const original = path.join(inputDir(input.id), `original.${input.format}`);
      if (!fs.existsSync(original)) continue;
      hash = await fileHash(original);
      updateInput(input.id, (i) => { i.hash = hash; });
    }
    if (!known.has(hash)) known.set(hash, input.name);
  }
  return known;
}
