// Checks a drawing's SVG before anything renders it. The SVG is model output, so it is held to an
// allowlist: plain vector elements only, references only to its own ids. Anything else is refused
// with a message the model can act on, rather than silently stripped.

const ELEMENTS = new Set([
  'svg', 'g', 'defs', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'clippath', 'mask', 'use', 'symbol', 'title', 'desc', 'pattern',
]);
const ADVICE: Record<string, string> = {
  text: 'Draw letters as outlined paths, not <text> (fonts differ from machine to machine).',
  tspan: 'Draw letters as outlined paths, not <text>.',
  lineargradient: 'Gradients are not allowed: draw shading as flat shapes in a few grays (or palette colors), so each color can become its own layer.',
  radialgradient: 'Gradients are not allowed: draw shading as flat shapes in a few grays (or palette colors).',
  filter: 'Filters are not allowed: draw shadows and highlights as flat shapes.',
  image: 'Embedded images are not allowed: everything must be drawn as vectors.',
  style: 'Use attributes (fill, stroke…) instead of a <style> element.',
  script: 'Scripts are not allowed.',
  foreignobject: 'foreignObject is not allowed.',
};

export interface SvgCheck {
  ok: boolean;
  errors: string[];
  width: number;
  height: number;
  colors: string[];
}

export function checkSvg(svg: string): SvgCheck {
  const errors: string[] = [];
  let width = 0, height = 0;
  if (typeof svg !== 'string' || !svg.trim().startsWith('<svg')) {
    return { ok: false, errors: ['draw() must return svg: the complete SVG document text, starting with <svg (use svgDoc(W, H, body, defs)).'], width, height, colors: [] };
  }
  if (svg.length > 30 * 1024 * 1024) errors.push('The SVG is larger than 30 MB. Use <use> for repeated shapes and fewer points per curve.');
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet|<!\[CDATA\[/i.test(svg)) errors.push('No DOCTYPE, entities, CDATA or stylesheets.');
  const seen = new Set<string>();
  for (const m of svg.matchAll(/<([a-zA-Z][\w:.-]*)/g)) {
    const tag = m[1].toLowerCase();
    if (!ELEMENTS.has(tag) && !seen.has(tag)) {
      seen.add(tag);
      errors.push(`<${m[1]}> is not allowed. ${ADVICE[tag] ?? 'Use only svg, g, defs, path, rect, circle, ellipse, line, polyline, polygon, clipPath, mask, use, symbol, pattern.'}`);
    }
  }
  if (/\son[a-z]+\s*=/i.test(svg)) errors.push('Event attributes (onload, onclick…) are not allowed.');
  for (const m of svg.matchAll(/(?:xlink:)?href\s*=\s*["']([^"']*)["']/gi)) {
    if (!m[1].startsWith('#')) { errors.push(`href="${m[1].slice(0, 40)}" points outside the drawing: only #ids of its own elements are allowed.`); break; }
  }
  for (const m of svg.matchAll(/url\(\s*([^)]*)\)/gi)) {
    if (!m[1].replace(/["']/g, '').trim().startsWith('#')) { errors.push(`url(${m[1].slice(0, 40)}) points outside the drawing: only url(#id) is allowed.`); break; }
  }
  if (/javascript:|data:/i.test(svg)) errors.push('javascript: and data: URLs are not allowed.');
  const open = svg.match(/<svg\b[^>]*>/i)?.[0] ?? '';
  const num = (name: string) => parseFloat(open.match(new RegExp(`\\s${name}="([\\d.]+)`))?.[1] ?? 'NaN');
  width = num('width');
  height = num('height');
  const vb = open.match(/viewBox="([^"]+)"/)?.[1]?.split(/[\s,]+/).map(Number);
  if (!(width > 0) && vb) width = vb[2];
  if (!(height > 0) && vb) height = vb[3];
  if (!(width >= 40 && height >= 40 && width <= 8000 && height <= 8000)) errors.push(`The document is ${width} × ${height}: give it a width and height between 40 and 8000 design units (about 1200–1800 on the long side is right).`);
  const colors = [...new Set([...svg.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase()))];
  return { ok: errors.length === 0, errors, width, height, colors };
}

/** The drawing as a standalone file: a title, the xlink namespace if it uses xlink. */
export function finalizeSvg(svg: string, title: string): string {
  let out = svg.trim();
  if (/xlink:href/.test(out) && !/xmlns:xlink=/.test(out)) out = out.replace(/<svg\b/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
  const safe = title.replace(/[<>&"]/g, '');
  if (!/<title>/.test(out)) out = out.replace(/(<svg\b[^>]*>)/, `$1<title>${safe}</title>`);
  return out + '\n';
}
