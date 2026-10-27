// Reading a design: what it is, so the user doesn't have to say. The model looks at the image with
// the measurements and returns a structured reading; the user confirms or corrects it in one step.
// Without a model (or if the call fails) the measurements alone fill it in.

import fs from 'node:fs';
import { z } from 'zod';
import { addUsage, chat, emptyUsage, imagePart, provider, textPart } from './llm.ts';
import { forModel } from './render.ts';
import type { Reading, Usage } from '@telios/shared';

const lower = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : v);
const ReadingSchema = z.object({
  kind: z.preprocess(lower, z.enum(['frame', 'border', 'corner', 'ornament', 'pattern', 'initial', 'other'])),
  rendering: z.preprocess(lower, z.enum(['flat', 'shaded'])),
  colorMode: z.preprocess(lower, z.enum(['one-ink', 'neutral', 'full'])),
  colorReason: z.string().catch(''),
  material: z.string().catch(''),
  carvedLines: z.boolean().catch(false),
  symmetry: z.preprocess(lower, z.enum(['none', 'mirror-x', 'mirror-y', 'four-way', 'rotational'])).catch('none'),
  repeats: z.object({
    axis: z.preprocess(lower, z.enum(['none', 'edges', 'x', 'y', 'lattice'])).catch('none'),
    description: z.string().catch(''),
    count: z.number().nullable().catch(null),
  }).catch({ axis: 'none', description: '', count: null }),
  palette: z.array(z.object({ hex: z.string(), name: z.string().catch('') })).catch([]),
  structure: z.string().catch(''),
  motifs: z.string().catch(''),
  style: z.string().catch(''),
  leaveOut: z.string().catch(''),
  plan: z.string().catch(''),
  confidence: z.number().catch(0.5),
});

const SYSTEM = `You read images of existing designs for Telios, an app that redraws them as new vector art (it never traces them). Your reading decides how the design is redrawn, and the user confirms or corrects it, so be accurate and plain.

Decide:
- kind: frame (goes round a page or panel: corners, edges, a window), border (a band or strip that runs along one edge), corner (one corner piece), ornament (a motif drawn whole: rosette, cartouche, vignette, medallion, headpiece), pattern (a surface that repeats in two directions), initial (a decorated letter), other.
- rendering: flat (flat color, line art, woodcut, stencil, flat print) or shaded (shaded relief: carved, cast, molded, embossed, modeled with shading or engraved hatching that models form).
- colorMode, by this rule: "neutral" when the color stands for a material or finish a user would choose (gilding, silver, bronze, carved wood, stone, plaster): it will be drawn in grays. "full" when color is part of the artwork (multicolored flowers, stained glass, painted details, decorative patterns); a piece with both (gilded frame wreathed in painted flowers) is full. "one-ink" when it is printed in one ink (woodcut, engraving, line art); a black-and-white shaded relief (an engraving of a carved frame) is "neutral", since its tones model a material. colorReason: one sentence why. material: for neutral, what it represents (gilding, carved wood…), else "".
- carvedLines: true only when light lines are cut out of a solid dark ink (a white-line woodcut, a stencil band), not for outlined art.
- symmetry of the design itself (ignore the scan's flaws): mirror-x means left and right are mirror images; four-way both ways.
- repeats: what repeats and along what (edges for a frame whose edges repeat, x for a horizontal border, y for a vertical one, lattice for a surface pattern), with about how many units along the longest side.
- palette: the design's distinct flat colors as they should be redrawn (not paper or stains), hex and plain names, darkest first, at most eight. For a neutral base still give the original's colors; the redraw converts them to grays.
- structure: the anatomy in a sentence or two: bands and rules, corners, any middle ornament on an edge, the window, a deeper foot.
- motifs and style (historical style or tradition), briefly.
- leaveOut: anything in the image that is not the design (a scene or text in the window, a caption, a page number, stains); "" if none.
- plan: two to four sentences on how to redraw it as clean new vector art that repeats where it can.
- confidence: 0 to 1.

The measurements come from image processing and can be wrong (they see a scan's noise and paper); trust your eyes where they disagree.

Answer with one JSON object and nothing else, with exactly these keys:
{"kind": "...", "rendering": "...", "colorMode": "...", "colorReason": "...", "material": "...", "carvedLines": false, "symmetry": "...", "repeats": {"axis": "...", "description": "...", "count": null}, "palette": [{"hex": "#rrggbb", "name": "..."}], "structure": "...", "motifs": "...", "style": "...", "leaveOut": "...", "plan": "...", "confidence": 0.0}`;

function summarize(a: any) {
  if (!a) return {};
  const { size, background, bbox, window, windowFill, bands, symmetry, repeats, lattice, palette, flatness, chromaticShare, hueFamilies, carvedLines, guess } = a;
  return { size, background, bbox, window, windowFill, bands, symmetry, repeats, lattice, palette, flatness, chromaticShare, hueFamilies, carvedLines, guess };
}

export async function readDesign(viewPng: string, analysis: any): Promise<{ reading: Reading; usage: Usage; error?: string }> {
  const usage = emptyUsage();
  if (!provider().provider) return { reading: fromAnalysis(analysis), usage };
  try {
    const image = await forModel(fs.readFileSync(viewPng));
    let raw = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await chat({
        maxTokens: 16000,
        effort: 'low',
        json: true,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: [imagePart(image), textPart(`Measurements (pixels of the uploaded image):\n${JSON.stringify(summarize(analysis))}\n\nRead this design. Answer in JSON.`)] },
        ],
      });
      addUsage(usage, res.usage);
      if (res.finishReason === 'content_filter') throw new Error('The model declined to read this image.');
      raw = res.message.content ?? '';
      if (raw.trim()) break;
    }
    const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    const parsed = ReadingSchema.safeParse(json);
    if (!parsed.success) throw new Error(`The reading came back incomplete (${parsed.error.issues[0]?.path.join('.')}: ${parsed.error.issues[0]?.message}).`);
    const r = parsed.data;
    const palette = r.palette.filter((c) => /^#[0-9a-f]{6}$/i.test(c.hex)).slice(0, 8).map((c) => ({ hex: c.hex.toLowerCase(), name: c.name || c.hex }));
    return { reading: { ...r, palette: palette.length ? palette : fromAnalysis(analysis).palette, confidence: Math.max(0, Math.min(1, r.confidence)), source: 'model', confirmed: false }, usage };
  } catch (e) {
    return { reading: fromAnalysis(analysis), usage, error: (e as Error).message };
  }
}

/** A reading from the measurements alone. */
export function fromAnalysis(a: any): Reading {
  const g = a?.guess ?? {};
  const sym = a?.symmetry ?? {};
  // generous: Rebuild measures again, finer, before it averages a design's halves
  const lr = Math.max(sym.lr ?? 0, sym.shapeLr ?? 0, sym.lightLr ?? 0), tb = Math.max(sym.tb ?? 0, sym.shapeTb ?? 0, sym.lightTb ?? 0);
  const symmetry = lr >= 0.7 && tb >= 0.7 ? 'four-way' : lr >= 0.7 ? 'mirror-x' : tb >= 0.7 ? 'mirror-y' : 'none';
  const kind = g.kind ?? 'ornament';
  const rx = a?.repeats?.x, ry = a?.repeats?.y;
  // a weak period is usually texture (hatching, a scan's grain), not a repeating unit
  const strong = (r: any) => r && r.strength >= 0.35;
  const axis = kind === 'frame' && (strong(rx) || strong(ry)) ? 'edges' : kind === 'pattern' ? 'lattice' : strong(rx) ? 'x' : strong(ry) ? 'y' : 'none';
  const along = strong(rx) ? rx : strong(ry) ? ry : null;
  const count = along?.count ?? null;
  const palette = (a?.palette ?? []).slice().sort((p: any, q: any) => p.L - q.L).slice(0, 8).map((p: any) => ({ hex: p.hex, name: p.name }));
  const colorMode = g.colorMode ?? 'full';
  return {
    kind,
    rendering: g.rendering ?? 'flat',
    colorMode,
    colorReason: colorMode === 'neutral' ? 'Measured: grays or one warm hue in shaded tones, so the color stands for a material.' : colorMode === 'one-ink' ? 'Measured: one dark ink on paper.' : 'Measured: several hues, so color is part of the art.',
    material: colorMode === 'neutral' ? 'a material or finish' : '',
    carvedLines: !!a?.carvedLines,
    symmetry,
    repeats: { axis, description: along ? `A repeat of about ${Math.round(along.period)} px measured along ${along === rx ? 'the top' : 'the side'}.` : 'No clear repeat measured.', count: count ? Math.round(count) : null },
    palette,
    structure: a?.bands ? `A band round a window; bands about ${Math.round(a.bands.top)} px deep at the top and ${Math.round(a.bands.left)} px at the sides.` : '',
    motifs: '',
    style: '',
    leaveOut: '',
    plan: '',
    confidence: g.confidence ?? 0.4,
    source: 'measurements',
    confirmed: false,
  };
}
