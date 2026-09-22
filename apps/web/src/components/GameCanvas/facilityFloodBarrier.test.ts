import { describe, expect, it, vi } from "vitest";
import { createFacilityFloodBarrier, MAX_FLOOD_BARRIERS } from "./facilityFloodBarrier";

const cell = (x: number, z: number, half = 0.1) => [
  { x: x - half, z: z - half }, { x: x + half, z: z - half },
  { x: x + half, z: z + half }, { x: x - half, z: z + half },
];
const placement = { structureId: "levee", x: 0, z: 0, headingDegrees: 0 };
describe("committed facility flood barrier", () => {
  it("matches model origin, toe, slope and finite crest", () => {
    const barrier = createFacilityFloodBarrier([placement], () => 10);
    expect(barrier.cellElevation(cell(0, 0))).toBe(25.5);
    expect(barrier.cellElevation(cell(0, 12))).toBeCloseTo(18.6);
    expect(barrier.cellElevation(cell(48.5, 0))).toBe(12.5);
    expect(barrier.cellElevation(cell(50, 0))).toBeNull();
    expect(barrier.cellElevation(cell(0, 20))).toBeNull();
  });
  it("matches negative Three Y rotation and translations at oblique headings", () => {
    const p = { ...placement, x: 70, z: -30, headingDegrees: 30 };
    const barrier = createFacilityFloodBarrier([p], () => 0);
    expect(barrier.cellElevation(cell(70 + 40 * Math.cos(Math.PI / 6), -30 + 20))).toBe(15.5);
    expect(barrier.cellElevation(cell(70 + 20, -30 - 40 * Math.cos(Math.PI / 6)))).toBeNull();
  });
  it("finds a thin rotated intersection without point-sampling gaps, but excludes edge-only contact", () => {
    const barrier = createFacilityFloodBarrier([placement], () => 0);
    expect(barrier.cellElevation(cell(50.99, 0, 2))).toBe(2.5);
    expect(barrier.cellElevation(cell(51, 0, 2))).toBeNull();
  });
  it("ignores preview, other facilities and unavailable ground without zero fallback", () => {
    for (const ground of [null, NaN, Infinity]) expect(createFacilityFloodBarrier([placement], () => ground).facilityCount).toBe(0);
    const sample = vi.fn(() => 0);
    const barrier = createFacilityFloodBarrier([{ ...placement, preview: true }, { ...placement, structureId: "drainage-pump" }], sample);
    expect(barrier.cellElevation(cell(0, 0))).toBeNull();
    expect(sample).not.toHaveBeenCalled();
  });
  it("snapshots mutable input, samples ground once and bounds retained geometry", () => {
    const p = { ...placement }, sample = vi.fn(() => 0);
    const barrier = createFacilityFloodBarrier([p], sample);
    p.x = 1000;
    for (let i = 0; i < 100; i++) expect(barrier.cellElevation(cell(0, 0))).toBe(15.5);
    expect(sample).toHaveBeenCalledTimes(1);
    expect(() => createFacilityFloodBarrier(Array.from({ length: MAX_FLOOD_BARRIERS + 1 }, () => placement), sample)).toThrow(RangeError);
  });
});
