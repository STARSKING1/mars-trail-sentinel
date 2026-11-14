import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Box, Database, Map as MapIcon, MonitorSmartphone, Pause, Play, RotateCcw, ShieldAlert, Trash2, WifiOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TacticalMap, cellToLatLon, type Layer, type Overlays } from "@/components/ares/TacticalMap";
import { VisorHUD, type Guidance } from "@/components/ares/VisorHUD";
import { Bar, Stat } from "@/components/ares/Gauge";
import { loadTerrain } from "@/lib/idb";
import { CELL, MINERALS, N, idx, type Terrain } from "@/lib/terrain";
import { CAPACITY, LIMITS, SEP_MULT, evacuate, isBlocked, planRoute, pnr, profile, rates, type Preset, type Profile } from "@/lib/nav";
import { cn } from "@/lib/utils";
import sceneBox from "@/assets/rover-pov-boxwork.jpg";
import sceneGediz from "@/assets/rover-pov-gediz.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ARES-NAV — Mars EVA Navigator · Gale Crater" },
      { name: "description", content: "Tactical EVA route planning for Mount Sharp boxwork and Gediz Vallis: slope lockouts, suit consumables, PNR and SEP abort." },
      { property: "og:title", content: "ARES-NAV — Mars EVA Navigator" },
      { property: "og:description", content: "Habitat mission control and astronaut visor HUD for surviving an EVA in Gale Crater." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type Cons = { o2: number; batt: number; water: number; dose: number };
type Active = { prof: Profile; stopIdx: number[]; kind: "plan" | "evac" | "abort" };
type Sample = { t: number; o2: number; batt: number; water: number; dose: number; met: number };

const LAYERS: { id: Layer; label: string; src: string }[] = [
  { id: "optical", label: "Optical / DTM", src: "Synthetic hillshade · HiRISE-scale relief" },
  { id: "slope", label: "Slope", src: "Derived from synthetic DTM" },
  { id: "mineral", label: "Mineralogy", src: "CRISM-style classes (synthetic)" },
  { id: "thermal", label: "Thermal inertia", src: "THEMIS-range TI (synthetic)" },
  { id: "sky", label: "Sky-view shield", src: "Horizon scan of DTM" },
];
const PRESETS: { id: Preset; label: string; hint: string }[] = [
  { id: "balanced", label: "Balanced", hint: "Even trade of effort, exposure and science" },
  { id: "safety", label: "Max Safety", hint: "Avoids slopes, dust, LoS gaps, sky exposure" },
  { id: "science", label: "Max Science", hint: "Routes over mineral detections" },
];
const fmtT = (s: number) => `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
const compass = (deg: number) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(((deg % 360) + 360) % 360 / 45) % 8];

function nearestMineral(t: Terrain, x0: number, y0: number, cls: number) {
  let best = idx(x0, y0), bd = Infinity;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = idx(x, y); if (t.mineral[i] !== cls || isBlocked(t, i)) continue;
    const d = Math.hypot(x - x0, y - y0); if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function Index() {
  const [terrain, setTerrain] = useState<Terrain | null>(null);
  const [source, setSource] = useState<"cache" | "generated" | null>(null);
  const [online, setOnline] = useState(true);
  useEffect(() => {
    loadTerrain().then(({ terrain, source }) => { setTerrain(terrain); setSource(source); });
    const u = () => setOnline(navigator.onLine); u();
    window.addEventListener("online", u); window.addEventListener("offline", u);
    return () => { window.removeEventListener("online", u); window.removeEventListener("offline", u); };
  }, []);
  if (!terrain) return (
    <div className="grid-bg grid min-h-screen place-items-center font-mono text-sm text-muted-foreground">Loading Gale Crater spatial cache…</div>
  );
  return <App terrain={terrain} source={source} online={online} />;
}

function App({ terrain: t, source, online }: { terrain: Terrain; source: string | null; online: boolean }) {
  const home = idx(t.habitat[0], t.habitat[1]);
  const [mode, setMode] = useState<"map" | "visor">("map");
  const [layer, setLayer] = useState<Layer>("optical");
  const [ov, setOv] = useState<Overlays>({ los: false, hazard: true, shelters: false, contours: true });
  const [tilt, setTilt] = useState(false);
  const [preset, setPreset] = useState<Preset>("balanced");
  const [wps, setWps] = useState<number[]>(() => [nearestMineral(t, 22, 70, 3), nearestMineral(t, 36, 78, 1), nearestMineral(t, 58, 60, 2)]);
  const [startPct, setStartPct] = useState(100);
  const [timeScale, setTimeScale] = useState(60);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [sep, setSep] = useState(false);
  const [active, setActive] = useState<Active | null>(null);
  const [s, setS] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [trail, setTrail] = useState<number[]>([]);
  const [hist, setHist] = useState<Sample[]>([]);
  const [selWp, setSelWp] = useState<number | null>(null);
  const startCons = useMemo<Cons>(() => ({ o2: CAPACITY.o2 * startPct / 100, batt: CAPACITY.batt * startPct / 100, water: CAPACITY.water * startPct / 100, dose: 0 }), [startPct]);
  const [cons, setCons] = useState<Cons>(startCons);
  useEffect(() => { if (!started) setCons(startCons); }, [startCons, started]);

  const plan = useMemo(() => {
    const r = planRoute(t, [home, ...wps, home], preset);
    return { ...r, prof: profile(t, r.cells) };
  }, [t, home, wps, preset]);
  const cur: Active = active ?? { prof: plan.prof, stopIdx: plan.stopIdx, kind: "plan" };
  const P = cur.prof;

  // position along active path
  let k = 0; while (k < P.t.length - 2 && P.t[k + 1] <= s) k++;
  const segT = P.t[k + 1] - P.t[k] || 1, f = Math.min(1, Math.max(0, (s - P.t[k]) / segT));
  const a = P.cells[k], b = P.cells[Math.min(k + 1, P.cells.length - 1)];
  const pos: [number, number] = [(a % N) + ((b % N) - (a % N)) * f, Math.floor(a / N) + (Math.floor(b / N) - Math.floor(a / N)) * f];
  const curCell = f > 0.5 ? b : a;
  const met = started ? (P.met[k + 1] ?? 130) : 130;
  const speed = started && running ? segT > 0 ? Math.hypot(P.d[k + 1] - P.d[k]) / segT : 0 : 0;

  const pnrInfo = useMemo(() => pnr(t, curCell, cons, sep), [t, curCell, sep, Math.round(cons.o2 * 200), Math.round(cons.batt / 5), Math.round(cons.water * 20)]);
  const plannedPnr = useMemo(() => {
    // worst reserve across the planned route if executed with chosen starting consumables
    let worst = 1, at = 0;
    for (let i = 0; i < plan.prof.cells.length; i += 6) {
      const rem = { o2: startCons.o2 - plan.prof.o2[i], batt: startCons.batt - plan.prof.batt[i], water: startCons.water - plan.prof.water[i] };
      const r = pnr(t, plan.prof.cells[i], rem, false).reserve;
      if (r < worst) { worst = r; at = i; }
    }
    return { worst, at };
  }, [plan, startCons, t]);

  // simulation loop
  const stateRef = useRef({ s, k, P, sep, timeScale, cur, curCell });
  stateRef.current = { s, k, P, sep, timeScale, cur, curCell };
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const st = stateRef.current, dt = 0.1 * st.timeScale;
      const end = st.P.t[st.P.t.length - 1];
      const r = rates(st.P.met[st.k + 1] ?? 130, 1, t.sky[st.curCell], st.sep);
      setCons((c) => ({ o2: c.o2 - r.o2 * dt, batt: c.batt - r.batt * dt, water: c.water - r.water * dt, dose: c.dose + r.dose * dt }));
      setElapsed((e) => e + dt);
      setTrail((tr) => (tr[tr.length - 1] === st.curCell ? tr : [...tr, st.curCell]));
      const ns = st.s + dt;
      setS(Math.min(ns, end));
      if (ns >= end) {
        setRunning(false);
        toast.success(st.cur.kind === "evac" ? "Shelter reached. Hold until SEP subsides." : "EVA complete — crew back at habitat.");
      }
    }, 100);
    return () => clearInterval(id);
  }, [running, t]);
  useEffect(() => {
    if (!started) return;
    setHist((h) => (h.length && elapsed - h[h.length - 1].t * 60 < 30 ? h : [...h, { t: elapsed / 60, o2: (cons.o2 / CAPACITY.o2) * 100, batt: (cons.batt / CAPACITY.batt) * 100, water: (cons.water / CAPACITY.water) * 100, dose: cons.dose * 1000, met }]));
  }, [elapsed]); // eslint-disable-line react-hooks/exhaustive-deps

  const abortHome = useCallback((why: string) => {
    if (!pnrInfo.path.length) return;
    setActive({ prof: profile(t, pnrInfo.path, sep), stopIdx: [0, pnrInfo.path.length - 1], kind: "abort" });
    setS(0); setStarted(true); setRunning(true);
    toast.warning(why);
  }, [pnrInfo.path, t, sep]);

  // automatic critical abort
  const lastStatus = useRef("nominal");
  useEffect(() => {
    if (!started || cur.kind !== "plan") { lastStatus.current = pnrInfo.status; return; }
    if (pnrInfo.status === "critical" && lastStatus.current !== "critical") abortHome("CRITICAL: reserve below 15% — automatic return to habitat.");
    else if (pnrInfo.status === "caution" && lastStatus.current === "nominal") toast.warning("CAUTION: return reserve below 30%. Consider aborting.");
    lastStatus.current = pnrInfo.status;
  }, [pnrInfo.status, started, cur.kind, abortHome]);

  const triggerSep = () => {
    const path = evacuate(t, curCell);
    setSep(true);
    if (!path) { toast.error("No reachable shelter — shelter in place."); return; }
    setActive({ prof: profile(t, path, true), stopIdx: [0, path.length - 1], kind: "evac" });
    setS(0); setStarted(true); setRunning(true);
    const dest = path[path.length - 1] === home ? "habitat relay" : "cliff-base shelter";
    toast.error(`SOLAR PARTICLE EVENT: dose ×${SEP_MULT}. Evacuating to ${dest} (${path.length * CELL} m).`);
  };
  const reset = () => { setRunning(false); setStarted(false); setActive(null); setS(0); setElapsed(0); setTrail([]); setHist([]); setSep(false); setCons(startCons); };
  const toggleRun = () => { if (!started) { setStarted(true); setHist([]); } setRunning((r) => !r); };

  const addWp = (c: number) => {
    if (started) { toast.info("Reset the EVA to edit the plan."); return; }
    if (isBlocked(t, c)) { toast.error(`Kinematic lockout: ${t.slope[c].toFixed(1)}° on TI ${t.ti[c].toFixed(0)} — exceeds ${t.ti[c] < LIMITS.regolithTI ? LIMITS.regolithSlope : LIMITS.bedrockSlope}° limit.`); return; }
    setWps((w) => [...w, c]);
  };

  // guidance
  const guidance: Guidance = useMemo(() => {
    const nextStop = cur.stopIdx.find((i) => i > k);
    if (nextStop == null || !started) return null;
    const tgt = P.cells[nextStop];
    const dx = ((tgt % N) - pos[0]) * CELL, dy = (Math.floor(tgt / N) - pos[1]) * CELL;
    const bearing = (Math.atan2(dx, -dy) * 180) / Math.PI;
    const look = P.cells[Math.min(P.cells.length - 1, k + 3)];
    const ldx = (look % N) - pos[0], ldy = Math.floor(look / N) - pos[1];
    const lb = (Math.atan2(ldx, -ldy) * 180) / Math.PI;
    const wpN = cur.kind === "plan" ? cur.stopIdx.indexOf(nextStop) : -1;
    const target = cur.kind === "evac" ? (tgt === home ? "Habitat relay (shelter)" : "Cliff shelter") : cur.kind === "abort" || tgt === home ? "Habitat" : `WP${wpN}`;
    const sl = t.slope[look];
    return { text: `Head ${compass(lb)}${sl > 10 ? ` — ${sl.toFixed(0)}° grade, short steps` : ""}${t.ti[look] < LIMITS.regolithTI ? " · loose regolith" : ""}`, dist: Math.hypot(dx, dy), bearing, target,
      scene: t.mineral[tgt] === 3 || t.mineral[tgt] === 1 ? sceneBox : sceneGediz, sceneAlt: "Illustrative rover view of the terrain ahead" };
  }, [cur, k, started, P, pos, t, home]);

  const elevProfile = useMemo(() => plan.prof.cells.filter((_, i) => i % 2 === 0).map((c, i) => ({ d: Math.round(plan.prof.d[i * 2] ), z: Math.round(t.elev[c]), slope: +t.slope[c].toFixed(1) })), [plan, t]);
  const T = plan.prof.total;
  const pnrTone = (st: string) => (st === "critical" ? "crit" : st === "caution" ? "warn" : "ok") as "crit" | "warn" | "ok";

  return (
    <div className="grid-bg min-h-screen">
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-4 py-2.5">
          <img src="/favicon.png" alt="" width={28} height={28} className="rounded" />
          <div className="mr-auto leading-tight">
            <h1 className="text-lg font-bold tracking-wider">ARES-NAV</h1>
            <p className="text-[11px] text-muted-foreground">Mount Sharp boxwork · Gediz Vallis margin · Gale Crater 4.6°S 137.4°E</p>
          </div>
          <div className="flex items-center gap-2 font-mono text-[11px]">
            <span className={cn("flex items-center gap-1 rounded border px-2 py-1", online ? "border-success/50 text-success" : "border-warning text-warning")}>
              {online ? <Database className="size-3" /> : <WifiOff className="size-3" />}{online ? `Spatial cache: ${source === "cache" ? "IndexedDB" : "seeded"}` : "COMMS BLACKOUT · offline cache"}
            </span>
            {sep && <span className="animate-pulse rounded border border-destructive px-2 py-1 text-destructive">SEP ACTIVE ×{SEP_MULT}</span>}
          </div>
          <div className="flex rounded-md border border-border p-0.5" role="tablist">
            <button role="tab" aria-selected={mode === "map"} onClick={() => setMode("map")} className={cn("flex items-center gap-1.5 rounded px-3 py-1.5 text-sm", mode === "map" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}><MapIcon className="size-4" />Habitat Map</button>
            <button role="tab" aria-selected={mode === "visor"} onClick={() => setMode("visor")} className={cn("flex items-center gap-1.5 rounded px-3 py-1.5 text-sm", mode === "visor" ? "bg-hud text-accent-foreground" : "text-muted-foreground")}><MonitorSmartphone className="size-4" />Visor HUD</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] p-4">
        {mode === "visor" ? (
          <VisorHUD terrain={t} cons={cons} met={met} speed={speed} los={!!t.los[curCell]} sep={sep} pnrStatus={pnrInfo.status} reserve={pnrInfo.reserve}
            guidance={guidance} elapsed={elapsed} route={P.cells} waypoints={wps} pos={started ? pos : null} trail={trail} evac={cur.kind === "evac"}
            onSep={triggerSep} onAbort={() => abortHome("Manual abort — returning to habitat.")} running={running} onToggleRun={toggleRun} />
        ) : (
          <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)_360px] lg:grid-cols-[260px_minmax(0,1fr)]">
            {/* LEFT: controls */}
            <aside className="space-y-4">
              <section className="panel p-3">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Terrain layer</h2>
                <div className="space-y-1">
                  {LAYERS.map((l) => (
                    <button key={l.id} onClick={() => setLayer(l.id)} className={cn("w-full rounded px-2.5 py-1.5 text-left text-sm transition-colors", layer === l.id ? "bg-primary text-primary-foreground" : "hover:bg-secondary")}>
                      {l.label}<div className={cn("text-[10px]", layer === l.id ? "text-primary-foreground/75" : "text-muted-foreground")}>{l.src}</div>
                    </button>
                  ))}
                </div>
                <Legend layer={layer} />
              </section>
              <section className="panel space-y-2.5 p-3">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Overlays</h2>
                {([["los", "UHF viewshed (shade = no LoS)"], ["hazard", "Kinematic lockout ✕"], ["shelters", "SEP shelters (sky-view < 0.62)"], ["contours", "10 m contours"]] as const).map(([key, label]) => (
                  <label key={key} className="flex items-center justify-between gap-2 text-sm">{label}<Switch checked={ov[key]} onCheckedChange={(v) => setOv((o) => ({ ...o, [key]: v }))} /></label>
                ))}
                <label className="flex items-center justify-between gap-2 text-sm"><span className="flex items-center gap-1"><Box className="size-3.5" />2.5D tilt view</span><Switch checked={tilt} onCheckedChange={setTilt} /></label>
              </section>
              <section className="panel space-y-2 p-3">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Solver preset</h2>
                {PRESETS.map((p) => (
                  <button key={p.id} disabled={started} onClick={() => setPreset(p.id)} className={cn("w-full rounded border px-2.5 py-1.5 text-left text-sm disabled:opacity-50", preset === p.id ? "border-accent bg-accent/10 text-accent" : "border-border hover:bg-secondary")}>
                    {p.label}<div className="text-[10px] text-muted-foreground">{p.hint}</div>
                  </button>
                ))}
                <p className="pt-1 font-mono text-[10px] leading-relaxed text-muted-foreground">Lockout: &gt;{LIMITS.regolithSlope}° on TI&lt;{LIMITS.regolithTI} · &gt;{LIMITS.bedrockSlope}° on bedrock</p>
              </section>
              <section className="panel space-y-3 p-3">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Scenario</h2>
                <div><div className="mb-1 flex justify-between text-sm"><span>Starting consumables</span><span className="font-mono">{startPct}%</span></div><Slider min={20} max={100} step={5} value={[startPct]} disabled={started} onValueChange={([v]) => setStartPct(v)} /></div>
                <div><div className="mb-1 flex justify-between text-sm"><span>Sim time scale</span><span className="font-mono">×{timeScale}</span></div><Slider min={10} max={300} step={10} value={[timeScale]} onValueChange={([v]) => setTimeScale(v)} /></div>
              </section>
            </aside>

            {/* CENTER: map */}
            <section className="space-y-4">
              <div className="panel p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={toggleRun} disabled={plan.failedLeg != null}>{running ? <Pause /> : <Play />}{running ? "Hold" : started ? "Resume" : "Start EVA"}</Button>
                  <Button size="sm" variant="outline" onClick={reset}><RotateCcw />Reset</Button>
                  <Button size="sm" variant="outline" className="border-warning text-warning" disabled={!started} onClick={() => abortHome("Manual abort — returning to habitat.")}>Abort → Hab</Button>
                  <Button size="sm" variant="destructive" onClick={triggerSep} className="ml-auto"><ShieldAlert />Simulate Solar Particle Event</Button>
                </div>
                <TacticalMap terrain={t} layer={layer} overlays={ov} tilt={tilt} route={P.cells} returnRoute={started && cur.kind === "plan" ? pnrInfo.path : undefined}
                  evac={cur.kind === "evac"} waypoints={wps} pos={started ? pos : null} trail={trail} onCellClick={addWp} onWaypointClick={setSelWp} />
                <p className="mt-2 text-[11px] text-muted-foreground">Click terrain to append a waypoint · click a ◆ to inspect · cyan = route, red = evacuation, dashed amber = live return-to-hab path.{tilt && " Planning clicks disabled in tilt view."}</p>
                {plan.failedLeg != null && <p className="mt-2 rounded border border-destructive bg-destructive/10 p-2 text-sm text-destructive">No safe path for leg {plan.failedLeg}. Remove or move that waypoint.</p>}
              </div>
              <div className="panel p-3">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Route elevation profile</h2>
                <div className="h-36">
                  <ResponsiveContainer>
                    <AreaChart data={elevProfile} margin={{ left: -10, right: 8, top: 4, bottom: 0 }}>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                      <XAxis dataKey="d" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} unit="m" />
                      <YAxis domain={["dataMin - 5", "dataMax + 5"]} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                      <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", fontSize: 12 }} />
                      <Area dataKey="z" name="Elevation (m)" stroke="var(--primary)" fill="var(--primary)" fillOpacity={0.2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </section>

            {/* RIGHT: telemetry */}
            <aside className="space-y-4 lg:col-span-2 xl:col-span-1">
              <section className="panel p-3">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Plan summary · {PRESETS.find((p) => p.id === preset)?.label}</h2>
                <div className="grid grid-cols-2 gap-2">
                  <Stat label="Distance" value={`${(T.dist / 1000).toFixed(2)} km`} sub={`${wps.length} science stops`} />
                  <Stat label="Duration" value={fmtT(T.time)} sub="walking only" />
                  <Stat label="O₂ / Battery" value={`${(T.o2 * 1000).toFixed(0)} g`} sub={`${T.batt.toFixed(0)} Wh · ${T.water.toFixed(2)} kg H₂O`} />
                  <Stat label="Dose" value={`${(T.dose * 1000).toFixed(1)} µSv`} sub={`${T.sci} mineral cells crossed`} />
                  <Stat label="LoS gaps" value={`${((T.noLos / Math.max(1, P.cells.length)) * 100).toFixed(0)}%`} sub="of route out of UHF" tone={T.noLos > P.cells.length * 0.3 ? "warn" : "ok"} />
                  <Stat label="Worst PNR reserve" value={`${(plannedPnr.worst * 100).toFixed(0)}%`} sub={plannedPnr.worst < 0.15 ? "Plan violates critical" : plannedPnr.worst < 0.3 ? "Below caution" : "Within margins"} tone={pnrTone(plannedPnr.worst < 0.15 ? "critical" : plannedPnr.worst < 0.3 ? "caution" : "nominal")} />
                </div>
              </section>
              <section className={cn("panel space-y-2.5 p-3", pnrInfo.status === "critical" && "border-destructive", pnrInfo.status === "caution" && "border-warning")}>
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Live suit telemetry</h2>
                  <span className={cn("rounded px-2 py-0.5 font-mono text-[11px] uppercase", pnrInfo.status === "critical" ? "bg-destructive text-destructive-foreground" : pnrInfo.status === "caution" ? "bg-warning text-primary-foreground" : "bg-success/20 text-success")}>PNR {pnrInfo.status} {(pnrInfo.reserve * 100).toFixed(0)}%</span>
                </div>
                <Bar label="O₂" value={(cons.o2 * 1000).toFixed(0)} unit="g" frac={cons.o2 / CAPACITY.o2} />
                <Bar label="Battery" value={cons.batt.toFixed(0)} unit="Wh" frac={cons.batt / CAPACITY.batt} />
                <Bar label="Cooling water" value={cons.water.toFixed(2)} unit="kg" frac={cons.water / CAPACITY.water} />
                <div className="grid grid-cols-3 gap-2 font-mono text-xs">
                  <div><div className="text-[10px] text-muted-foreground">DOSE</div>{(cons.dose * 1000).toFixed(2)} µSv</div>
                  <div><div className="text-[10px] text-muted-foreground">METABOLIC</div>{met.toFixed(0)} W</div>
                  <div><div className="text-[10px] text-muted-foreground">UHF</div><span className={t.los[curCell] ? "text-success" : "text-destructive"}>{t.los[curCell] ? "LoS" : "NO LoS"}</span></div>
                </div>
                <div className="h-36">
                  <ResponsiveContainer>
                    <LineChart data={hist} margin={{ left: -20, right: 6, top: 4, bottom: 0 }}>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                      <XAxis dataKey="t" type="number" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} unit="m" tickFormatter={(v) => v.toFixed(0)} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                      <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", fontSize: 12 }} formatter={(v: number) => v.toFixed(1)} labelFormatter={(v) => `T+${Number(v).toFixed(1)} min`} />
                      <Line dataKey="o2" name="O₂ %" stroke="var(--chart-1)" dot={false} isAnimationActive={false} />
                      <Line dataKey="batt" name="Battery %" stroke="var(--chart-2)" dot={false} isAnimationActive={false} />
                      <Line dataKey="water" name="Water %" stroke="var(--chart-4)" dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                {!started && <p className="text-[11px] text-muted-foreground">Start the EVA to stream telemetry.</p>}
              </section>
              <section className="panel p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Waypoints</h2>
                  {wps.length > 0 && !started && <button className="text-[11px] text-muted-foreground hover:text-destructive" onClick={() => setWps([])}>Clear all</button>}
                </div>
                <ol className="space-y-1">
                  <li className="flex items-center gap-2 rounded px-2 py-1 font-mono text-xs text-success">H · Habitat relay (start/end)</li>
                  {wps.map((w, i) => (
                    <li key={`${w}-${i}`} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-secondary">
                      <button className="flex flex-1 items-center gap-2 text-left" onClick={() => setSelWp(i)}>
                        <span className="grid size-5 place-items-center rounded-sm border border-primary font-mono text-[10px] text-primary">{i + 1}</span>
                        <span className="flex-1">{MINERALS[t.mineral[w]] === "—" ? "Traverse point" : MINERALS[t.mineral[w]]}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">{t.slope[w].toFixed(0)}° · TI {t.ti[w].toFixed(0)}</span>
                      </button>
                      {!started && <button aria-label="Remove waypoint" onClick={() => setWps((x) => x.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-3.5" /></button>}
                    </li>
                  ))}
                </ol>
              </section>
              <Provenance />
            </aside>
          </div>
        )}
      </main>

      <Dialog open={selWp != null} onOpenChange={(o) => !o && setSelWp(null)}>
        {selWp != null && wps[selWp] != null && <WaypointModal t={t} cell={wps[selWp]} n={selWp + 1} onRemove={started ? undefined : () => { setWps((x) => x.filter((_, j) => j !== selWp)); setSelWp(null); }} />}
      </Dialog>
    </div>
  );
}

function WaypointModal({ t, cell, n, onRemove }: { t: Terrain; cell: number; n: number; onRemove?: (() => void) | undefined }) {
  const ll = cellToLatLon(cell), m = t.mineral[cell];
  const notes = ["Traverse checkpoint — no orbital mineral detection.", "Hydrated Mg/Ca-sulfate signature: layered sulfate-bearing unit. Sample light-toned laminae.", "Fe/Mg phyllosilicate on channel margin: clay-bearing debris — priority for organics context.", "Hematite-cemented boxwork ridge: mineral-filled fracture — core the ridge crest and adjacent hollow."];
  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><span className="grid size-6 place-items-center rounded-sm border border-primary font-mono text-xs text-primary">{n}</span>{m ? MINERALS[m] : "Traverse point"} station</DialogTitle>
        <DialogDescription className="font-mono text-xs">{ll.lat.toFixed(4)}°, {ll.lon.toFixed(4)}°E · {t.elev[cell].toFixed(0)} m</DialogDescription>
      </DialogHeader>
      <figure className="overflow-hidden rounded-md border border-border">
        <img src={m === 3 || m === 1 ? sceneBox : sceneGediz} alt="Illustrative scene of the waypoint terrain" width={1280} height={720} loading="lazy" className="aspect-video w-full object-cover" />
        <figcaption className="bg-muted px-3 py-1 text-[10px] text-warning">Illustrative AI-generated scene — not HiRISE or Mastcam imagery.</figcaption>
      </figure>
      <p className="text-sm">{notes[m]}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Slope" value={`${t.slope[cell].toFixed(1)}°`} tone={t.slope[cell] > 12 ? "warn" : "ok"} />
        <Stat label="Thermal inertia" value={t.ti[cell].toFixed(0)} sub={t.ti[cell] < LIMITS.regolithTI ? "loose regolith" : t.ti[cell] > 350 ? "bedrock" : "indurated"} />
        <Stat label="Sky-view" value={t.sky[cell].toFixed(2)} sub={t.sky[cell] < 0.62 ? "SEP shelter" : "exposed"} />
        <Stat label="UHF" value={t.los[cell] ? "LoS" : "NO LoS"} tone={t.los[cell] ? "ok" : "crit"} />
      </div>
      <p className="text-[11px] text-muted-foreground">All values from the synthetic calibrated Gale model (see provenance panel).</p>
      {onRemove && <Button variant="outline" onClick={onRemove} className="w-fit"><X />Remove waypoint</Button>}
    </DialogContent>
  );
}

function Legend({ layer }: { layer: Layer }) {
  const items: Record<Layer, [string, string][]> = {
    optical: [["oklch(0.4 0.08 40)", "Low"], ["oklch(0.82 0.06 60)", "High"]],
    slope: [["oklch(0.55 0.1 160)", "0°"], ["oklch(0.8 0.15 95)", "11°"], ["oklch(0.6 0.2 25)", "22°"], ["oklch(0.4 0.17 340)", "Lockout"]],
    mineral: [["oklch(0.9 0.13 100)", "Sulfate"], ["oklch(0.75 0.12 175)", "Phyllosil."], ["oklch(0.5 0.17 360)", "Hematite"]],
    thermal: [["oklch(0.35 0.1 270)", "<150 dust"], ["oklch(0.7 0.12 70)", "300"], ["oklch(0.9 0.07 80)", "600 rock"]],
    sky: [["oklch(0.25 0.06 260)", "Shielded"], ["oklch(0.9 0.03 90)", "Exposed"]],
  };
  return (
    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
      {items[layer].map(([c, l]) => <span key={l} className="flex items-center gap-1"><span className="size-2.5 rounded-sm" style={{ background: c }} />{l}</span>)}
    </div>
  );
}

function Provenance() {
  const rows: [string, string, string][] = [
    ["Terrain DTM, slope, sky-view", "Synthetic", "Procedural model calibrated to HiRISE DTM relief of Mt Sharp"],
    ["Mineral classes", "Synthetic", "Class layout inspired by CRISM detections (sulfate, clay, hematite)"],
    ["Thermal inertia", "Synthetic", "Value ranges from THEMIS-derived TI for Gale"],
    ["Surface dose 0.67 mSv/day", "Validated", "MSL RAD, Hassler et al. 2014 (Science)"],
    ["Gravity 3.72 m/s²", "Validated", "Mars physical constant"],
    ["Metabolic model", "Published model", "Pandolf 1977 + Santee 2001 downhill, gravity-scaled"],
    ["Waypoint scenes", "Illustrative", "AI-generated, not mission imagery"],
  ];
  return (
    <section className="panel p-3">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Scientific provenance</h2>
      <ul className="space-y-1.5">
        {rows.map(([k, tag, d]) => (
          <li key={k} className="text-[11px] leading-snug">
            <span className={cn("mr-1.5 rounded px-1 py-px font-mono text-[9px] uppercase", tag === "Validated" ? "bg-success/20 text-success" : tag === "Illustrative" ? "bg-warning/20 text-warning" : tag === "Synthetic" ? "bg-accent/15 text-accent" : "bg-secondary text-secondary-foreground")}>{tag}</span>
            <span className="font-medium">{k}</span> — <span className="text-muted-foreground">{d}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[10px] text-muted-foreground">No live NASA API calls; all layers run from the local spatial cache.</p>
    </section>
  );
}
