import { describe, expect, it } from "vitest";
import {
  DIORAMA_ORIGIN,
  geoToWorld,
  worldToGeo,
  groundY,
  riverX,
  RIVER_POINTS,
  intersectDioramaSurface,
} from "./dioramaSpace";

describe("Abukuma diorama coordinates", () => {
  it("round trips geographic positions without changing hydraulic coordinates", () => {
    for (const point of RIVER_POINTS) {
      const geo = worldToGeo(point.x, point.z);
      expect(geoToWorld(geo.longitude, geo.latitude)).toEqual(point);
    }
    expect(geoToWorld(DIORAMA_ORIGIN.longitude, DIORAMA_ORIGIN.latitude)).toEqual({ x: 0, z: -0 });
  });
  it("keeps the river bed and raised banks distinct", () => {
    for (const z of [-1500, 0, 900]) {
      const x = riverX(z);
      expect(groundY(x, z)).toBe(0);
      expect(groundY(x + 100, z)).toBe(9);
      expect(groundY(x - 100, z)).toBe(9);
    }
  });
  it("picks raised banks at their visible height rather than the river bed", () => {
    const x = riverX(0) + 150;
    const point = intersectDioramaSurface({ x, y: 100, z: 0 }, { x: 0.5, y: -1, z: 0 });
    expect(point?.x).toBeCloseTo(x + 45.5, 4);
  });
  it("picks water and sloping banks at their respective surface heights", () => {
    for (const offset of [0, 40, 50, -55, 100]) {
      const x = riverX(0) + offset;
      const point = intersectDioramaSurface({ x, y: 100, z: 0 }, { x: 0, y: -1, z: 0 });
      expect(point?.x).toBeCloseTo(x, 5);
      expect(point?.z).toBe(0);
    }
    const x = riverX(0) + 55;
    const point = intersectDioramaSurface({ x: x - 48.075, y: 100, z: 0 }, { x: 0.5, y: -1, z: 0 });
    expect(point?.x).toBeCloseTo(x, 4);
  });
  it("ignores rays toward the sky", () => {
    expect(intersectDioramaSurface({ x: 0, y: 100, z: 0 }, { x: 1, y: 0, z: 0 })).toBeNull();
  });
});
