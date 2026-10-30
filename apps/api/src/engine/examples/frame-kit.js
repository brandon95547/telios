// Example 3: a frame built with frameKit (the shortest way to an app-ready frame). A square master, one
// ink and gold, a vine band along every edge, a rosette in each corner and a medallion kept in the middle
// of the head and the foot. frameKit makes the layout and cuts every part at its box, so what is drawn
// here is what an app fits to any page. Rules and the vine lie wholly inside their boxes, and the vine is
// a function of its own box, so units meet without a seam.
const C = { ink: '#1d1a17', gold: '#c9a45c', cream: '#f4ead9' };
const N = 1800;                      // the master: a square
const S = 220;                       // each corner's box, and the depth of the head, the foot and the sides
const sw = (w, c = C.ink) => `fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;

// One unit of a horizontal band, in a len × depth box: an outer and an inner rule, and a vine between
// them whose leaves and berries lie on a grid that divides len (so it ends where it begins), each
// short enough to stay inside the unit: a shape that crosses the box's end would be cut there.
function band(len, depth) {
  const mid = depth / 2;
  let s = `<rect x="0" y="10" width="${f(len)}" height="14" fill="${C.ink}"/><rect x="0" y="${depth - 24}" width="${f(len)}" height="14" fill="${C.ink}"/>`;
  s += `<rect x="0" y="${depth - 56}" width="${f(len)}" height="8" fill="${C.gold}"/>`;
  // drawn a little past both ends, so the box cuts it where it carries on: the unit begins where it ends
  const pts = Array.from({ length: 37 }, (_, i) => { const t = (i - 2) / 32; return [t * len, mid + 0.22 * depth * Math.sin(t * Math.PI * 2)]; });
  s += `<path d="${smooth(pts)}" ${sw(8)}/>`;
  for (const q of [0.25, 0.75]) {
    const [x, y] = [q * len, mid + 0.22 * depth * Math.sin(q * Math.PI * 2)];
    s += place(`<path d="${petal(depth * 0.2, depth * 0.08)}" fill="${C.gold}" stroke="${C.ink}" stroke-width="5"/>`, x, y, q < 0.5 ? -50 : 50);
  }
  return s + circle(0.5 * len, mid, 13, { fill: C.cream, stroke: C.ink, 'stroke-width': 5 });
}
// the same band down a side: its length runs down, its outer rule at the left
const vertical = (len, depth) => `<g transform="matrix(0 1 1 0 0 0)">${band(len, depth)}</g>`;

function rosette(r) {
  let s = '';
  for (let i = 0; i < 8; i++) s += `<path d="${petal(r, r * 0.32)}" transform="rotate(${i * 45})" fill="${i % 2 ? C.cream : C.gold}" stroke="${C.ink}" stroke-width="6"/>`;
  return s + `<circle r="${f(r * 0.28)}" fill="${C.ink}"/>`;
}
const medallion = (w, h) => `${ellipse(w / 2, h / 2, w * 0.42, h * 0.34, { fill: C.cream, stroke: C.ink, 'stroke-width': 8 })}${ellipse(w / 2, h / 2, w * 0.34, h * 0.24, { fill: 'none', stroke: C.gold, 'stroke-width': 8 })}${place(rosette(h * 0.2), w / 2, h / 2)}`;

function draw() {
  const kit = frameKit({
    size: [N, N], slice: [S, S],
    // the corner: the bands' rules turn the corner, a rosette sits in the corner square
    corner: () => `<rect x="10" y="10" width="${S - 10}" height="14" fill="${C.ink}"/><rect x="10" y="10" width="14" height="${S - 10}" fill="${C.ink}"/>`
      + `<rect x="${S - 24}" y="${S - 24}" width="24" height="14" fill="${C.ink}"/>${rosette(S * 0.34).replace(/^/, `<g transform="translate(${S * 0.5} ${S * 0.5})">`)}</g>`,
    edgeX: { len: 150, draw: (len) => band(len, S) },
    edgeY: { len: 150, draw: (len) => vertical(len, S) },
    keepX: { w: 380, top: () => `<rect x="0" y="10" width="380" height="14" fill="${C.ink}"/>${medallion(380, S)}` },
    keepY: { h: 200, draw: () => `<rect x="10" y="0" width="14" height="200" fill="${C.ink}"/>` + place(rosette(70), 112, 100) },
  });
  return { svg: svgDoc(N, N, kit.body, kit.defs), palette: { Ink: C.ink, Gold: C.gold, Cream: C.cream }, layout: kit.layout };
}
