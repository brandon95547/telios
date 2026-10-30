import { updateResult } from './store.ts';

/** A stage of a job, and about how many seconds it takes on a warm server: only their proportions matter. */
export interface Step { label: string; seconds: number }

/** Marks a stage as begun: its label, and the stretch of the bar it covers. */
export function setStage(id: string, label: string, from: number, to: number, seconds: number) {
  return updateResult(id, (r) => { r.stage = label; r.progress = { from, to, at: new Date().toISOString(), seconds }; });
}

/**
 * The stages a job will go through, in order (a stage it skips is left out of the list, so the bar
 * does not wait for it). Each takes the share of the bar its seconds are of the total. Calling the
 * result with a label begins that stage; a label not in the list changes the words alone.
 */
export function stagesOf(id: string, steps: Step[]) {
  const total = steps.reduce((n, s) => n + s.seconds, 0);
  const ranges = new Map<string, [number, number, number]>();
  let before = 0;
  for (const s of steps) {
    ranges.set(s.label, [before / total, (before + s.seconds) / total, s.seconds]);
    before += s.seconds;
  }
  return (label: string) => {
    const range = ranges.get(label);
    return range ? setStage(id, label, ...range) : updateResult(id, (r) => { r.stage = label; });
  };
}

/** Where a flat SVG's drawing loop sits in the bar (the rest is reading before it and finishing after). */
const READ_END = 0.1;
const STUDY_END = 0.2;
const DRAW_END = 0.9;
const CHECK_END = 0.97;

/**
 * The stretch of the bar for one of the drawing loop's messages, or null for one it does not know.
 * A drawing is `Running drawing n` then `Checking drawing n`, up to `maxRenders` of them; the loop
 * may stop sooner, and then the bar jumps on to the end.
 */
export function drawingStage(stage: string, message: string, maxRenders: number): [number, number, number] | null {
  const n = Number(/(\d+)$/.exec(message)?.[1]);
  const each = (DRAW_END - STUDY_END) / Math.max(1, maxRenders);
  if (stage === 'plan') return [READ_END, STUDY_END, 40];
  if (stage === 'draw' && n >= 1) return [STUDY_END + each * (n - 1), STUDY_END + each * (n - 0.3), 60];
  if (stage === 'critique' && n >= 1) return [STUDY_END + each * (n - 0.3), STUDY_END + each * n, 25];
  if (stage === 'critique') return [DRAW_END, CHECK_END, 30];   // the final check of the seams and the fit
  return null;
}

export const READING: [number, number, number] = [0, READ_END, 25];
export const FINISHING: [number, number, number] = [CHECK_END, 1, 3];
