import { useEffect, useRef, useState } from "react";
import { CELL, MINERALS, N, idx, type Terrain } from "@/lib/terrain";
import { LIMITS, isBlocked } from "@/lib/nav";

export type Layer = "optical" | "slope" | "mineral" | "thermal" | "sky";
export type Overlays = { los: boolean; hazard: boolean; shelters: boolean; contours: boolean };
const PX = 8; // canvas px per cell
const S = N * PX;

// Canvas data-visualisation ramps (not UI chrome).
const lerp = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
function ramp(stops: number[][], t: number) {
  t = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t));
  return lerp(stops[i], stops[i + 1], t - i);
}
const MARS = [[70, 38, 28], [140, 78, 50], [196, 130, 86], [226, 190, 150]];
const SLOPE = [[40, 120, 90], [200, 190, 70], [230, 110, 40], [190, 30, 50]];
const TI = [[40, 50, 110], [70, 120, 170], [210, 150, 70], [250, 220, 150]];
const SKY = [[20, 30, 60], [60, 110, 150], [230, 220, 190]];
const MIN_C = [[0, 0, 0], [240, 225, 120], [70, 200, 170], [190, 60, 110]];

function hillshade(t: Terrain, x: number, y: number) {
  const e = (xx: number, yy: number) => t.elev[idx(Math.min(N - 1, Math.max(0, xx)), Math.min(N - 1, Math.max(0, yy)))];
  const dx = (e(x + 1, y) - e(x - 1, y)) / (2 * CELL), dy = (e(x, y + 1) - e(x, y - 1)) / (2 * CELL);
  const sh = (-dx * 0.7 - dy * 0.7 + 0.6) / Math.sqrt(1 + dx * dx + dy * dy);
  return Math.min(1.25, Math.max(0.35, 0.55 + sh));
}

function renderBase(t: Terrain, layer: Layer, ov: Overlays) {
  const c = document.createElement("canvas"); c.width = S; c.height = S;
  const g = c.getContext("2d")!;
  const img = g.createImageData(N, N);
  let mn = Infinity, mx = -Infinity; for (const v of t.elev) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = idx(x, y), hs = hillshade(t, x, y);
    let col: number[];
    if (layer === "optical") col = ramp(MARS, (t.elev[i] - mn) / (mx - mn)).map((v) => v * hs);
    else if (layer === "slope") col = isBlocked(t, i) ? [120, 20, 90] : ramp(SLOPE, t.slope[i] / LIMITS.bedrockSlope).map((v) => v * (0.75 + 0.25 * hs));
    else if (layer === "thermal") col = ramp(TI, (t.ti[i] - 60) / 520).map((v) => v * (0.8 + 0.2 * hs));
    else if (layer === "sky") col = ramp(SKY, (t.sky[i] - 0.35) / 0.65).map((v) => v * (0.85 + 0.15 * hs));
    else { const m = t.mineral[i]; const base = 70 * hs; col = m ? lerp([base, base, base], MIN_C[m], 0.85) : [base, base * 0.92, base * 0.85]; }
    if (ov.los && !t.los[i]) col = lerp(col, [160, 30, 40], 0.35);
    img.data.set([col[0], col[1], col[2], 255], i * 4);
  }
  const tmp = document.createElement("canvas"); tmp.width = N; tmp.height = N; tmp.getContext("2d")!.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true; g.drawImage(tmp, 0, 0, S, S);
  if (ov.contours) {
    g.strokeStyle = "rgba(255,240,220,0.18)"; g.lineWidth = 1;
    for (let y = 0; y < N - 1; y++) for (let x = 0; x < N - 1; x++) {
      const a = Math.floor(t.elev[idx(x, y)] / 10), b = Math.floor(t.elev[idx(x + 1, y)] / 10), d = Math.floor(t.elev[idx(x, y + 1)] / 10);
      if (a !== b) { g.beginPath(); g.moveTo((x + 1) * PX, y * PX); g.lineTo((x + 1) * PX, (y + 1) * PX); g.stroke(); }
      if (a !== d) { g.beginPath(); g.moveTo(x * PX, (y + 1) * PX); g.lineTo((x + 1) * PX, (y + 1) * PX); g.stroke(); }
    }
  }
  if (ov.hazard) {
    g.strokeStyle = "rgba(255,60,80,0.75)"; g.lineWidth = 1.2;
    for (let i = 0; i < N * N; i++) if (isBlocked(t, i)) {
      const x = (i % N) * PX, y = Math.floor(i / N) * PX;
      g.beginPath(); g.moveTo(x + 1, y + 1); g.lineTo(x + PX - 1, y + PX - 1); g.moveTo(x + PX - 1, y + 1); g.lineTo(x + 1, y + PX - 1); g.stroke();
    }
  }
  if (ov.shelters) {
    g.fillStyle = "rgba(120,220,255,0.55)";
    for (let i = 0; i < N * N; i++) if (t.sky[i] < 0.62 && !isBlocked(t, i)) { g.beginPath(); g.arc((i % N) * PX + PX / 2, Math.floor(i / N) * PX + PX / 2, 2.2, 0, 7); g.fill(); }
  }
  return c;
}

export type MapProps = {
  terrain: Terrain; layer: Layer; overlays: Overlays; tilt?: boolean; compact?: boolean;
  route: number[]; altRoute?: number[]; returnRoute?: number[]; evac?: boolean;
  waypoints: number[]; pos?: [number, number] | null; trail?: number[];
  onCellClick?: (cell: number) => void; onWaypointClick?: (k: number) => void;
};

export function cellToLatLon(cell: number) {
  const x = cell % N, y = Math.floor(cell / N), mPerDeg = 59274;
  return { lat: -4.6 - ((y - N / 2) * CELL) / mPerDeg, lon: 137.4 + ((x - N / 2) * CELL) / mPerDeg };
}

export function TacticalMap(p: MapProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [base, setBase] = useState<HTMLCanvasElement | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const t = p.terrain;

  useEffect(() => { setBase(renderBase(t, p.layer, p.overlays)); }, [t, p.layer, p.overlays]);

  useEffect(() => {
    const c = ref.current; if (!c || !base) return;
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, S, S); g.drawImage(base, 0, 0);
    const ctr = (i: number): [number, number] => [(i % N) * PX + PX / 2, Math.floor(i / N) * PX + PX / 2];
    const line = (cells: number[], color: string, w: number, dash: number[] = []) => {
      if (cells.length < 2) return;
      g.save(); g.strokeStyle = color; g.lineWidth = w; g.setLineDash(dash); g.lineJoin = "round"; g.lineCap = "round";
      g.beginPath(); cells.forEach((c, k) => { const [x, y] = ctr(c); k ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); g.restore();
    };
    if (p.returnRoute) line(p.returnRoute, "rgba(255,210,80,0.9)", 2, [4, 4]);
    line(p.route, "rgba(0,0,0,0.55)", 6);
    line(p.route, p.evac ? "rgba(255,70,90,1)" : "rgba(120,240,255,1)", 3);
    if (p.trail) line(p.trail, "rgba(255,255,255,0.85)", 2);
    p.waypoints.forEach((w, k) => {
      const [x, y] = ctr(w);
      g.fillStyle = "rgba(20,14,12,0.9)"; g.strokeStyle = "rgba(255,170,80,1)"; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x, y - 9); g.lineTo(x + 8, y); g.lineTo(x, y + 9); g.lineTo(x - 8, y); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = "rgba(255,200,140,1)"; g.font = "bold 10px JetBrains Mono"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(k + 1), x, y + 0.5);
    });
    const [hx, hy] = ctr(idx(t.habitat[0], t.habitat[1]));
    g.fillStyle = "rgba(120,240,200,1)"; g.fillRect(hx - 7, hy - 7, 14, 14); g.fillStyle = "rgba(10,20,20,1)"; g.font = "bold 10px JetBrains Mono"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("H", hx, hy + 0.5);
    if (p.pos) {
      const x = p.pos[0] * PX + PX / 2, y = p.pos[1] * PX + PX / 2;
      g.fillStyle = "rgba(255,255,255,0.25)"; g.beginPath(); g.arc(x, y, 14, 0, 7); g.fill();
      g.fillStyle = "rgba(255,255,255,1)"; g.strokeStyle = "rgba(0,0,0,0.8)"; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); g.stroke();
    }
    if (hover != null && !p.compact) { const x = (hover % N) * PX, y = Math.floor(hover / N) * PX; g.strokeStyle = "rgba(255,255,255,0.9)"; g.lineWidth = 1; g.strokeRect(x, y, PX, PX); }
  }, [base, p.route, p.altRoute, p.returnRoute, p.waypoints, p.pos, p.trail, p.evac, hover, t, p.compact]);

  const toCell = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * N), y = Math.floor(((e.clientY - r.top) / r.height) * N);
    return x >= 0 && y >= 0 && x < N && y < N ? idx(x, y) : null;
  };
  const click = (e: React.MouseEvent) => {
    const c = toCell(e); if (c == null) return;
    const k = p.waypoints.findIndex((w) => Math.abs((w % N) - (c % N)) <= 1 && Math.abs(Math.floor(w / N) - Math.floor(c / N)) <= 1);
    if (k >= 0 && p.onWaypointClick) p.onWaypointClick(k); else p.onCellClick?.(c);
  };
  const h = hover != null ? hover : null;
  const ll = h != null ? cellToLatLon(h) : null;

  return (
    <div className="relative">
      <div className={p.tilt ? "[perspective:1400px]" : ""}>
        <canvas
          ref={ref} width={S} height={S}
          className={`block aspect-square w-full rounded-md transition-transform duration-700 ${p.compact ? "" : "cursor-crosshair"} ${p.tilt ? "[transform:rotateX(38deg)_scale(0.92)] shadow-2xl" : ""}`}
          onClick={p.tilt ? undefined : click}
          onMouseMove={(e) => !p.compact && !p.tilt && setHover(toCell(e))}
          onMouseLeave={() => setHover(null)}
          aria-label="Tactical terrain map. Click to add a waypoint."
        />
      </div>
      {!p.compact && h != null && ll && (
        <div className="pointer-events-none absolute left-2 top-2 rounded-md border border-border bg-background/85 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed backdrop-blur">
          <div>{ll.lat.toFixed(4)}°, {ll.lon.toFixed(4)}°E · {t.elev[h].toFixed(0)} m</div>
          <div>slope {t.slope[h].toFixed(1)}° · TI {t.ti[h].toFixed(0)} · sky {t.sky[h].toFixed(2)}</div>
          <div>{MINERALS[t.mineral[h]]} · UHF {t.los[h] ? "LoS" : "NO LoS"}{isBlocked(t, h) && <span className="text-destructive"> · LOCKOUT</span>}</div>
        </div>
      )}
      {!p.compact && (
        <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-background/80 px-2 py-1 font-mono text-[10px] text-muted-foreground">
          ▬ 200 m · grid {CELL} m/cell · N↑
        </div>
      )}
    </div>
  );
}
