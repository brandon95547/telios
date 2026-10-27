// Re-illustration (stages 3–5): the model studies the original, plans, writes a drawing program,
// and revises it against renders, close-ups and automatic checks until it meets the bar or its
// renders run out. Every program runs in the sandbox; every render is shown to the user live.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { z } from 'zod';
import { addUsage, asHistory, chat, imagePart, textPart, type Effort, type Message, type Part, type Tool } from './llm.ts';
import { runProgram, drawlibSource } from '../sandbox/run.ts';
import { checkSvg } from './svg.ts';
import { closeup, compare, fitCheck, forModel, normalizePalette, offPalette, render, sizeOf, symmetry, unitCheck } from './render.ts';
import { rel } from '../store.ts';
import type { Checks, Iteration, Layout, PaletteColor, Reading, Run, RunEvent } from '@telios/shared';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (f: string) => fs.readFileSync(path.join(HERE, f), 'utf8');

/** The standing instructions: the brief, the library and two finished programs. Frozen, so the
 * provider's prefix cache serves it again on every turn and run. */
const SYSTEM = [
  read('brief.md'),
  '## The drawing library (already defined in the sandbox)\n\n```js\n' + drawlibSource() + '\n```',
  '## Example 1: Persian Carpet (frame, full color, square, kept middles)\n\n```js\n' + read('examples/persian-carpet.js') + '\n```',
  '## Example 2: Renaissance Moresque (frame, one ink with carved lines, portrait, deeper foot)\n\n```js\n' + read('examples/renaissance-moresque.js') + '\n```',
].join('\n\n');

const DrawInput = z.object({ program: z.string().min(20), notes: z.string().default('') });
const ReviseInput = z.object({ edits: z.array(z.object({ old_str: z.string().min(1), new_str: z.string() })).min(1), notes: z.string().default('') });
const CloseupInput = z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() });
const FinishInput = z.object({ summary: z.string(), colorRule: z.string().default(''), uncertain: z.string().default('') });

const fn = (name: string, description: string, parameters: object): Tool => ({ type: 'function', function: { name, description, parameters } });

const TOOLS: Tool[] = [
  fn('draw', 'Run a complete drawing program in the sandbox and render it. Returns the original beside the drawing, the seam check and fit check (when the layout repeats), the palette check, symmetry, warnings and any error.', {
    type: 'object',
    properties: {
      program: { type: 'string', description: 'The whole program: JavaScript defining draw() that returns { svg, palette, layout }.' },
      notes: { type: 'string', description: 'One or two sentences for the user: what this version draws or changes.' },
    },
    required: ['program', 'notes'],
  }),
  fn('revise', 'Change the current program by exact search-and-replace edits (each old_str must occur exactly once, applied in order), then run and render it like draw.', {
    type: 'object',
    properties: {
      edits: { type: 'array', items: { type: 'object', properties: { old_str: { type: 'string' }, new_str: { type: 'string' } }, required: ['old_str', 'new_str'] } },
      notes: { type: 'string', description: 'One or two sentences for the user: what this changes.' },
    },
    required: ['edits', 'notes'],
  }),
  fn('closeup', 'Show one region of the original and of the current drawing side by side, enlarged. The region is in the drawing\'s design units; the same share of the original is shown.', {
    type: 'object',
    properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } },
    required: ['x', 'y', 'w', 'h'],
  }),
  fn('finish', 'End the work: the last program that rendered without error is the result.', {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'What the drawing shows and how it follows the original, in two to four sentences.' },
      colorRule: { type: 'string', description: 'The color rule followed and why, in a sentence.' },
      uncertain: { type: 'string', description: 'Anything you are unsure of, or "".' },
    },
    required: ['summary', 'colorRule', 'uncertain'],
  }),
];

/** What a tool call returns: text for the model, and any images (sent next, in a user message). */
interface ToolOut { text: string; images?: { caption: string; jpeg: Buffer }[] }

export interface DrawContext {
  run: Run;
  runDir: string;
  designDir: string;
  analysis: any;
  cropPng: string;
  emit: (e: RunEvent) => void;
  save: () => void;
  signal: AbortSignal;
}

export interface Drawing {
  program: string;
  svg: string;
  palette: PaletteColor[];
  layout: Layout | null;
  summary: string;
  colorRule: string;
  uncertain: string;
}

class Canceled extends Error {}

/** The task: the original, a detail at full resolution, and what the reading and the measurements say. */
async function firstMessage(ctx: DrawContext): Promise<Message> {
  const { run, analysis, cropPng } = ctx;
  const r: Reading = run.reading;
  const meta = await sharp(cropPng).metadata();
  const W = meta.width!, H = meta.height!;
  const content: Part[] = [textPart('The original (cropped to the design):'), imagePart(await forModel(fs.readFileSync(cropPng)))];
  if (Math.max(W, H) > 1900) {
    // a detail at the scan's own resolution: the top-left corner and the start of the edges
    const side = Math.round(Math.min(W, H) * 0.42);
    const detail = await sharp(cropPng).extract({ left: 0, top: 0, width: Math.min(W, side * 1.4 | 0), height: Math.min(H, side) }).png().toBuffer();
    content.push(textPart('A detail of the top left at the scan\'s full resolution:'), imagePart(await forModel(detail, 1400)));
  }
  const bb = analysis?.bbox as number[] | undefined;
  const frac = (v: number, of: number) => +(v / of).toFixed(3);
  const measured: Record<string, unknown> = { aspect: +(W / H).toFixed(4), pixels: [W, H] };
  if (bb && analysis?.window) measured.window = { x: frac(analysis.window[0], bb[2]), y: frac(analysis.window[1], bb[3]), w: frac(analysis.window[2], bb[2]), h: frac(analysis.window[3], bb[3]), note: 'as shares of the design\'s width and height' };
  if (bb && analysis?.bands) measured.bandDepths = Object.fromEntries(Object.entries(analysis.bands).map(([k, v]) => [k, frac(v as number, k === 'top' || k === 'bottom' ? bb[3] : bb[2])]));
  if (bb && analysis?.repeats) measured.repeats = Object.fromEntries(Object.entries(analysis.repeats).map(([k, v]: [string, any]) => [k, { periodShare: frac(v.period, k === 'x' ? bb[2] : bb[3]), unitsAlong: v.count, strength: v.strength }]));
  if (analysis?.symmetry) measured.symmetry = analysis.symmetry;
  if (analysis?.palette) measured.measuredColors = analysis.palette.map((p: any) => `${p.hex} ${p.name} (${Math.round(p.share * 100)}%)`);
  const form = ({ frame: 'frame', border: 'border', corner: 'corner', pattern: 'tile' } as Record<string, string>)[r.kind] ?? 'whole';
  const text = [
    `Redraw this design as new vector art: a ${r.kind}, ${r.rendering === 'shaded' ? 'in shaded relief' : 'flat'}.`,
    `The reading, confirmed by the user:\n${JSON.stringify({ kind: r.kind, rendering: r.rendering, colorMode: r.colorMode, colorReason: r.colorReason, material: r.material, carvedLines: r.carvedLines, symmetry: r.symmetry, repeats: r.repeats, palette: r.palette, structure: r.structure, motifs: r.motifs, style: r.style, leaveOut: r.leaveOut, plan: r.plan }, null, 1)}`,
    `Measured on the scan (rough; trust your eyes where they disagree):\n${JSON.stringify(measured)}`,
    `Color rule: ${r.colorMode === 'neutral' ? `neutral base: draw in grays only (the original's color stands for ${r.material || 'a material'})${r.rendering === 'shaded' ? ', up to 12 grays for the relief' : ''}.` : r.colorMode === 'full' ? 'full color: keep the original\'s palette (at most eight flat colors).' : `one ink${r.carvedLines ? ', with the carved lines in their own color (Ivory #f3e8cf)' : ''}.`}`,
    `Return layout.form '${form}'. Make the canvas the design's aspect ratio (${(W / H).toFixed(3)}), about 1200–1800 units on the long side.`,
    run.options.note ? `The user adds: ${run.options.note}` : '',
    `You have ${run.options.maxRenders} renders. Plan briefly, then call draw.`,
  ].filter(Boolean).join('\n\n');
  content.push(textPart(text));
  return { role: 'user', content };
}

export async function reillustrate(ctx: DrawContext): Promise<Drawing> {
  const { run, emit, signal } = ctx;
  const maxRenders = run.options.maxRenders;
  const messages: Message[] = [{ role: 'system', content: SYSTEM }, await firstMessage(ctx)];
  let best: { program: string; svg: string; palette: PaletteColor[]; layout: Layout | null } | null = null;
  let attempted = '';      // the last program tried, rendered or not: revise edits it
  let renders = 0, attempts = 0, nudged = false, overLimit = 0;
  let finished: z.infer<typeof FinishInput> | null = null;

  emit({ type: 'status', status: 'running', stage: 'plan', message: 'Studying the original' });

  for (let turn = 0; turn < maxRenders * 3 + 8 && !finished; turn++) {
    if (signal.aborted) throw new Canceled('canceled');
    const res = await chat({
      messages,
      tools: TOOLS,
      maxTokens: 48000,
      effort: run.options.effort as Effort,
      signal,
      onProgress: (p) => emit({ type: 'progress', message: p.toolInput ? `Writing ${p.tool === 'revise' ? 'changes' : 'the program'} (${(p.toolInput / 1024).toFixed(1)} KB)` : p.text ? 'Writing' : `Thinking (about ${Math.round(p.reasoning / 6).toLocaleString('en-US')} words)` }),
    }).catch((e) => { throw signal.aborted ? new Canceled('canceled') : e; });
    addUsage(run.usage, res.usage);
    emit({ type: 'usage', usage: run.usage });
    messages.push(asHistory(res.message));   // appended unchanged
    if (res.finishReason === 'content_filter') throw new Error('The model declined to continue this drawing.');
    if (res.message.content?.trim()) emit({ type: 'note', text: res.message.content.trim() });
    const calls = res.message.tool_calls ?? [];
    if (!calls.length) {
      if (nudged) break;
      nudged = true;
      messages.push({ role: 'user', content: best ? 'Continue: call revise or draw to improve it, or finish if it meets the bar.' : 'Continue: call draw with your program.' });
      continue;
    }
    const images: Part[] = [];
    for (const c of calls) {
      let out: ToolOut;
      if (res.finishReason === 'length') out = { text: 'Error: your message was cut off at the token limit, so this call was not run. Send a shorter program, or change it in parts with revise.' };
      else {
        let input: unknown;
        try { input = JSON.parse(c.function.arguments || '{}'); } catch { input = undefined; }
        out = input === undefined ? { text: `Error: the arguments to ${c.function.name} were not valid JSON. Call it again with a JSON object.` } : await runTool(c.function.name, input);
      }
      messages.push({ role: 'tool', tool_call_id: c.id, content: out.text });
      for (const im of out.images ?? []) images.push(textPart(im.caption), imagePart(im.jpeg));
    }
    // images go in a user message after the results, which every compatible API accepts
    if (images.length) messages.push({ role: 'user', content: [textPart('The images for the results above, in order:'), ...images] });
    if (overLimit >= 2) break;
  }

  // (set inside runTool and renderStep, which TypeScript can't see from here)
  const result = best as { program: string; svg: string; palette: PaletteColor[]; layout: Layout | null } | null;
  const done = finished as z.infer<typeof FinishInput> | null;
  if (!result) throw new Error('No drawing rendered without error.');
  return { ...result, summary: done?.summary ?? 'Stopped after the last render.', colorRule: done?.colorRule ?? '', uncertain: done?.uncertain ?? '' };

  async function runTool(name: string, input: unknown): Promise<ToolOut> {
    const err = (text: string): ToolOut => ({ text: `Error: ${text}` });
    if (name === 'draw' || name === 'revise') {
      if (renders >= maxRenders) { overLimit++; return err('No renders left. Call finish now.'); }
      if (++attempts > maxRenders * 2 + 4) return err('Too many failed attempts. Call finish now with the best drawing so far.');
      let program: string, notes: string;
      if (name === 'draw') {
        const p = DrawInput.safeParse(input);
        if (!p.success) return err(`The input did not match the tool's schema (${p.error.issues[0]?.message}). Send the whole program as a string in "program".`);
        ({ program, notes } = p.data);
      } else {
        const p = ReviseInput.safeParse(input);
        if (!p.success) return err(`The input did not match the tool's schema (${p.error.issues[0]?.message}).`);
        if (!attempted) return err('There is no program yet: use draw.');
        program = attempted;
        for (const [i, e] of p.data.edits.entries()) {
          const n = program.split(e.old_str).length - 1;
          if (n !== 1) return err(`Edit ${i + 1}: old_str occurs ${n} times in the current program; it must occur exactly once. No edits were applied.`);
          program = program.replace(e.old_str, () => e.new_str);
        }
        notes = p.data.notes;
      }
      attempted = program;
      return renderStep(program, notes);
    }
    if (name === 'closeup') {
      const p = CloseupInput.safeParse(input);
      if (!p.success) return err('closeup takes { x, y, w, h } in design units.');
      if (!best) return err('Nothing has rendered yet.');
      const { x, y, w, h } = p.data;
      const c = await closeup(ctx.cropPng, best.svg, [x, y, w, h]);
      return { text: 'The close-up is the next image.', images: [{ caption: `Close-up, left: the original; right: your drawing. Region ${Math.round(x)},${Math.round(y)} ${Math.round(w)}×${Math.round(h)} units, shown at ${c.scale.toFixed(2)}× (the original's region is ${c.originalPixels.join('×')} scan pixels).`, jpeg: await forModel(c.image) }] };
    }
    if (name === 'finish') {
      const p = FinishInput.safeParse(input);
      if (!p.success) return err('finish takes { summary, colorRule, uncertain }.');
      if (!best) return err('Nothing has rendered without error yet: draw first.');
      finished = p.data;
      return { text: 'Finished. The drawing is being turned into layers.' };
    }
    return err(`There is no tool named ${name}.`);
  }

  async function renderStep(program: string, notes: string): Promise<ToolOut> {
    const n = run.iterations.length + 1;
    const dir = path.join(ctx.runDir, `iter-${String(n).padStart(2, '0')}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'program.js'), program);
    emit({ type: 'status', status: 'running', stage: 'draw', message: `Running drawing ${n}` });
    const iteration: Iteration = { n, at: new Date().toISOString(), ok: false, notes, files: { program: rel(path.join(dir, 'program.js')) } };
    const fail = (error: string): ToolOut => {
      iteration.error = error;
      run.iterations.push(iteration);
      emit({ type: 'iteration', iteration });
      ctx.save();
      return { text: `Error: the program did not render (this did not use up a render):\n${error}` };
    };
    const out = await runProgram(program);
    if (!out.ok) return fail(out.error);
    const svg = out.output.svg;
    const check = checkSvg(svg);
    if (!check.ok) return fail(check.errors.join('\n'));
    renders++;
    emit({ type: 'status', status: 'running', stage: 'critique', message: `Checking drawing ${n}` });
    const palette = normalizePalette(out.output.palette, check.colors);
    const size: [number, number] = [check.width, check.height];
    const layout = normalizeLayout(out.output.layout, size);
    fs.writeFileSync(path.join(dir, 'drawing.svg'), svg);
    const png = await render(svg, { long: 1400 });
    fs.writeFileSync(path.join(dir, 'render.png'), png);
    const cmp = await compare(ctx.cropPng, png);
    fs.writeFileSync(path.join(dir, 'compare.png'), cmp);
    iteration.files.render = rel(path.join(dir, 'render.png'));
    iteration.files.compare = rel(path.join(dir, 'compare.png'));
    iteration.files.drawing = rel(path.join(dir, 'drawing.svg'));
    const images: { caption: string; jpeg: Buffer }[] = [{ caption: `Render ${renders}, image 1: the original (left) beside your drawing (right).`, jpeg: await forModel(cmp) }];
    const warnings: string[] = [];
    try {
      const u = await unitCheck(svg, layout);
      if (u) {
        fs.writeFileSync(path.join(dir, 'unitcheck.png'), u);
        iteration.files.unitcheck = rel(path.join(dir, 'unitcheck.png'));
        images.push({ caption: `Render ${renders}, image ${images.length + 1}: the seam check, each repeating unit tiled three times (side unit downward, top unit across${layout?.form === 'tile' ? '; the tile 3 × 3' : ''}).`, jpeg: await forModel(u) });
      }
      const fc = await fitCheck(svg, layout);
      if (fc) {
        fs.writeFileSync(path.join(dir, 'fitcheck.png'), fc);
        iteration.files.fitcheck = rel(path.join(dir, 'fitcheck.png'));
        images.push({ caption: `Render ${renders}, image ${images.length + 1}: the fit check, ${layout?.form === 'frame' ? 'the frame fitted to a wide page and a tall one' : 'the border at two lengths'} by the fitting algorithm.`, jpeg: await forModel(fc) });
      }
    } catch (e) {
      warnings.push(`The seam or fit check could not be drawn: ${(e as Error).message}. Check the layout values.`);
    }
    const off = await offPalette(svg, palette);
    const sym = await symmetry(png);
    const unused = check.colors.filter((c) => !palette.some((p) => p.hex === c));
    if (off.share > 0.004) warnings.push(`${(off.share * 100).toFixed(1)}% of flat areas are colors outside the palette (${off.colors.join(', ')}): remove opacity, masks or blends, or add the color to the palette.`);
    if (unused.length) warnings.push(`Colors in the SVG but not in the palette: ${unused.slice(0, 8).join(', ')}.`);
    if (run.reading.colorMode === 'neutral' && palette.some((p) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(p.hex.slice(i, i + 2), 16)); return Math.max(r, g, b) - Math.min(r, g, b) > 6; })) warnings.push('The color rule is a neutral base, but the palette has hues: use grays only.');
    if (palette.length > 14) warnings.push(`The palette has ${palette.length} colors: use fewer flat colors (each becomes a layer).`);
    warnings.push(...layoutWarnings(layout, size, run.reading));
    if ((run.reading.symmetry === 'four-way' || run.reading.symmetry === 'mirror-x') && sym.lr < 0.97) warnings.push(`Left–right symmetry is ${sym.lr}: the reading says the design is mirrored. Draw half and mirror it.`);
    if (run.reading.symmetry === 'four-way' && sym.tb < 0.97) warnings.push(`Top–bottom symmetry is ${sym.tb}: the reading says four-way. Mirror a quarter (unless the foot is deliberately deeper).`);
    const checks: Checks = { size, palette, offPalette: +off.share.toFixed(4), symmetry: sym, warnings };
    iteration.ok = true;
    iteration.checks = checks;
    fs.writeFileSync(path.join(dir, 'checks.json'), JSON.stringify({ ...checks, layout, logs: out.output.logs }, null, 1));
    run.iterations.push(iteration);
    best = { program, svg, palette, layout };
    emit({ type: 'iteration', iteration });
    ctx.save();
    const left = maxRenders - renders;
    const text = [
      `Render ${renders} of ${maxRenders} (${left} left)${left === 0 ? ': this was the last one; call finish now' : ''}. Ran in ${out.ms} ms; SVG ${(svg.length / 1024).toFixed(0)} KB, ${size[0]} × ${size[1]} units.`,
      `Palette (${palette.length}): ${palette.map((p) => `${p.name} ${p.hex}`).join(', ')}.`,
      `Layout: ${JSON.stringify(layout)}.`,
      `Symmetry: left–right ${sym.lr}, top–bottom ${sym.tb}.`,
      warnings.length ? `Warnings:\n- ${warnings.join('\n- ')}` : 'No warnings.',
      out.output.logs.length ? `console.log:\n${out.output.logs.join('\n')}` : '',
      `${images.length} image${images.length === 1 ? '' : 's'} follow: ${images.map((im) => im.caption).join(' ')}`,
    ].filter(Boolean).join('\n');
    return { text, images };
  }
}

export function isCanceled(e: unknown) {
  return e instanceof Canceled || (e instanceof Error && e.name === 'AbortError');
}

function normalizeLayout(raw: unknown, size: [number, number]): Layout | null {
  if (!raw || typeof raw !== 'object') return { form: 'whole', size };
  const l = raw as any;
  const pair = (v: any): [number, number] | undefined => (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && isFinite(n)) ? [v[0], v[1]] : undefined);
  const form = ['frame', 'border', 'corner', 'tile', 'whole'].includes(l.form) ? l.form : 'whole';
  const out: Layout = { form, size };
  if (form === 'frame') {
    out.slice = typeof l.slice === 'number' ? l.slice : pair(l.slice) ?? Math.round(Math.min(...size) / 6);
    const kx = pair(l.keep?.x), ky = pair(l.keep?.y);
    if (kx || ky) out.keep = { ...(kx && { x: kx }), ...(ky && { y: ky }) };
  }
  const rx = pair(l.repeat?.x), ry = pair(l.repeat?.y);
  if (rx || ry) out.repeat = { ...(rx && { x: rx }), ...(ry && { y: ry }) };
  if (form === 'corner') out.corner = l.corner ?? 'top-left';
  if (form === 'tile') out.lattice = ['grid', 'half-drop', 'brick'].includes(l.lattice) ? l.lattice : 'grid';
  return out;
}

function layoutWarnings(l: Layout | null, [W, H]: [number, number], reading: Reading): string[] {
  const w: string[] = [];
  if (!l) return w;
  const expect = ({ frame: 'frame', border: 'border', corner: 'corner', pattern: 'tile' } as Record<string, string>)[reading.kind] ?? 'whole';
  if (l.form !== expect) w.push(`layout.form is '${l.form}' but this ${reading.kind} needs '${expect}'.`);
  const inside = (r: [number, number] | undefined, L: number, name: string) => {
    if (r && !(r[0] >= 0 && r[1] <= L && r[1] > r[0])) w.push(`${name} [${r}] is not a range inside 0–${L}.`);
  };
  inside(l.repeat?.x, W, 'repeat.x');
  inside(l.repeat?.y, H, 'repeat.y');
  if (l.form === 'frame') {
    const [sx, sy] = Array.isArray(l.slice) ? l.slice : [l.slice!, l.slice!];
    for (const [axis, L, s] of [['x', W, sx], ['y', H, sy]] as const) {
      const k = l.keep?.[axis], r = l.repeat?.[axis];
      if (k && Math.abs((k[0] + k[1]) / 2 - L / 2) > 0.5) w.push(`keep.${axis} [${k}] is not centered on ${L / 2}.`);
      if (r && r[0] < s - 0.5) w.push(`repeat.${axis} starts at ${r[0]}, inside the corner (slice ${s}): the unit must start after the corner.`);
      if (r && k && r[1] > k[0] + 0.5) w.push(`repeat.${axis} ends at ${r[1]}, past the kept middle's start ${k[0]}: the unit must lie in the first half, before the keep.`);
    }
    if (!l.repeat && reading.repeats.axis !== 'none') w.push('The reading says the edges repeat, but layout has no repeat: give repeat.x and repeat.y.');
  }
  if (l.form === 'border' && !l.repeat?.x) w.push('A border needs repeat.x: the unit that repeats along it.');
  return w;
}
