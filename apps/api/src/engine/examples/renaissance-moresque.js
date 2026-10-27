// Example 2: a frame in one ink with light lines carved out of it, built to repeat. New drawing
// after a 16th-century Dutch page border (Butsch, Die Bücher-Ornamentik der Renaissance, pl.
// XXVI). The original guided the layout only: a black band carrying white-line scrollwork, deeper
// at the foot, between thin rules, round an empty window. Left and right are mirror images.
//
// A portrait piece with a deeper foot: every edge is a corner, a run of identical units, and
// (along the head and the foot) a kept middle. A unit is one oval of the chain, crossing to
// crossing; the head's and the foot's chains cross at the same points, so one unit serves both.
// One ink: the band stays its ink, and the lines cut out of it are their own color (Ivory) and
// layer, so the ink and the lines can be recolored apart.
const INK = '#141210', PAPER = '#f3e8cf';      // the lines: Talari's Ivory
const LINE = 6;                                    // a scroll's white line
const W = 1200, H = 1800;

const cut = (pts, w = LINE) => `<path d="${smooth(pts)}" fill="none" stroke="${PAPER}" stroke-width="${f(w)}" stroke-linecap="round" stroke-linejoin="round"/>`;

// A white leaf with a black vein, base at the origin, along +x.
const leaf = (len, wid) => `<path d="${petal(len, wid)}" fill="${PAPER}"/><path d="M${f(len * 0.12)},0L${f(len * 0.78)},0" stroke="${INK}" stroke-width="${f(Math.max(1.4, wid * 0.22))}" stroke-linecap="round"/>`;
// A split leaf: two lobes and a hooked tip, along +x.
const split = (len, wid) => `<path fill="${PAPER}" d="M0,0C${f(len * 0.2)},${f(-wid * 1.5)} ${f(len * 0.62)},${f(-wid * 1.4)} ${f(len)},${f(-wid * 0.2)}`
  + `C${f(len * 0.66)},${f(-wid * 0.5)} ${f(len * 0.5)},${f(-wid * 0.2)} ${f(len * 0.46)},${f(wid * 0.05)}`
  + `C${f(len * 0.62)},${f(wid * 0.3)} ${f(len * 0.8)},${f(wid * 0.9)} ${f(len * 0.84)},${f(wid * 1.25)}`
  + `C${f(len * 0.5)},${f(wid * 1.2)} ${f(len * 0.2)},${f(wid * 0.9)} 0,0Z"/>`;
// A fleur: a tall middle lobe and two curling side lobes, pointing along -y.
const fleur = (s) => g('rotate(-90)', `<path d="${petal(30 * s, 6 * s)}" fill="${PAPER}"/>`
  + `<path d="${smooth([[2 * s, 0], [10 * s, -6 * s], [19 * s, -14 * s], [22 * s, -22 * s], [16 * s, -24 * s], [14 * s, -18 * s]])}" fill="none" stroke="${PAPER}" stroke-width="${f(4.2 * s)}" stroke-linecap="round"/>`
  + `<path d="${smooth([[2 * s, 0], [10 * s, 6 * s], [19 * s, 14 * s], [22 * s, 22 * s], [16 * s, 24 * s], [14 * s, 18 * s]])}" fill="none" stroke="${PAPER}" stroke-width="${f(4.2 * s)}" stroke-linecap="round"/>`
  + `<circle cx="${f(-3 * s)}" r="${f(4.5 * s)}" fill="${PAPER}"/>`);
const dot = (r) => `<circle r="${f(r)}" fill="${PAPER}"/>`;

// A palmette: five lobes fanned from a cup, white with black veins, pointing along +x.
function palm(s) {
  const lobes = [[-52, 0.38, 0.085], [52, 0.38, 0.085], [-25, 0.52, 0.1], [25, 0.52, 0.1], [0, 0.66, 0.12]];
  let o = '';
  for (const [a, l, w] of lobes) o += g(`rotate(${a})`, `<path d="${petal(l * s, w * s, 0.1 * s, 0.42)}" fill="${PAPER}"/>`);
  for (const [a, l] of lobes) o += g(`rotate(${a})`, `<path d="M${f(0.2 * s)},0L${f(l * s * 0.8)},0" stroke="${INK}" stroke-width="${f(Math.max(1.3, s * 0.018))}" stroke-linecap="round"/>`);
  return o + `<ellipse cx="${f(0.06 * s)}" rx="${f(0.11 * s)}" ry="${f(0.17 * s)}" fill="${PAPER}"/><circle cx="${f(0.06 * s)}" r="${f(0.045 * s)}" fill="${INK}"/>`;
}
// A white line edged in black, so a stem drawn later passes over one drawn before.
const edged = (pts, w = LINE) => `<path d="${smooth(pts)}" fill="none" stroke="${INK}" stroke-width="${f(w + 7)}" stroke-linecap="round"/>` + cut(pts, w);
const bead = (r) => `<circle r="${f(r + 3)}" fill="${INK}"/><circle r="${f(r)}" fill="${PAPER}"/><circle r="${f(r * 0.4)}" fill="${INK}"/>`;

// ── A chain: two stems weaving over and under along +x from 0 to len, across y in [-w, w],
// crossing to make `n` ovals. Each oval holds a palmette pointing along the run; at each
// crossing a bead, and a fleur reaching into the gap toward each edge. Every oval is the same,
// crossing to crossing: that is what repeats. ──
function chain(len, w, { n = Math.max(1, Math.round(len / (2.1 * w))), ends = true, s = 1, palmMax = Infinity } = {}) {
  const L = len / n, a = 0.58 * w, ps = Math.min(L * 0.86, palmMax);
  const s1 = [], s2 = [];
  for (let i = 0; i <= n * 48; i++) { const x = (len * i) / (n * 48), y = a * Math.sin((Math.PI * x) / L); s1.push([x, y]); s2.push([x, -y]); }
  let o = edged(s1, LINE * s) + edged(s2, LINE * s);
  for (let k = 0; k < n; k++) o += place(palm(ps), k * L + (L - ps) / 2 + ps * 0.04, 0);
  for (let k = ends ? 0 : 1; k <= (ends ? n : n - 1); k++) {
    o += place(fleur(w * 0.017), k * L, -w * 0.32, 0) + place(fleur(w * 0.017), k * L, w * 0.32, 180);
    o += cut([[k * L, -w * 0.08], [k * L, -w * 0.34]], LINE * 0.8 * s) + cut([[k * L, w * 0.08], [k * L, w * 0.34]], LINE * 0.8 * s);
    o += place(bead(7 * s), k * L, 0);
  }
  for (let k = 0; k < n; k++) for (const sgn of [-1, 1]) o += place(dot(3.6 * s), k * L + L / 2, sgn * (a + (w - a) * 0.55));
  return o;
}
// The corner knot: a quatrefoil laced through a diamond, a fleur in each lobe.
function knot(r, s = 1) {
  const q = r * 0.42;
  const lobes = `M${f(-q)},${f(-q)}A${f(q)},${f(q)} 0 0 1 ${f(q)},${f(-q)}A${f(q)},${f(q)} 0 0 1 ${f(q)},${f(q)}A${f(q)},${f(q)} 0 0 1 ${f(-q)},${f(q)}A${f(q)},${f(q)} 0 0 1 ${f(-q)},${f(-q)}Z`;
  const d = r * 0.82;
  const diamond = `M0,${f(-d)}L${f(d)},0L0,${f(d)}L${f(-d)},0Z`;
  const ring = (path) => `<path d="${path}" fill="none" stroke="${INK}" stroke-width="${f(LINE * s + 7)}" stroke-linejoin="round"/><path d="${path}" fill="none" stroke="${PAPER}" stroke-width="${f(LINE * s)}" stroke-linejoin="round"/>`;
  let o = ring(diamond) + g('rotate(45)', ring(lobes));
  for (const a of [0, 90, 180, 270]) o += g(`rotate(${a})`, place(fleur(r * 0.0105), 0, -r * 0.2, 0));
  for (const a of [45, 135, 225, 315]) o += g(`rotate(${a})`, place(dot(3.6 * s), 0, -r * 0.7));
  return o + bead(r * 0.1);
}

// A white line with white beads on it, along +x from 0 to len, the beads every 24 from `anchor`.
const pearl = (len, anchor, s = 1) => {
  let o = cut([[0, 0], [len, 0]], 3 * s);
  for (let x = anchor - Math.floor(anchor / 24) * 24; x <= len; x += 24) if (x >= 6 && x <= len - 6) o += place(dot(4.4 * s), x, 0);
  return o;
};
const rules = (w, h, ix, iy, ib) => `<rect x="9" y="9" width="${w - 18}" height="${h - 18}" fill="none" stroke="${INK}" stroke-width="5"/>`
  + (ix ? `<rect x="${ix + 13}" y="${iy + 13}" width="${w - 2 * ix - 26}" height="${ib - iy - 26}" fill="none" stroke="${INK}" stroke-width="5"/>`
    + `<rect x="${ix + 5}" y="${iy + 5}" width="${w - 2 * ix - 10}" height="${ib - iy - 10}" fill="none" stroke="${INK}" stroke-width="2.2"/>` : '');
const bandPath = (w, h, out, ix, iy, ib) => `<path fill-rule="evenodd" fill="${INK}" d="M${out},${out}H${w - out}V${h - out}H${out}Z M${ix},${iy}H${w - ix}V${ib}H${ix}Z"/>`;
const clipped = (id, w, h, out, ix, iy, ib, body) => `<g clip-path="url(#${id})">${body}</g>`;
const clipDef = (id, w, h, out, ix, iy, ib) => `<clipPath id="${id}"><path clip-rule="evenodd" d="M${out + 6},${out + 6}H${w - out - 6}V${h - out - 6}H${out + 6}Z M${ix - 6},${iy - 6}H${w - ix + 6}V${ib + 6}H${ix - 6}Z"/></clipPath>`;
const flipX = (body) => body + g(`matrix(-1 0 0 1 ${W} 0)`, body);

// ── The drawing: the band 150 wide at the sides and the head, 240 deep at the foot ──
const OUT = 22, SIDE = 150, FOOT = 240;
const IX = OUT + SIDE, IY = OUT + SIDE, IB = H - OUT - FOOT;   // the band's inner edges: 172, 172, 1538
const KEEP = 110;                                  // half the middle kept along the head and foot
const LX = (W / 2 - KEEP - IX) / 2;                // an oval along the head and the foot: 159
const LY = (IB - IY) / 10;                         // an oval up a side: 136.6
function draw() {
  const sideCx = OUT + SIDE / 2, headCy = OUT + SIDE / 2, footCy = IB + FOOT / 2;
  const W2 = SIDE / 2 - 13, F2 = FOOT / 2 - 18;
  const side = place(chain(IB - IY, W2, { n: 10 }), sideCx, IB, -90);
  const head = place(chain(2 * LX, W2, { n: 2, palmMax: 1.7 * W2 }) + cut([[2 * LX, 0], [2 * LX + 56, 0]]), IX, headCy);
  const foot = place(chain(2 * LX, F2, { n: 2, s: 1.3 }), IX, footCy);
  const footCorner = (x) => place(knot(62), x, footCy) + place(fleur(1.05), x, footCy - 70, 0) + place(fleur(1.05), x, footCy + 70, 180);
  const ornament = flipX(side + head + foot + place(knot(62), sideCx, headCy) + footCorner(sideCx))
    + place(knot(66), W / 2, headCy) + place(knot(100, 1.3), W / 2, footCy);
  const svg = svgDoc(W, H, bandPath(W, H, OUT, IX, IY, IB) + clipped('band', W, H, OUT, IX, IY, IB, ornament) + rules(W, H, IX, IY, IB), clipDef('band', W, H, OUT, IX, IY, IB));
  return {
    svg,
    palette: { Ink: INK, Lines: PAPER },
    layout: { form: 'frame', size: [W, H], slice: [190, 280], keep: { x: [W / 2 - KEEP, W / 2 + KEEP] }, repeat: { x: [IX + LX, IX + 2 * LX], y: [IB - 6 * LY, IB - 5 * LY] } },
  };
}

