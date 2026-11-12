// A picture traced as it is into a few flat colors, one SVG layer per color (the worker's `trace`: near colors merged, TRACE_MERGE,
// and a scan's paper margin cleared, unless the picture keeps its own ground). Image to SVG traces the input with it, and
// Remix traces what ComfyUI drew.

import { TRACE_MAX_COLORS, TRACE_MERGE, type RestyleOptions } from '@telios/shared';
import { python } from '../python.ts';

export interface Layer { id: string; color: string; name: string; share: number }
export interface Traced { layers: Layer[] }

/** A worker's error in plain words: its Python type name is not for the person. */
export const plain = (e: unknown) => (e as Error).message.replace(/^\w*Error:\s*/, '');

/** Traces `source` into `scratch`/layered.svg, smoothed and cleared as the options ask. */
export async function traceToSvg(source: string, scratch: string, o: Pick<RestyleOptions, 'cleanup' | 'clearInside' | 'background'>): Promise<Traced> {
  try {
    return await python<Traced>(['trace', source, scratch, '--mode', 'auto', '--max-colors', String(TRACE_MAX_COLORS), '--merge', String(TRACE_MERGE),
      '--smooth', String(['off', 'light', 'strong'].indexOf(o.cleanup)), ...(o.clearInside ? ['--clear-inside'] : []), ...(o.background === 'original' ? ['--keep-background'] : [])], 10 * 60_000);
  } catch (e) {
    throw new Error(plain(e));
  }
}
