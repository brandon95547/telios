// Example 1: a frame in full color, built to repeat. New drawing after the border of a Persian
// carpet (Collinot & de Beaumont, Ornements de la Perse, pl. 35). The original guided the layout
// only: a yellow guard band outside, a cream field where a scrolling vine runs from a great flower
// at each corner to one in the middle of each side, an inner guard round the window.
//
// Built to repeat: every edge is a corner, a run of identical units, and a kept middle. One unit
// (P) is one bay of the vine, from the middle of one bay to the middle of the next; the band
// motifs are laid on a grid anchored at each edge's middle whose steps divide P, so a unit
// starts and ends at the same point of every pattern. One quarter is drawn and mirrored into four.
// Full color: the colors are part of the art (a carpet's dyes), so the palette is kept.
const C = { cream: '#f4ead9', yellow: '#efc13c', red: '#cf472c', navy: '#1e2a5a', teal: '#9ccabd', white: '#fcf8ef' };

const N = 1500;                                    // front and back: a square, fitted to any page
const MID = 117;                                   // the front's field center line (field 34 to 200)
const HF = 83;                                     // half the front's field
const P = (N / 2 - MID) / 2;                       // a bay and the repeating unit: 316.5
const D = P / 6, DI = P / 8, Z = P / 36;           // the band motifs' steps: outer, inner, zigzag
const UNIT = [MID + P / 2, MID + 1.5 * P];         // the unit on every edge of front and back

const sw = (w) => `stroke="${C.navy}" stroke-width="${w}" stroke-linejoin="round"`;

// ── Flowers and leaves, each centered on its origin (a leaf's base), pointing along +x ──
function greatFlower(r) {
  let s = '';
  for (let i = 0; i < 16; i++) s += `<path d="${petal(r, r * 0.17)}" transform="rotate(${i * 22.5 + 11.25})" fill="${C.yellow}" ${sw(1.4)}/>`;
  for (let i = 0; i < 8; i++) {
    s += `<path d="${petal(r * 0.9, r * 0.3, r * 0.2)}" transform="rotate(${i * 45})" fill="${C.red}" ${sw(1.6)}/>`;
    s += `<path d="${petal(r * 0.62, r * 0.075, r * 0.3)}" transform="rotate(${i * 45})" fill="${C.teal}"/>`;
  }
  for (let i = 0; i < 8; i++) s += `<path d="${lobe(r * 0.42, r * 0.17, r * 0.12)}" transform="rotate(${i * 45 + 22.5})" fill="${C.teal}" ${sw(1.3)}/>`;
  s += `<circle r="${f(r * 0.26)}" fill="${C.navy}"/>`;
  for (let i = 0; i < 8; i++) s += `<path d="${lobe(r * 0.2, r * 0.07, r * 0.06)}" transform="rotate(${i * 45})" fill="${C.white}"/>`;
  return s + `<circle r="${f(r * 0.075)}" fill="${C.red}"/>`;
}
function rosette(r) {
  let s = '';
  for (let i = 0; i < 8; i++) s += `<path d="${lobe(r, r * 0.34, r * 0.2)}" transform="rotate(${i * 45})" fill="${C.navy}"/>`;
  return s + `<circle r="${f(r * 0.42)}" fill="${C.white}" ${sw(1.2)}/><circle r="${f(r * 0.2)}" fill="${C.red}"/>`;
}
function blossom(r) {                               // a small red flower at a coil's end
  let s = '';
  for (let i = 0; i < 6; i++) s += `<path d="${lobe(r, r * 0.42, r * 0.15)}" transform="rotate(${i * 60})" fill="${C.red}" ${sw(1.2)}/>`;
  for (let i = 0; i < 6; i++) s += `<path d="${petal(r * 0.62, r * 0.1, r * 0.2)}" transform="rotate(${i * 60})" fill="${C.teal}"/>`;
  return s + `<circle r="${f(r * 0.3)}" fill="${C.yellow}" ${sw(1.1)}/><circle r="${f(r * 0.12)}" fill="${C.navy}"/>`;
}
// A serrated leaf in teal, its vein in navy.
function leaf(len, wid, teeth = 5) {
  const top = [], bot = [];
  for (let i = 0; i <= teeth * 2; i++) {
    const t = i / (teeth * 2);
    const w = wid * Math.pow(Math.sin(Math.PI * Math.min(t * 1.08, 1)), 0.9) * (i % 2 ? 1.18 : 0.86);
    top.push([t * len, -w]);
    bot.push([t * len, w * 0.92]);
  }
  return `<path d="${smooth([...top, ...bot.reverse().slice(1, -1)], true)}" fill="${C.teal}" ${sw(1.2)}/>`
    + `<path d="M${f(len * 0.06)},0Q${f(len * 0.5)},${f(-wid * 0.15)} ${f(len * 0.88)},0" fill="none" ${sw(1)}/>`;
}
const redLeaf = (len, wid) => `<path d="${petal(len, wid)}" fill="${C.red}" ${sw(1.1)}/>`;
// A tulip bud on its calyx.
const bud = (s) => `<path d="${petal(9 * s, 2.8 * s, 1 * s)}" transform="rotate(-26)" fill="${C.red}" ${sw(1)}/>`
  + `<path d="${petal(9 * s, 2.8 * s, 1 * s)}" transform="rotate(26)" fill="${C.red}" ${sw(1)}/>`
  + `<path d="${lobe(11 * s, 3.8 * s, 1 * s)}" fill="${C.red}" ${sw(1)}/>`
  + `<path d="${lobe(4.5 * s, 3.6 * s, -1.5 * s)}" fill="${C.teal}" ${sw(1)}/>`;

// ── One bay of the vine: from a flower at x = 0 to the next at x = len, +y toward the page
// edge. The main stem waves once; a tendril leaves it on each slope and coils into the hollow
// beside it round a flower; leaves, buds and small curls grow from the stems. The bay is the
// same turned half round about its middle, and every bay is the same: that is what repeats. ──
const curl = (curve, t, side, r, turn = 1.3 * Math.PI) => {
  const p = curve(t);
  const n = ((p.deg + side * 90) * Math.PI) / 180;
  return spiral([p.x, p.y], [p.x + r * Math.cos(n), p.y + r * Math.sin(n)], side * turn, 0.38, 28);
};
const on = (curve, t, side, off, body) => { const p = curve(t); return place(body, p.x, p.y, p.deg + side * off); };
const endOf = (pts, body, back = 2) => { const a = pts[pts.length - 1 - back], b = pts[pts.length - 1]; return place(body, b[0], b[1], (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI); };

function bay(len) {
  const A = HF * 0.46;
  const stem = [];
  for (let i = 0; i <= 80; i++) { const x = (len * i) / 80; stem.push([x, A * Math.sin((2 * Math.PI * x) / len)]); }
  const c1 = [len * 0.26, -HF * 0.36];
  const s1 = spiral([len * 0.4, A * Math.sin(2 * Math.PI * 0.4)], c1, -1.62 * Math.PI, 0.3, 60);
  const S = along(stem), T1 = along(s1);
  const stems = [stem, s1, curl(S, 0.24, 1, 16), curl(T1, 0.3, 1, 13, 1.2 * Math.PI)];
  const halfLeaves = on(S, 0.36, 1, 50, leaf(len * 0.15, 9)) + on(T1, 0.14, 1, 55, leaf(len * 0.13, 8, 4))
    + on(T1, 0.47, 1, 28, redLeaf(len * 0.09, 6)) + on(T1, 0.62, 1, 34, leaf(len * 0.09, 6, 3))
    + endOf(stems[2], bud(1.8)) + endOf(stems[3], bud(1.5));
  const turned = (pts) => pts.map((p) => [len - p[0], -p[1]]);
  const all = [...stems, ...stems.slice(1).map(turned)];
  const strokes = (color, wMain, wOther) => all.map((pts, i) => `<path d="${smooth(pts)}" fill="none" stroke="${color}" stroke-width="${i === 0 ? wMain : i % 4 === 1 || i === 4 ? wOther : wOther * 0.75}" stroke-linecap="round"/>`).join('');
  return {
    outline: strokes(C.navy, 12.5, 9.5),
    core: strokes(C.white, 6.8, 5),
    leaves: halfLeaves + g(`rotate(180 ${f(len / 2)} 0)`, halfLeaves),
    flowers: place(blossom(HF * 0.42), ...c1) + place(rosette(HF * 0.36), len - c1[0], -c1[1]),
  };
}
// Bays placed by transforms, their stems under their leaves under their flowers.
function vine(at) {
  const parts = { outline: '', core: '', leaves: '', flowers: '' };
  for (const t of at) { const b = bay(P); for (const k of Object.keys(parts)) parts[k] += g(t, b[k]); }
  return parts;
}
const down = (x, y) => `matrix(0 1 -1 0 ${f(x)} ${f(y)})`;     // a bay running down, its edge to the left
const across = (x, y) => `matrix(1 0 0 -1 ${f(x)} ${f(y)})`;   // a bay running right, its edge above

// ── The bands. Their motifs sit on a grid anchored at each edge's middle (`ax` along the top
// and bottom, `ay` down the sides), so they repeat with the vine. ──
const cloud = `<path fill="${C.navy}" d="M-12,0C-9,-7 -3,-8.5 0,-5.5C3,-8.5 9,-7 12,0C9,7 3,8.5 0,5.5C-3,8.5 -9,7 -12,0Z"/><ellipse rx="4" ry="2" fill="${C.white}"/>`;
const sprig = `<path d="${petal(8, 3, -8)}" fill="${C.red}" ${sw(0.8)}/>`
  + [-60, 60, -120, 120].map((a) => `<path d="${petal(7, 2)}" transform="rotate(${a})" fill="${C.teal}" ${sw(0.7)}/>`).join('');
const quatre = [0, 90, 180, 270].map((r) => `<path d="${lobe(5, 2.6, 0.8)}" transform="rotate(${r + 45})" fill="${C.navy}"/>`).join('') + `<circle r="1.2" fill="${C.yellow}"/>`;
const reddot = `<circle r="1.8" fill="${C.red}"/>`;
function motifs(W, H, a, b, step, pad, pick, ax = W / 2, ay = H / 2) {
  const mid = (a + b) / 2;
  let s = '';
  for (const [x, j] of gridAt(ax, step, b + pad, W - b - pad)) s += place(pick(j), x, mid) + place(pick(j), x, H - mid);
  for (const [y, j] of gridAt(ay, step, b + pad, H - b - pad)) s += place(pick(j), mid, y, 90) + place(pick(j), W - mid, y, 90);
  return s;
}
const corners = (W, H, a, b, body) => [[a, a], [W - b, a], [a, H - b], [W - b, H - b]].map(([x, y]) => place(body, x + (b - a) / 2, y + (b - a) / 2)).join('');
function zigzag(W, H, a, b, ax = W / 2, ay = H / 2) {
  const mid = (a + b) / 2, amp = (b - a) / 2 - 1.6;
  const zig = (anchor, lo, hi) => gridAt(anchor, Z, lo, hi).map(([p, j]) => `${f(p)},${f(j % 2 ? amp : -amp)}`).join(' ');
  const line = (pts, t) => `<polyline points="${pts}" fill="none" stroke="${C.navy}" stroke-width="1.6" stroke-linejoin="miter" transform="${t}"/>`;
  return ring(W, H, a, b, C.white) + line(zig(ax, b, W - b), `translate(0 ${mid})`) + line(zig(ax, b, W - b), `translate(0 ${H - mid})`)
    + line(zig(ay, b, H - b), `matrix(0 1 1 0 ${mid} 0)`) + line(zig(ay, b, H - b), `matrix(0 1 1 0 ${W - mid} 0)`);
}
// The outer guard: red rules either side of a yellow band of clouds and sprigs.
const outer = (W, H, ax, ay) => ring(W, H, 0, 3, C.red) + ring(W, H, 3, 31, C.yellow)
  + motifs(W, H, 3, 31, D, 14, (j) => (j % 2 ? sprig : cloud), ax, ay)
  + corners(W, H, 3, 31, `<rect x="-9" y="-9" width="18" height="18" transform="rotate(45)" fill="${C.navy}"/><circle r="4" fill="${C.red}"/>`)
  + ring(W, H, 31, 34, C.red);
// The inner guard, from `a` to the window: red, teal, yellow with quatrefoils, the zigzag, red.
const inner = (W, H, a) => ring(W, H, a, a + 3, C.red) + ring(W, H, a + 3, a + 8, C.teal) + ring(W, H, a + 8, a + 28, C.yellow)
  + motifs(W, H, a + 8, a + 28, DI, 7, (j) => (j % 2 ? reddot : quatre)) + zigzag(W, H, a + 28, a + 37) + ring(W, H, a + 37, a + 40, C.red);
const clipField = (id, W, H, a, b) => `<clipPath id="${id}"><path clip-rule="evenodd" d="M${a},${a}H${W - a}V${H - a}H${a}Z M${b},${b}H${W - b}V${H - b}H${b}Z"/></clipPath>`;

// ── The drawing: the full border ──
function draw() {
  const v = vine([down(MID, MID), down(MID, MID + P), across(MID, MID), across(MID + P, MID)]);
  v.leaves += place(bud(2.3), MID - 34, MID - 34, -135);                      // from behind the corner flower
  v.flowers += place(greatFlower(64), MID, MID) + place(greatFlower(34), MID, MID + P) + place(greatFlower(34), MID + P, MID);
  const middles = [[MID, N / 2], [N - MID, N / 2], [N / 2, MID], [N / 2, N - MID]].map(([x, y]) => place(greatFlower(60), x, y)).join('');
  const body = outer(N, N) + ring(N, N, 34, 200, C.cream)
    + `<g clip-path="url(#field)">${mirror4(N, N, v.outline + v.core + v.leaves + v.flowers)}${middles}</g>` + inner(N, N, 200);
  return {
    svg: svgDoc(N, N, body, clipField('field', N, N, 34, 200)),
    palette: { Navy: C.navy, Red: C.red, Teal: C.teal, Yellow: C.yellow, Cream: C.cream, White: C.white },
    layout: { form: 'frame', size: [N, N], slice: 240, keep: { x: [N / 2 - 64, N / 2 + 64], y: [N / 2 - 64, N / 2 + 64] }, repeat: { x: UNIT, y: UNIT } },
  };
}

