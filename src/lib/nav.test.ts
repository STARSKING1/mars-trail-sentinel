import { describe, it, expect } from "vitest";
import { generateTerrain, idx } from "./terrain";
import { isBlocked, metabolicW, pnr, CAPACITY, astar, evacuate } from "./nav";

const t = generateTerrain();
describe("kinematic lockouts", () => {
  it("blocks >15° on regolith TI<150", () => { const tt = { ...t, slope: new Float32Array([16]), ti: new Float32Array([140]) }; expect(isBlocked(tt as never, 0)).toBe(true); });
  it("allows 16° on bedrock TI≥150", () => { const tt = { ...t, slope: new Float32Array([16]), ti: new Float32Array([400]) }; expect(isBlocked(tt as never, 0)).toBe(false); });
  it("blocks >22° on bedrock", () => { const tt = { ...t, slope: new Float32Array([23]), ti: new Float32Array([500]) }; expect(isBlocked(tt as never, 0)).toBe(true); });
});
describe("bioenergetics", () => { it("uphill costs more than flat", () => expect(metabolicW(1, 0.1)).toBeGreaterThan(metabolicW(1, 0))); });
describe("PNR", () => {
  const far = astar(t, idx(10, 12), [idx(30, 75)], "balanced")!;
  const cell = far[far.length - 1];
  it("full tanks are nominal", () => expect(pnr(t, cell, CAPACITY, false).status).toBe("nominal"));
  it("20% reserve is caution", () => expect(pnr(t, cell, { o2: CAPACITY.o2 * 0.4, batt: CAPACITY.batt, water: CAPACITY.water }, false).status).not.toBe("nominal"));
  it("evac path found", () => expect(evacuate(t, cell)?.length).toBeGreaterThan(0));
});
