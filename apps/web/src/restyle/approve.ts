// Approving results: the picture of each is saved into a folder on this computer (the "For Talari" folder), and
// the person takes them out of the results. Telios may run on a server, which cannot write to a folder here,
// so the browser does it, through its folder access: the folder is chosen once, remembered (IndexedDB), and
// asked for again only if the browser has forgotten that it may write there. Chrome, Edge and the apps built
// on them have it; Safari and Firefox do not.
//
//   a flat SVG        its app package (a zip: the SVG, its fitting data and checks, the fit sheet), which Talari's
//                     importer takes as it is
//   clip art, line art  the SVG
//   anything else     the picture, in the format chosen
//
// A file that is already in the folder is never overwritten: the new one is named "name (2)".

import { typeInfo, type RestyleResult } from '@telios/shared';
import { restyle } from '../api.ts';

/** The part of a browser's directory handle that is used here. */
export interface Folder {
  name: string;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<{ createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }>;
  queryPermission?(options: { mode: 'readwrite' }): Promise<string>;
  requestPermission?(options: { mode: 'readwrite' }): Promise<string>;
}

type Picker = (options: { id: string; mode: 'readwrite'; startIn: string }) => Promise<Folder>;
const picker = (): Picker | undefined => (window as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker?.bind(window);

export const canSaveToFolder = () => !!picker();

const DB = 'telios', STORE = 'folders', KEY = 'for-talari';
const open = () => new Promise<IDBDatabase>((resolve, reject) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE);
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
async function remembered(): Promise<Folder | null> {
  try {
    const db = await open();
    return await new Promise((resolve) => {
      const q = db.transaction(STORE).objectStore(STORE).get(KEY);
      q.onsuccess = () => resolve((q.result as Folder) ?? null);
      q.onerror = () => resolve(null);
    });
  } catch { return null; }
}
async function remember(folder: Folder) {
  try {
    const db = await open();
    await new Promise<void>((resolve) => {
      const t = db.transaction(STORE, 'readwrite');
      t.objectStore(STORE).put(folder, KEY);
      t.oncomplete = () => resolve();
      t.onerror = () => resolve();
    });
  } catch { /* not kept: the folder is asked for again next time */ }
}

/** The folder to save into: the one chosen before, if the browser still lets it write there, else the person chooses
 * it. Called from a click (the browser asks for the permission only then). Null when the person closes the chooser. */
export async function folderToSave(): Promise<Folder | null> {
  const choose = picker();
  if (!choose) throw new Error('This browser cannot save into a folder. Open Telios in Chrome or Edge, or use Download ticked.');
  const before = await remembered();
  if (before) {
    try {
      if ((await before.queryPermission?.({ mode: 'readwrite' })) === 'granted' || (await before.requestPermission?.({ mode: 'readwrite' })) === 'granted') return before;
    } catch { /* the folder is gone or no longer allowed: choose it again */ }
  }
  try {
    const chosen = await choose({ id: 'for-talari', mode: 'readwrite', startIn: 'desktop' });
    await remember(chosen);
    return chosen;
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') return null;
    throw e;
  }
}

/** What is saved of a result, and from where. */
export const fileOf = (r: RestyleResult) => restyle.downloadOne(r.id, r.drawing ? 'package' : typeInfo(r.options.type).vector && r.files?.svg ? 'svg' : undefined);

/** The name the server gave a download. */
export function nameOf(disposition: string | null, fallback: string) {
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition ?? '');
  if (!m) return fallback;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

/** `name`, or "name (2)", "name (3)"… the first that is not in the folder yet. */
async function free(folder: Folder, name: string) {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : `${stem} (${n})${ext}`;
    try { await folder.getFileHandle(candidate); } catch (e) {
      if ((e as DOMException).name === 'NotFoundError') return candidate;
      throw e;
    }
  }
}

/** Saves each result into the folder, one after the other; stops at the first that fails. `saved` are the ids that are in the
 * folder now (and may be taken out of the results), `names` what they were called there. */
export async function saveResults(results: RestyleResult[], folder: Folder): Promise<{ saved: string[]; names: string[]; error?: string }> {
  const saved: string[] = [], names: string[] = [];
  for (const r of results) {
    try {
      const res = await fetch(fileOf(r));
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `The server answered ${res.status}.`);
      const name = await free(folder, nameOf(res.headers.get('content-disposition'), `${r.inputName}.png`));
      const file = await (await folder.getFileHandle(name, { create: true })).createWritable();
      await file.write(await res.blob());
      await file.close();
      saved.push(r.id);
      names.push(name);
    } catch (e) {
      return { saved, names, error: `Could not save ${r.inputName}: ${(e as Error).message}` };
    }
  }
  return { saved, names };
}
