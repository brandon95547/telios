// Material looks for a neutral grayscale base: each gray is mapped by its lightness onto a
// material's ramp, dark (recessed) to light (raised), as an app using the art would lay a chosen
// material over it.

export const MATERIALS: { id: string; label: string; ramp: [number, string][] }[] = [
  { id: 'gilt', label: 'Gilt', ramp: [[0, '#2b1a05'], [0.35, '#7a5313'], [0.6, '#c39431'], [0.82, '#ebcb6b'], [1, '#fff4c9']] },
  { id: 'silver', label: 'Silver', ramp: [[0, '#1d2126'], [0.4, '#626a73'], [0.7, '#aab2ba'], [1, '#f6f8fa']] },
  { id: 'bronze', label: 'Bronze', ramp: [[0, '#1f1007'], [0.4, '#6b3d1c'], [0.7, '#b07843'], [1, '#f0caa0']] },
  { id: 'wood', label: 'Wood', ramp: [[0, '#21120a'], [0.35, '#5a3418'], [0.65, '#97612f'], [1, '#e2b783']] },
  { id: 'stone', label: 'Stone', ramp: [[0, '#2a2824'], [0.45, '#7b766c'], [0.75, '#b9b3a6'], [1, '#efebe2']] },
];

const toRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb: number[]) => '#' + rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');

/** Perceived lightness, 0 to 1 (CIE L* / 100). */
export function lightnessOf(hex: string): number {
  const lin = toRgb(hex).map((v) => { const c = v / 255; return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92; });
  const y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  return (y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y) / 100;
}

export function materialColor(hex: string, materialId: string): string {
  const m = MATERIALS.find((x) => x.id === materialId);
  if (!m) return hex;
  const t = lightnessOf(hex);
  const r = m.ramp;
  let i = 1;
  while (i < r.length - 1 && r[i][0] < t) i++;
  const [t0, c0] = r[i - 1], [t1, c1] = r[i];
  const k = Math.min(1, Math.max(0, (t - t0) / (t1 - t0 || 1)));
  const a = toRgb(c0), b = toRgb(c1);
  return toHex(a.map((v, j) => v + (b[j] - v) * k));
}
