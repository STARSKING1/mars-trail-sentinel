import { CELL, N, idx, type Terrain } from "./terrain";

export const MARS_G = 3.72;
const EARTH_G = 9.81;
export const LIMITS = { regolithSlope: 15, regolithTI: 150, bedrockSlope: 22 };
export const CAPACITY = { o2: 0.75, batt: 1400, water: 3.6 }; // kg, Wh, kg
export const BASE_DOSE_MSV_PER_DAY = 0.67; // RAD surface average (Hassler et al. 2014)
export const SEP_MULT = 10;

export type Preset = "balanced" | "safety" | "science" | "evac";
const W: Record<Preset, { slope: number; rad: number; los: number; dust: number; sci: number }> = {
  balanced: { slope: 1.2, rad: 0.6, los: 0.6, dust: 0.6, sci: 0.25 },
  safety: { slope: 3.5, rad: 1.5, los: 2.0, dust: 2.0, sci: 0 },
  science: { slope: 0.7, rad: 0.3, los: 0.2, dust: 0.3, sci: 0.6 },
  evac: { slope: 0.8, rad: 6, los: 0.2, dust: 0.8, sci: 0 },
};

export function isBlocked(t: Terrain, i: number) {
  const s = t.slope[i];
  return s > LIMITS.bedrockSlope || (s > LIMITS.regolithSlope && t.ti[i] < LIMITS.regolithTI);
}

function stepCost(t: Terrain, a: number, b: number, dist: number, p: Preset) {
  const w = W[p];
  const s = t.slope[b] / LIMITS.bedrockSlope;
  const c = 1 + w.slope * s * s + w.rad * t.sky[b] + w.los * (t.los[b] ? 0 : 1) + w.dust * (t.ti[b] < LIMITS.regolithTI ? 1 : 0);
  const sci = t.mineral[b] ? w.sci : 0;
  return dist * c * (1 - sci);
}

class Heap { a: [number, number][] = [];
  push(v: [number, number]) { const a = this.a; a.push(v); let i = a.length - 1; while (i) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a, top = a[0], last = a.pop()!; if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
  get size() { return this.a.length; } }

const NB = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];

/** Multi-objective A*. goals: one or more target cells; returns cell index path or null. */
export function astar(t: Terrain, start: number, goals: number[], p: Preset): number[] | null {
  const goalSet = new Set(goals);
  const gs = goals.map((g) => [g % N, Math.floor(g / N)]);
  const h = (i: number) => { const x = i % N, y = Math.floor(i / N); let m = Infinity; for (const [gx, gy] of gs) m = Math.min(m, Math.hypot(gx - x, gy - y)); return m * CELL; };
  const g = new Float64Array(N * N).fill(Infinity), came = new Int32Array(N * N).fill(-1), closed = new Uint8Array(N * N);
  g[start] = 0; const open = new Heap(); open.push([h(start), start]);
  while (open.size) {
    const [, cur] = open.pop();
    if (closed[cur]) continue; closed[cur] = 1;
    if (goalSet.has(cur)) { const path = [cur]; let c = cur; while (came[c] !== -1) { c = came[c]; path.push(c); } return path.reverse(); }
    const cx = cur % N, cy = Math.floor(cur / N);
    for (const [dx, dy] of NB) {
      const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const ni = idx(nx, ny); if (closed[ni] || (isBlocked(t, ni) && !goalSet.has(ni))) continue;
      const d = Math.hypot(dx * CELL, dy * CELL, t.elev[ni] - t.elev[cur]);
      const ng = g[cur] + stepCost(t, cur, ni, d, p);
      if (ng < g[ni]) { g[ni] = ng; came[ni] = cur; open.push([ng + h(ni), ni]); }
    }
  }
  return null;
}

/** Tobler hiking function, derated 30% for pressurised-suit mobility. m/s */
export function walkSpeed(grade: number) { return Math.max(0.25, ((6 * Math.exp(-3.5 * Math.abs(grade + 0.05))) / 3.6) * 0.7); }

/** Pandolf (1977) load-carriage equation with Santee (2001) downhill correction, gravity-scaled to Mars. Watts. */
export function metabolicW(V: number, grade: number, body = 80, load = 55, eta = 1.3) {
  const gr = MARS_G / EARTH_G, Wt = body, L = load, G = grade * 100;
  let M = 1.5 * Wt + 2 * (Wt + L) * (L / Wt) ** 2 * gr + eta * (Wt + L) * gr * (1.5 * V * V + 0.35 * V * Math.max(G, 0));
  if (G < 0) M -= eta * gr * ((G * (Wt + L) * V) / 3.5 - ((Wt + L) * (G + 6) ** 2) / Wt + 25 - V * V) * -0.12;
  return Math.max(130, M + 60); // +60 W suit-joint torque overhead
}

export type Rates = { o2: number; batt: number; water: number; dose: number; met: number; speed: number }; // per second
export function rates(met: number, speed: number, sky: number, sep: boolean): Rates {
  return {
    o2: (met / 20100) * 1.429e-3, // kg/s (20.1 kJ per L O2)
    batt: (90 + 0.12 * met) / 3600, // Wh/s: avionics + fans + pump
    water: (met * 0.75) / 2.26e6, // sublimator kg/s
    dose: ((BASE_DOSE_MSV_PER_DAY * (0.4 + 0.6 * sky)) / 86400) * (sep ? SEP_MULT : 1), // mSv/s
    met, speed,
  };
}

export type Profile = { cells: number[]; t: number[]; d: number[]; o2: number[]; batt: number[]; water: number[]; dose: number[]; met: number[]; total: { time: number; dist: number; o2: number; batt: number; water: number; dose: number; sci: number; noLos: number } };

export function profile(t: Terrain, cells: number[], sep = false): Profile {
  const P: Profile = { cells, t: [0], d: [0], o2: [0], batt: [0], water: [0], dose: [0], met: [0], total: { time: 0, dist: 0, o2: 0, batt: 0, water: 0, dose: 0, sci: 0, noLos: 0 } };
  const seen = new Set<number>();
  for (let k = 1; k < cells.length; k++) {
    const a = cells[k - 1], b = cells[k];
    const hd = Math.hypot((a % N) - (b % N), Math.floor(a / N) - Math.floor(b / N)) * CELL;
    const dz = t.elev[b] - t.elev[a], grade = dz / hd, d = Math.hypot(hd, dz);
    const V = walkSpeed(grade), met = metabolicW(V, grade), dt = d / V, r = rates(met, V, t.sky[b], sep);
    const L = k - 1;
    P.t.push(P.t[L] + dt); P.d.push(P.d[L] + d); P.o2.push(P.o2[L] + r.o2 * dt); P.batt.push(P.batt[L] + r.batt * dt);
    P.water.push(P.water[L] + r.water * dt); P.dose.push(P.dose[L] + r.dose * dt); P.met.push(met);
    if (t.mineral[b] && !seen.has(b)) { seen.add(b); P.total.sci++; }
    if (!t.los[b]) P.total.noLos++;
  }
  const e = cells.length - 1;
  P.total = { ...P.total, time: P.t[e], dist: P.d[e], o2: P.o2[e], batt: P.batt[e], water: P.water[e], dose: P.dose[e] };
  return P;
}

export function planRoute(t: Terrain, stops: number[], p: Preset): { cells: number[]; stopIdx: number[]; failedLeg: number | null } {
  const cells: number[] = [stops[0]], stopIdx = [0];
  for (let k = 1; k < stops.length; k++) {
    const leg = astar(t, stops[k - 1], [stops[k]], p);
    if (!leg) return { cells, stopIdx, failedLeg: k };
    cells.push(...leg.slice(1)); stopIdx.push(cells.length - 1);
  }
  return { cells, stopIdx, failedLeg: null };
}

export type Consumables = { o2: number; batt: number; water: number };
export type PnrStatus = "nominal" | "caution" | "critical";
/** Point-of-no-return: reserve fraction after a reverse path home from `cell`. */
export function pnr(t: Terrain, cell: number, remaining: Consumables, sep: boolean) {
  const home = idx(t.habitat[0], t.habitat[1]);
  const path = astar(t, cell, [home], "safety") ?? astar(t, cell, [home], "balanced");
  if (!path) return { reserve: -1, status: "critical" as PnrStatus, path: [] as number[], need: null };
  const P = profile(t, path, sep);
  const need = { o2: P.total.o2, batt: P.total.batt, water: P.total.water };
  const reserve = Math.min((remaining.o2 - need.o2) / CAPACITY.o2, (remaining.batt - need.batt) / CAPACITY.batt, (remaining.water - need.water) / CAPACITY.water);
  const status: PnrStatus = reserve < 0.15 ? "critical" : reserve < 0.3 ? "caution" : "nominal";
  return { reserve, status, path, need, time: P.total.time };
}

/** Shelter candidates: low sky-view cells (cliff overhang bases) plus the habitat. */
export function shelters(t: Terrain): number[] {
  const out: number[] = [idx(t.habitat[0], t.habitat[1])];
  for (let i = 0; i < N * N; i++) if (t.sky[i] < 0.62 && !isBlocked(t, i)) out.push(i);
  return out;
}

export function evacuate(t: Terrain, from: number) {
  return astar(t, from, shelters(t), "evac");
}
