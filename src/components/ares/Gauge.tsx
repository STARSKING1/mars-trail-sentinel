import { cn } from "@/lib/utils";

export function Bar({ label, value, unit, frac, big }: { label: string; value: string; unit?: string; frac: number; big?: boolean }) {
  const tone = frac < 0.15 ? "bg-destructive" : frac < 0.3 ? "bg-warning" : "bg-hud";
  const text = frac < 0.15 ? "text-destructive" : frac < 0.3 ? "text-warning" : "text-hud";
  return (
    <div>
      <div className="flex items-baseline justify-between font-mono">
        <span className={cn("uppercase tracking-widest text-muted-foreground", big ? "text-xs" : "text-[10px]")}>{label}</span>
        <span className={cn(text, big ? "text-2xl font-semibold" : "text-sm")}>{value}<span className="ml-1 text-[10px] text-muted-foreground">{unit}</span></span>
      </div>
      <div className={cn("mt-1 overflow-hidden rounded-sm bg-muted", big ? "h-3" : "h-1.5")}>
        <div className={cn("h-full transition-all", tone)} style={{ width: `${Math.max(0, Math.min(1, frac)) * 100}%` }} />
      </div>
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "warn" | "crit" | "ok" }) {
  return (
    <div className="rounded-md border border-border bg-background/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={cn("font-mono text-lg font-semibold", tone === "crit" && "text-destructive", tone === "warn" && "text-warning", tone === "ok" && "text-success")}>{value}</div>
      {sub && <div className="font-mono text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
