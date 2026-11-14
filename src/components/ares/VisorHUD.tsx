import { Radio, RadioTower, ShieldAlert, Navigation, Heart, Siren } from "lucide-react";
import { Bar } from "./Gauge";
import { TacticalMap, type Layer, type Overlays } from "./TacticalMap";
import { CAPACITY } from "@/lib/nav";
import type { Terrain } from "@/lib/terrain";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type Guidance = { text: string; dist: number; bearing: number; target: string; scene: string; sceneAlt: string } | null;

type Props = {
  terrain: Terrain; cons: { o2: number; batt: number; water: number; dose: number };
  met: number; speed: number; los: boolean; sep: boolean; pnrStatus: string; reserve: number;
  guidance: Guidance; elapsed: number; route: number[]; waypoints: number[]; pos: [number, number] | null;
  trail: number[]; evac: boolean; onSep: () => void; onAbort: () => void; running: boolean; onToggleRun: () => void;
};

const fmtT = (s: number) => `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const ov: Overlays = { los: true, hazard: true, shelters: false, contours: false };
const L: Layer = "optical";

export function VisorHUD(p: Props) {
  const crit = p.pnrStatus === "critical" || p.sep;
  return (
    <div className={cn("scanlines relative overflow-hidden rounded-2xl border-2 bg-background p-4 md:p-6", crit ? "border-destructive" : "border-hud/40")}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 font-mono">
        <div className="text-hud">
          <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">EVA elapsed</div>
          <div className="text-3xl font-semibold">{fmtT(p.elapsed)}</div>
        </div>
        <div className={cn("flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold", p.los ? "border-success text-success" : "border-destructive text-destructive animate-pulse")}>
          {p.los ? <RadioTower className="size-5" /> : <Radio className="size-5" />} UHF {p.los ? "LINK — HAB RELAY" : "LOS LOST"}
        </div>
        <div className={cn("rounded-md border px-3 py-2 text-sm font-semibold uppercase", p.pnrStatus === "critical" ? "border-destructive text-destructive" : p.pnrStatus === "caution" ? "border-warning text-warning" : "border-success text-success")}>
          PNR {p.pnrStatus} · {(p.reserve * 100).toFixed(0)}% reserve
        </div>
      </div>

      {p.sep && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border-2 border-destructive bg-destructive/15 p-3 text-destructive">
          <Siren className="size-7 animate-pulse" />
          <div className="font-mono text-sm"><div className="text-lg font-bold">SOLAR PARTICLE EVENT — TAKE SHELTER</div>Ambient dose ×10. Follow red evacuation path.</div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-4">
          <div className="rounded-xl border border-hud/30 bg-card/60 p-4">
            <div className="flex items-center gap-4">
              <div className="relative grid size-20 shrink-0 place-items-center rounded-full border-2 border-hud/60">
                <Navigation className="size-9 text-hud transition-transform" style={{ transform: `rotate(${p.guidance?.bearing ?? 0}deg)` }} />
              </div>
              <div className="min-w-0 font-mono">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Next: {p.guidance?.target ?? "—"}</div>
                <div className="text-2xl font-semibold text-hud">{p.guidance ? `${p.guidance.dist.toFixed(0)} m` : "Standby"}</div>
                <div className="text-sm text-foreground">{p.guidance?.text ?? "Press START EVA to begin guidance."}</div>
              </div>
            </div>
          </div>
          <div className="space-y-3 rounded-xl border border-hud/30 bg-card/60 p-4">
            <Bar big label="O₂" value={(p.cons.o2 * 1000).toFixed(0)} unit="g" frac={p.cons.o2 / CAPACITY.o2} />
            <Bar big label="Battery" value={p.cons.batt.toFixed(0)} unit="Wh" frac={p.cons.batt / CAPACITY.batt} />
            <Bar big label="Cooling H₂O" value={p.cons.water.toFixed(2)} unit="kg" frac={p.cons.water / CAPACITY.water} />
            <div className="grid grid-cols-3 gap-2 pt-1 font-mono">
              <div><div className="text-[10px] uppercase text-muted-foreground">Dose</div><div className={cn("text-xl", p.sep ? "text-destructive" : "text-hud")}>{p.cons.dose.toFixed(4)}<span className="text-[10px] text-muted-foreground"> mSv</span></div></div>
              <div><div className="flex items-center gap-1 text-[10px] uppercase text-muted-foreground"><Heart className="size-3" />Metabolic</div><div className="text-xl text-hud">{p.met.toFixed(0)}<span className="text-[10px] text-muted-foreground"> W</span></div></div>
              <div><div className="text-[10px] uppercase text-muted-foreground">Pace</div><div className="text-xl text-hud">{p.speed.toFixed(2)}<span className="text-[10px] text-muted-foreground"> m/s</span></div></div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Button size="lg" variant="secondary" onClick={p.onToggleRun} className="font-mono">{p.running ? "HOLD" : "START EVA"}</Button>
            <Button size="lg" variant="outline" onClick={p.onAbort} className="border-warning font-mono text-warning">ABORT → HAB</Button>
            <Button size="lg" variant="destructive" onClick={p.onSep} className="font-mono"><ShieldAlert className="size-4" />SEP</Button>
          </div>
        </div>
        <div className="space-y-4">
          {p.guidance && (
            <figure className="overflow-hidden rounded-xl border border-hud/30">
              <img src={p.guidance.scene} alt={p.guidance.sceneAlt} width={1280} height={720} loading="lazy" className="aspect-video w-full object-cover" />
              <figcaption className="bg-card px-3 py-1.5 font-mono text-[10px] text-warning">ROVER POV PREVIEW · ILLUSTRATIVE AI-GENERATED SCENE — NOT MISSION IMAGERY</figcaption>
            </figure>
          )}
          <div className="rounded-xl border border-hud/30 p-2">
            <TacticalMap compact terrain={p.terrain} layer={L} overlays={ov} route={p.route} waypoints={p.waypoints} pos={p.pos} trail={p.trail} evac={p.evac} />
          </div>
        </div>
      </div>
    </div>
  );
}
