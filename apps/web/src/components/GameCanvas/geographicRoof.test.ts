import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createGeographicRoof, type RoofPlanPoint, type GeographicRoof } from "./geographicRoof";
import { koriyamaGeoToLocal, type KoriyamaGeodata } from "./koriyamaGeodata";

const rect = (w = 20, d = 10): RoofPlanPoint[] => [{ x: 0, z: 0 }, { x: w, z: 0 }, { x: w, z: d }, { x: 0, z: d }];
const projectedArea = (roof: GeographicRoof) => roof.triangles.reduce((sum, [a, b, c]) =>
  sum + Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) / 2, 0);

describe("geographic roofs inside the source height envelope", () => {
  it("makes gabled slopes and end caps with a long-axis ridge at the original top", () => {
    const result = createGeographicRoof({ rings: [rect()], baseY: 7, heightM: 10, sourceRoofShape: "gabled" });
    expect(result.style).toBe("gabled");
    expect(result.topY).toBe(17); expect(result.eaveY).toBe(15); expect(result.roofRiseM).toBe(2);
    expect(result.ridge).toEqual([{ x: 0, y: 17, z: 5 }, { x: 20, y: 17, z: 5 }]);
    expect(result.triangles).toHaveLength(6);
    expect(projectedArea(result)).toBeCloseTo(200, 8);
    expect(result.provenance.classification).toBe("tagged-shape-but-inferred-pitch");
    expect(result.provenance.ridge).toBe("inferred-from-footprint-not-surveyed");
    for (const p of result.triangles.flat()) {
      expect(p.y).toBeGreaterThanOrEqual(result.eaveY); expect(p.y).toBeLessThanOrEqual(17);
      expect(p.x >= 0 && p.x <= 20 && p.z >= 0 && p.z <= 10).toBe(true);
    }
  });

  it("forms hipped ends and a square pyramid without exceeding the top or creating degenerate faces", () => {
    const result = createGeographicRoof({ rings: [rect()], baseY: -3, heightM: 14, sourceRoofShape: "hipped" });
    expect(result.ridge).toEqual([{ x: 5, y: 11, z: 5 }, { x: 15, y: 11, z: 5 }]);
    expect(result.eaveY).toBe(8.5); expect(projectedArea(result)).toBe(200);
    const square = createGeographicRoof({ rings: [rect(10, 10)], baseY: 0, heightM: 5, sourceRoofShape: "hipped" });
    expect(square.ridge![0]).toEqual(square.ridge![1]);
    expect(square.triangles).toHaveLength(4);
    expect(projectedArea(square)).toBe(100);
  });

  it("requires opt-in for untagged fallback and rejects noncompact/tall/large/school roofs", () => {
    const options = { rings: [rect()], baseY: 0, heightM: 10 };
    expect(createGeographicRoof(options).style).toBe("flat");
    const illustrated = createGeographicRoof({ ...options, allowIllustrativeHip: true });
    expect(illustrated.style).toBe("hipped"); expect(illustrated.provenance.classification).toBe("illustrative");
    for (const extra of [{ heightM: 15 }, { rings: [rect(50, 5)] }, { rings: [rect(25, 20)] }, { isSchool: true }, { buildingUse: "学校" }, { sourceRoofShape: "flat" }, { sourceRoofShape: "dome" }]) {
      expect(createGeographicRoof({ ...options, allowIllustrativeHip: true, ...extra }).style).toBe("flat");
    }
    expect(createGeographicRoof({ ...options, sourceRoofShape: "gabled", buildingUse: "university" }).style).toBe("flat");
    expect(createGeographicRoof({ ...options, sourceRoofShape: "gabled", rings: [rect(25, 20)] }).style).toBe("flat");
  });

  it("keeps holes empty and concave/irregular footprints flat", () => {
    const hole = rect(4, 4).map((p) => ({ x: p.x + 3, z: p.z + 3 }));
    const holed = createGeographicRoof({ rings: [rect(), hole], baseY: 2, heightM: 10, sourceRoofShape: "hipped", allowIllustrativeHip: true });
    expect(holed.style).toBe("flat"); expect(holed.eaveY).toBe(12);
    expect(projectedArea(holed)).toBeCloseTo(184, 8);
    for (const [a, b, c] of holed.triangles) {
      const x = (a.x + b.x + c.x) / 3, z = (a.z + b.z + c.z) / 3;
      expect(x > 3 && x < 7 && z > 3 && z < 7).toBe(false);
    }
    const concave = [{ x: 0, z: 0 }, { x: 20, z: 0 }, { x: 5, z: 4 }, { x: 0, z: 10 }];
    const flat = createGeographicRoof({ rings: [concave], baseY: 2, heightM: 8, sourceRoofShape: "gabled" });
    expect(flat.style).toBe("flat"); expect(projectedArea(flat)).toBeCloseTo(65, 8);
    const skewed = rect(); skewed[2]!.x += 4;
    expect(createGeographicRoof({ rings: [skewed], baseY: 0, heightM: 10, sourceRoofShape: "gabled" }).style).toBe("flat");
  });

  it("is rotation/winding independent, preserves caller rings and keeps every vertex inside", () => {
    const angle = 0.71, cos = Math.cos(angle), sin = Math.sin(angle);
    const ring = rect().map((p) => ({ x: 410 + cos * p.x - sin * p.z, z: -230 + sin * p.x + cos * p.z }));
    ring.reverse(); ring.push({ ...ring[0]! });
    const before = JSON.stringify(ring);
    for (const sourceRoofShape of ["gabled", "hipped"]) {
      const result = createGeographicRoof({ rings: [ring], baseY: -4, heightM: 6, sourceRoofShape });
      expect(result.style).toBe(sourceRoofShape); expect(projectedArea(result)).toBeCloseTo(200, 8);
      for (const p of result.triangles.flat()) {
        const x = cos * (p.x - 410) + sin * (p.z + 230), z = -sin * (p.x - 410) + cos * (p.z + 230);
        expect(x).toBeGreaterThanOrEqual(-1e-9); expect(x).toBeLessThanOrEqual(20 + 1e-9);
        expect(z).toBeGreaterThanOrEqual(-1e-9); expect(z).toBeLessThanOrEqual(10 + 1e-9);
        expect(p.y).toBeLessThanOrEqual(2);
      }
    }
    expect(JSON.stringify(ring)).toBe(before);
  });

  it("retains the original maximum top for the actual mapped roof-shape candidates", () => {
    const data = JSON.parse(readFileSync(new URL("../../../public/geodata/koriyama/features.geojson", import.meta.url), "utf8")) as KoriyamaGeodata;
    let pitched = 0;
    for (const f of data.features.filter((f) => f.properties["roof:shape"])) {
      if (f.geometry.type !== "MultiPolygon") continue;
      for (const polygon of f.geometry.coordinates) {
        const roof = createGeographicRoof({ rings: polygon.map((r) => r.map(koriyamaGeoToLocal)), baseY: 3, heightM: 8,
          sourceRoofShape: String(f.properties["roof:shape"]) });
        if (roof.style !== "flat") pitched++;
        expect(Math.max(...roof.triangles.flat().map((p) => p.y))).toBe(11);
        expect(projectedArea(roof)).toBeCloseTo(roof.footprintAreaM2, 5);
      }
    }
    expect(pitched).toBeGreaterThan(0);
  });

  it("rejects nonfinite geometry/heights and handles a zero-height flat envelope", () => {
    for (const heightM of [-1, NaN, Infinity]) expect(() => createGeographicRoof({ rings: [rect()], baseY: 0, heightM })).toThrow(RangeError);
    expect(() => createGeographicRoof({ rings: [[{ x: NaN, z: 0 }, ...rect()]], baseY: 0, heightM: 8 })).toThrow(RangeError);
    const flat = createGeographicRoof({ rings: [rect()], baseY: 3, heightM: 0, sourceRoofShape: "gabled" });
    expect(flat.style).toBe("flat"); expect(flat.topY).toBe(3); expect(flat.eaveY).toBe(3);
  });
});
