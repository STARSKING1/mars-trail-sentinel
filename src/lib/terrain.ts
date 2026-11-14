// Synthetic, calibrated terrain model of the Mount Sharp boxwork unit / Gediz Vallis margin.
// NOT mission data: elevations, thermal inertia and mineral classes are procedurally generated
// to match published value ranges (HiRISE DTM relief, THEMIS TI, CRISM detections).
export const N = 96; // grid cells per side
export const CELL = 20; // metres per cell
export const SEED = 4137;

export type Terrain = {
  elev: Float32Array; // m (MOLA datum)
  slope: Float32Array; // degrees
  ti: Float32Array; // thermal inertia, J m^-2 K^-1 s^-1/2
  mineral: Uint8Array; // 0 none, 1 hydrated sulfate, 2 phyllosilicate, 3 hematite
  sky: Float32Array; // sky-view factor 0..1 (1 = fully exposed)
  los: Uint8Array; // 1 = UHF line-of-sight to habitat relay
  habitat: [number, number];
};

export const MINERALS = ["—", "Hydrated sulfate", "Phyllosilicate", "Hematite"] as const;
export const idx = (x: number, y: number) => y * N + x;

function hash(x: number, y: number, s: number) {
  let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
function vnoise(x: number, y: number, s: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number, s: number) {
  let t = 0, amp = 0.5, f = 1;
  for (let o = 0; o < 4; o++) { t += amp * vnoise(x * f, y * f, s + o); amp *= 0.5; f *= 2; }
  return t;
}
const smooth = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

export function channelCenter(y: number) { return 66 + 9 * Math.sin(y / 13); }

export function generateTerrain(): Terrain {
  const elev = new Float32Array(N * N), slope = new Float32Array(N * N), ti = new Float32Array(N * N);
  const mineral = new Uint8Array(N * N), sky = new Float32Array(N * N), los = new Uint8Array(N * N);
  const ridgeMap = new Float32Array(N * N), chanMap = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const n = fbm(x / 18, y / 18, SEED);
    let e = -4180 + ((x + y) / (2 * N)) * 210 + n * 35;
    // Scarp (layered sulfate cliff) running diagonally — shelters at its base
    const sd = (y - (52 - x * 0.35 + 6 * Math.sin(x / 9)));
    e += 38 * smooth(-1.2, 1.2, sd);
    // Gediz Vallis channel
    const cd = (x - channelCenter(y)) / 4.5;
    const ch = Math.exp(-cd * cd) * smooth(10, 40, y);
    e -= 28 * ch;
    // Boxwork ridges (mineral-filled fractures), western upper bench
    const w = fbm(x / 7, y / 7, SEED + 9);
    const r1 = 1 - Math.min(1, Math.abs(Math.sin(x * 0.55 + w * 4)) * 4);
    const r2 = 1 - Math.min(1, Math.abs(Math.sin(y * 0.5 - w * 4)) * 4);
    const zone = smooth(54, 64, y) * (1 - smooth(46, 56, x));
    const ridge = Math.max(r1, r2) * zone;
    e += ridge * 5;
    elev[idx(x, y)] = e; ridgeMap[idx(x, y)] = ridge; chanMap[idx(x, y)] = ch;
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const xl = Math.max(0, x - 1), xr = Math.min(N - 1, x + 1), yu = Math.max(0, y - 1), yd = Math.min(N - 1, y + 1);
    const gx = (elev[idx(xr, y)] - elev[idx(xl, y)]) / ((xr - xl) * CELL);
    const gy = (elev[idx(x, yd)] - elev[idx(x, yu)]) / ((yd - yu) * CELL);
    const s = (Math.atan(Math.hypot(gx, gy)) * 180) / Math.PI;
    slope[idx(x, y)] = s;
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = idx(x, y), n = fbm(x / 6, y / 6, SEED + 21);
    let t = 170 + 160 * n + 260 * ridgeMap[i] + (slope[i] > 11 ? 180 : 0);
    if (chanMap[i] > 0.35 && n < 0.62) t = 85 + 60 * n; // dust/sand traps on channel floor
    if (n < 0.3) t = Math.min(t, 120 + 60 * n); // aeolian dust patches
    ti[i] = Math.min(650, Math.max(60, t));
    const e = elev[i];
    if (ridgeMap[i] > 0.45) mineral[i] = 3;
    else if (e > -4040 && hash(x >> 1, y >> 1, SEED + 3) > 0.45) mineral[i] = 1;
    else if (chanMap[i] > 0.12 && chanMap[i] < 0.5 && hash(x >> 1, y >> 1, SEED + 5) > 0.5) mineral[i] = 2;
  }
  // Sky-view factor from 16-azimuth horizon scan
  const dirs = Array.from({ length: 16 }, (_, k) => [Math.cos((k * Math.PI) / 8), Math.sin((k * Math.PI) / 8)]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const e0 = elev[idx(x, y)];
    let occ = 0;
    for (const [dx, dy] of dirs) {
      let maxA = 0;
      for (let r = 1; r <= 14; r++) {
        const xx = Math.round(x + dx * r), yy = Math.round(y + dy * r);
        if (xx < 0 || yy < 0 || xx >= N || yy >= N) break;
        const a = Math.atan2(elev[idx(xx, yy)] - e0, r * CELL);
        if (a > maxA) maxA = a;
      }
      occ += Math.sin(maxA) ** 2 * 2.2;
    }
    sky[idx(x, y)] = Math.max(0.35, Math.min(1, 1 - occ / 16));
  }
  const habitat: [number, number] = [10, 12];
  const hx = habitat[0], hy = habitat[1], he = elev[idx(hx, hy)] + 12; // 12 m relay mast
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const te = elev[idx(x, y)] + 2; // suit antenna
    const steps = Math.max(Math.abs(x - hx), Math.abs(y - hy));
    let ok = 1;
    for (let k = 1; k < steps; k++) {
      const f = k / steps;
      const xx = Math.round(hx + (x - hx) * f), yy = Math.round(hy + (y - hy) * f);
      if (elev[idx(xx, yy)] > he + (te - he) * f) { ok = 0; break; }
    }
    los[idx(x, y)] = ok;
  }
  return { elev, slope, ti, mineral, sky, los, habitat };
}
