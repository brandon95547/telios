// Telios' drawing library. Every drawing program runs with these functions already defined (in a
// sandbox with nothing else: no require, no files, no network). A program defines draw(), which
// returns { svg, palette, layout }. Coordinates are design units; +y runs down; angles in degrees
// unless noted. Every shape is drawn as new vector art: nothing is traced from the original.

const __logs = [];
const console = { log: (...a) => { if (__logs.length < 50) __logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); } };
let __uid = 0;

// ── Numbers and points ──

/** A number rounded to 2 decimals, for compact SVG. */
const f = (n) => +Number(n).toFixed(2);
/** "x,y" for a point [x, y]. */
const pt = ([x, y]) => `${f(x)},${f(y)}`;
/** A fresh id for a clipPath or symbol: uid('band') → 'band-1'. Ids are stable from run to run. */
const uid = (name = 'id') => `${name}-${++__uid}`;
const lerp = (a, b, t) => a + (b - a) * t;
const rad = (deg) => (deg * Math.PI) / 180;
/** The point at angle `deg` and distance r from [cx, cy]. */
const polar = (cx, cy, r, deg) => [cx + r * Math.cos(rad(deg)), cy + r * Math.sin(rad(deg))];

// ── Curves ──

/** A smooth curve through points (Catmull-Rom as cubic Béziers); `closed` joins the ends. Returns path data. */
function smooth(pts, closed = false) {
  const n = pts.length;
  let d = `M${pt(pts[0])}`;
  const at = (i) => (closed ? pts[(i + n) % n] : pts[Math.min(Math.max(i, 0), n - 1)]);
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${pt(c1)} ${pt(c2)} ${pt(p2)}`;
  }
  return d + (closed ? 'Z' : '');
}

/** Straight segments through points. Returns path data. */
const poly = (pts, closed = false) => `M${pts.map(pt).join('L')}${closed ? 'Z' : ''}`;

/** A pointed petal or leaf along +x from `from` to `len`, `wid` its half-width; `belly` (0–1) where it is widest. Path data. */
const petal = (len, wid, from = 0, belly = 0.38) => {
  const m = from + (len - from) * belly;
  return `M${f(from)},0C${f(m)},${f(-wid * 1.3)} ${f(from + (len - from) * 0.8)},${f(-wid * 0.55)} ${f(len)},0`
    + `C${f(from + (len - from) * 0.8)},${f(wid * 0.55)} ${f(m)},${f(wid * 1.3)} ${f(from)},0Z`;
};
/** A round-tipped lobe along +x. Path data. */
const lobe = (len, wid, from = 0) =>
  `M${f(from)},0C${f(from)},${f(-wid)} ${f(len)},${f(-wid * 1.25)} ${f(len)},0C${f(len)},${f(wid * 1.25)} ${f(from)},${f(wid)} ${f(from)},0Z`;

/** Points along a logarithmic spiral from `start` coiling into `center`: `turn` radians (sign = direction), shrinking to `endR` of the starting radius. The basis of scrolls, volutes and tendrils. */
function spiral(start, center, turn, endR = 0.22, n = 48) {
  const R0 = Math.hypot(start[0] - center[0], start[1] - center[1]);
  const a0 = Math.atan2(start[1] - center[1], start[0] - center[0]);
  const k = Math.log(endR);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const r = R0 * Math.exp(k * t);
    const a = a0 + turn * t;
    out.push([center[0] + r * Math.cos(a), center[1] + r * Math.sin(a)]);
  }
  return out;
}

/** A polyline measured along its length: at(t) gives { x, y, deg } at that share (0–1) of it, deg the direction it runs. Attach leaves to stems with it. */
function along(pts) {
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = acc[acc.length - 1];
  const at = (t) => {
    const want = Math.min(Math.max(t, 0), 1) * total;
    let i = 1;
    while (i < acc.length - 1 && acc[i] < want) i++;
    const k = (want - acc[i - 1]) / (acc[i] - acc[i - 1] || 1);
    const [a, b] = [pts[i - 1], pts[i]];
    return { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k, deg: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI };
  };
  at.length_ = total;
  return at;
}

/** Points of a sine wave along +x from 0 to len: amplitude amp, `waves` full waves, n samples. */
const wave = (len, amp, waves = 1, n = 64, phase = 0) =>
  Array.from({ length: n + 1 }, (_, i) => { const x = (len * i) / n; return [x, amp * Math.sin((2 * Math.PI * waves * x) / len + phase)]; });

/** Points round an ellipse (or a circle when ry is left out), starting at angle a0, n samples. */
const ellipsePts = (cx, cy, rx, ry = rx, n = 64, a0 = 0) =>
  Array.from({ length: n }, (_, i) => polar(cx, cy, 1, a0 + (360 * i) / n)).map(([x, y]) => [cx + (x - cx) * rx, cy + (y - cy) * ry]);

/** Path data for an arc from angle a0 to a1 (degrees) on a circle. */
function arc(cx, cy, r, a0, a1) {
  const [x0, y0] = polar(cx, cy, r, a0), [x1, y1] = polar(cx, cy, r, a1);
  const large = Math.abs(a1 - a0) % 360 > 180 ? 1 : 0, sweep = a1 > a0 ? 1 : 0;
  return `M${f(x0)},${f(y0)}A${f(r)},${f(r)} 0 ${large} ${sweep} ${f(x1)},${f(y1)}`;
}

// ── Elements ──

/** Attributes from an object: attrs({ fill: '#000', 'stroke-width': 2 }) → ' fill="#000" stroke-width="2"'. Numbers rounded. */
const attrs = (o = {}) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== false)
  .map(([k, v]) => ` ${k}="${typeof v === 'number' ? f(v) : v}"`).join('');
/** <path d=… {…attrs}/> */
const path = (d, a = {}) => `<path d="${d}"${attrs(a)}/>`;
const circle = (cx, cy, r, a = {}) => `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}"${attrs(a)}/>`;
const ellipse = (cx, cy, rx, ry, a = {}) => `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}"${attrs(a)}/>`;
const rect = (x, y, w, h, a = {}) => `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}"${attrs(a)}/>`;
/** A stroked open curve through points: line(pts, '#222', 3). Round caps and joins. */
const line = (pts, color, width, a = {}) => path(smooth(pts), { fill: 'none', stroke: color, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', ...a });

// ── Placing and repeating ──

/** A group with a transform. */
const g = (transform, body) => `<g transform="${transform}">${body}</g>`;
/** `body` drawn at [x, y], turned `rot` degrees and scaled by s (or [sx, sy]). */
const place = (body, x, y, rot = 0, s = 1) => g(`translate(${f(x)} ${f(y)})${rot ? ` rotate(${f(rot)})` : ''}${s !== 1 ? ` scale(${Array.isArray(s) ? s.map(f).join(' ') : f(s)})` : ''}`, body);
/** n copies of `body` turned evenly round the origin (rosettes, wheels). */
const radial = (n, body, offset = 0) => Array.from({ length: n }, (_, i) => g(`rotate(${f(offset + (360 * i) / n)})`, body)).join('');
/** `body` and its mirror image across the vertical line x = W/2. */
const mirrorX = (W, body) => body + g(`matrix(-1 0 0 1 ${f(W)} 0)`, body);
/** `body` and its mirror image across the horizontal line y = H/2. */
const mirrorY = (H, body) => body + g(`matrix(1 0 0 -1 0 ${f(H)})`, body);
/** One quarter (the top-left) mirrored into four: exact symmetry both ways. */
const mirror4 = (W, H, body) => mirrorY(H, mirrorX(W, body));

/** Positions on a grid anchored at `anchor` with steps of `step`, within [lo, hi]: [[pos, index], …]. Anchor it at an edge's middle with a step that divides the repeating unit, so every pattern on the edge repeats with the unit. */
function gridAt(anchor, step, lo, hi) {
  const out = [];
  for (let j = Math.ceil((lo - anchor) / step - 1e-9); anchor + j * step <= hi + 1e-9; j++) out.push([anchor + j * step, j]);
  return out;
}

/** A shape defined once (in <defs>) and placed many times with use(): keeps files small. Returns { def, use(x, y, rot, s) }. */
function symbol(body, name = 'sym') {
  const id = uid(name);
  return { def: `<g id="${id}">${body}</g>`, use: (x = 0, y = 0, rot = 0, s = 1) => place(`<use href="#${id}"/>`, x, y, rot, s) };
}

// ── Bands, rings and clipping (frames) ──

/** The rectangular band between insets a and b of a W × H piece (a < b), filled. */
const ring = (W, H, a, b, fill) =>
  `<path fill-rule="evenodd" fill="${fill}" d="M${f(a)},${f(a)}H${f(W - a)}V${f(H - a)}H${f(a)}Z M${f(b)},${f(b)}H${f(W - b)}V${f(H - b)}H${f(b)}Z"/>`;
/** Like ring, but with its own inset on each side: outer [top, right, bottom, left] and inner the same. */
const ringSides = (W, H, o, i, fill) =>
  `<path fill-rule="evenodd" fill="${fill}" d="M${f(o[3])},${f(o[0])}H${f(W - o[1])}V${f(H - o[2])}H${f(o[3])}Z M${f(i[3])},${f(i[0])}H${f(W - i[1])}V${f(H - i[2])}H${f(i[3])}Z"/>`;
/** A clipPath for the band between insets a and b; returns { def, attr } — put def in <defs>, attr on the group: <g ${c.attr}>…</g>. */
function clipRing(W, H, a, b, name = 'band') {
  const id = uid(name);
  return { def: `<clipPath id="${id}"><path clip-rule="evenodd" d="M${f(a)},${f(a)}H${f(W - a)}V${f(H - a)}H${f(a)}Z M${f(b)},${f(b)}H${f(W - b)}V${f(H - b)}H${f(b)}Z"/></clipPath>`, attr: `clip-path="url(#${id})"` };
}
/** A clipPath from any path data; returns { def, attr }. */
function clipPath(d, name = 'clip') {
  const id = uid(name);
  return { def: `<clipPath id="${id}"><path d="${d}"/></clipPath>`, attr: `clip-path="url(#${id})"` };
}
/** Path data of a rectangle with rounded corners. */
const roundRect = (x, y, w, h, r) => `M${f(x + r)},${f(y)}H${f(x + w - r)}A${f(r)},${f(r)} 0 0 1 ${f(x + w)},${f(y + r)}V${f(y + h - r)}A${f(r)},${f(r)} 0 0 1 ${f(x + w - r)},${f(y + h)}H${f(x + r)}A${f(r)},${f(r)} 0 0 1 ${f(x)},${f(y + h - r)}V${f(y + r)}A${f(r)},${f(r)} 0 0 1 ${f(x + r)},${f(y)}Z`;

// ── Shaded relief in flat grays (neutral base) ──

/**
 * A molding round a W × H piece between insets a and b, lit from the top left: the top and left
 * faces in `light`, the bottom and right in `dark`, mitered at the corners. Stack several with
 * different insets and grays to build a profile (bead, cove, fillet).
 */
function bevel(W, H, a, b, light, dark) {
  const P = (pts, fill) => `<path fill="${fill}" d="${poly(pts, true)}"/>`;
  return P([[a, a], [W - a, a], [W - b, b], [b, b]], light) + P([[a, a], [b, b], [b, H - b], [a, H - a]], light)
    + P([[W - a, a], [W - a, H - a], [W - b, H - b], [W - b, b]], dark) + P([[a, H - a], [b, H - b], [W - b, H - b], [W - a, H - a]], dark);
}
/** A gray ramp: n grays from `dark` to `light` (0–255 levels), returned as hex, darkest first. */
const grays = (n, dark = 28, light = 236) => Array.from({ length: n }, (_, i) => { const v = Math.round(lerp(dark, light, n === 1 ? 0 : i / (n - 1))); const h = v.toString(16).padStart(2, '0'); return `#${h}${h}${h}`; });
/** A color between two hex colors. */
const mix = (a, b, t) => '#' + [1, 3, 5].map((i) => Math.round(lerp(parseInt(a.slice(i, i + 2), 16), parseInt(b.slice(i, i + 2), 16), t)).toString(16).padStart(2, '0')).join('');

// ── A frame put together from parts ──

/**
 * A frame built from parts, with its fitting data made for you, so what you draw is exactly what an
 * app fits to a page: the four corners kept as drawn, each edge filled with whole copies of one unit,
 * and a middle ornament kept whole. You draw each part in its own box (origin at the box's top left);
 * a part is cut off at its box, so draw inside it. Returns { body, defs, layout }:
 *
 *   const { body, defs, layout } = frameKit({
 *     size: [1800, 1800],            // the master: a square
 *     slice: [260, 300],             // each corner's box [across, down]; also the depth of the head and foot rows
 *     corner: () => …,               // the top-left corner, in a 260 × 300 box (the others are its mirror)
 *     edgeX: { len: 120,             // one unit of the top edge, about this long (the kit adjusts it to fit whole units)
 *              draw: (len) => …,     //   in a len × 300 box; the bottom edge is its upside-down copy …
 *              bottom: (len) => … },  //   … unless you give the foot its own drawing, in the same len × 300 box
 *     edgeY: { len: 120, draw: (len) => … },   // one unit of the left side, in a 260 × len box; the right is its mirror
 *     keepX: { w: 400, top: () => …, bottom: () => … },   // optional: an ornament in the middle of the head and the foot, in w × 300 boxes
 *     keepY: { h: 300, draw: () => … },                   // optional: an ornament in the middle of the sides, in a 260 × h box
 *   });
 *   return { svg: svgDoc(W, H, body, defs + yourOwnDefs), palette, layout };
 *
 * The units are drawn at whatever exact length fits (draw receives it), and each must start and end at
 * the same point of its pattern, so that copies meet without a seam. Everything of the frame belongs to a
 * part: what is drawn outside the parts is not part of the frame.
 */
function frameKit(o) {
  const [W, H] = o.size;
  const [sx, sy] = Array.isArray(o.slice) ? o.slice : [o.slice, o.slice];
  if (!o.corner || !o.edgeX || !o.edgeY) throw new Error('frameKit needs corner, edgeX and edgeY.');
  if (2 * sx > W || 2 * sy > H) throw new Error(`frameKit: slice [${sx}, ${sy}] is more than half the canvas ${W} × ${H}.`);
  const defs = [];
  const clips = {};
  const MX = `matrix(-1 0 0 1 ${f(W)} 0)`, MY = `matrix(1 0 0 -1 0 ${f(H)})`, MXY = `matrix(-1 0 0 -1 ${f(W)} ${f(H)})`;
  // one drawing of a part, defined once; put() shows it in its box at (x, y), then mirrors it on the page
  const part = (body, name) => { const id = uid(name); defs.push(`<g id="${id}">${body}</g>`); return id; };
  const put = (id, w, h, x, y, tf = '') => {
    const key = `${f(w)}x${f(h)}`;
    if (!clips[key]) { clips[key] = uid('box'); defs.push(`<clipPath id="${clips[key]}"><rect width="${f(w)}" height="${f(h)}" shape-rendering="crispEdges"/></clipPath>`); }
    return `<g${tf ? ` transform="${tf}"` : ''}><g transform="translate(${f(x)} ${f(y)})"><g clip-path="url(#${clips[key]})"><use href="#${id}"/></g></g></g>`;
  };
  const out = [];
  // corners
  const corner = part(o.corner(), 'corner');
  for (const tf of ['', MX, MY, MXY]) out.push(put(corner, sx, sy, 0, 0, tf));
  // head and foot: whole units either side of a kept middle (the right half mirrors the left)
  const kx = o.keepX ? o.keepX.w : 0, ky = o.keepY ? o.keepY.h : 0;
  const roomX = o.keepX ? (W - kx) / 2 - sx : W - 2 * sx;
  const nx = Math.max(1, Math.round(roomX / o.edgeX.len)), Lx = roomX / nx;
  const top = part(o.edgeX.draw(Lx), 'unitx');
  const foot = o.edgeX.bottom ? part(o.edgeX.bottom(Lx), 'footx') : null;
  const keepTop = o.keepX ? part(o.keepX.top(), 'keeptop') : null;
  const keepFoot = o.keepX ? (o.keepX.bottom ? part(o.keepX.bottom(), 'keepfoot') : null) : null;
  for (let i = 0; i < nx; i++) {
    const x = sx + i * Lx;
    out.push(put(top, Lx, sy, x, 0));
    out.push(foot ? put(foot, Lx, sy, x, H - sy) : put(top, Lx, sy, x, 0, MY));
    if (o.keepX) {
      out.push(put(top, Lx, sy, x, 0, MX));
      out.push(foot ? put(foot, Lx, sy, x, H - sy, MX) : put(top, Lx, sy, x, 0, MXY));
    }
  }
  if (o.keepX) {
    out.push(put(keepTop, kx, sy, (W - kx) / 2, 0));
    out.push(keepFoot ? put(keepFoot, kx, sy, (W - kx) / 2, H - sy) : put(keepTop, kx, sy, (W - kx) / 2, 0, MY));
  }
  // the sides: whole units either side of a kept middle (the lower half mirrors the upper)
  const roomY = o.keepY ? (H - ky) / 2 - sy : H - 2 * sy;
  const ny = Math.max(1, Math.round(roomY / o.edgeY.len)), Ly = roomY / ny;
  const side = part(o.edgeY.draw(Ly), 'unity');
  for (let j = 0; j < ny; j++) {
    const y = sy + j * Ly;
    out.push(put(side, sx, Ly, 0, y), put(side, sx, Ly, 0, y, MX));
    if (o.keepY) out.push(put(side, sx, Ly, 0, y, MY), put(side, sx, Ly, 0, y, MXY));
  }
  if (o.keepY) {
    const keepSide = part(o.keepY.draw(), 'keepside');
    out.push(put(keepSide, sx, ky, 0, (H - ky) / 2), put(keepSide, sx, ky, 0, (H - ky) / 2, MX));
  }
  const layout = { form: 'frame', size: [W, H], slice: [sx, sy], repeat: { x: [f(sx), f(sx + Lx)], y: [f(sy), f(sy + Ly)] } };
  if (kx || ky) layout.keep = { ...(kx ? { x: [f((W - kx) / 2), f((W + kx) / 2)] } : {}), ...(ky ? { y: [f((H - ky) / 2), f((H + ky) / 2)] } : {}) };
  return { body: out.join(''), defs: defs.join(''), layout };
}

// ── The document ──

/** A complete SVG document W × H with optional <defs>. Return its text as draw()'s `svg`. */
const svgDoc = (w, h, body, defs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${f(w)}" height="${f(h)}" viewBox="0 0 ${f(w)} ${f(h)}">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`;
