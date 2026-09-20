import { describe, expect, it } from "vitest";
import {
  DIORAMA_ORIGIN,
  geoToWorld,
  worldToGeo,
  groundY,
  riverX,
  RIVER_POINTS,
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
});
