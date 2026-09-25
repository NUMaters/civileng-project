import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type KoriyamaGeodata, type GeoPoint } from "./koriyamaGeodata";
import { toLocalPlateauBuilding, type KoriyamaPlateauGeodata } from "./koriyamaPlateauGeodata";

const bytes = readFileSync(
  new URL("../../../public/geodata/koriyama/plateau-buildings.geojson", import.meta.url),
);
const data: KoriyamaPlateauGeodata = JSON.parse(bytes.toString());
const osm: KoriyamaGeodata = JSON.parse(
  readFileSync(
    new URL("../../../public/geodata/koriyama/features.geojson", import.meta.url),
    "utf8",
  ),
);
const metadata = JSON.parse(
  readFileSync(
    new URL("../../../public/geodata/koriyama/plateau-metadata.json", import.meta.url),
    "utf8",
  ),
);
function inside([x, y]: GeoPoint, ring: GeoPoint[]): boolean {
  let contained = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!,
      [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) contained = !contained;
  }
  return contained;
}
describe("actual PLATEAU LOD1 buildings", () => {
  it("includes campus buildings with real source height evidence", () => {
    const campus = osm.features.find((f) => f.id === "way/88161447")!;
    if (campus.geometry.type !== "MultiPolygon") throw new Error("Missing campus area");
    const polygons = campus.geometry.coordinates;
    const buildings = data.features.filter((f) =>
      polygons.some(
        (polygon) =>
          inside(f.properties.sourceCenter, polygon[0]!) &&
          !polygon.slice(1).some((ring) => inside(f.properties.sourceCenter, ring)),
      ),
    );
    expect(buildings.length).toBeGreaterThan(20);
    expect(
      buildings.every(
        (f) =>
          f.properties.heightMeters !== null &&
          f.properties.heightSource === "plateau-bldg:measuredHeight",
      ),
    ).toBe(true);
    expect(buildings.some((f) => (f.properties.heightMeters ?? 0) > 10)).toBe(true);
  });
  it("keeps bounded source footprints and finite provenance-backed heights", () => {
    const errors: string[] = [];
    const [west, south, east, north] = data.bbox;
    for (const feature of data.features) {
      const p = feature.properties;
      if (
        !p.buildingId ||
        !p.tile ||
        !p.heightMethod ||
        !p.modelHeightMethod ||
        !Number.isFinite(p.modelHeightMeters) ||
        p.modelHeightMeters <= 0 ||
        !p.geometrySource ||
        !Number.isFinite(p.heightMeters) ||
        p.heightMeters === null ||
        p.heightMeters <= 0 ||
        p.heightMeters > 150
      )
        errors.push(feature.id);
      for (const polygon of feature.geometry.coordinates)
        for (const ring of polygon) {
          if (
            ring.length < 4 ||
            ring[0]?.[0] !== ring.at(-1)?.[0] ||
            ring[0]?.[1] !== ring.at(-1)?.[1]
          )
            errors.push(`ring: ${feature.id}`);
          for (const [lon, lat] of ring)
            if (
              !Number.isFinite(lon) ||
              !Number.isFinite(lat) ||
              lon < west ||
              lon > east ||
              lat < south ||
              lat > north
            )
              errors.push(`bounds: ${feature.id}`);
        }
    }
    expect(errors).toEqual([]);
    expect(new Set(data.features.map((f) => f.id)).size).toBe(data.features.length);
    expect(data.features.length).toBe(metadata.buildingCount);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(metadata.dataSha256);
  });
  it("adapts footprint coordinates while retaining height provenance and flat-datum limits", () => {
    const building = data.features[0]!;
    const local = toLocalPlateauBuilding(building);
    expect(local.properties).toEqual(building.properties);
    expect(local.geometry.coordinates[0]![0]!.every((p) => p.y === 0)).toBe(true);
  });
  it("does not replace a differing measured-height attribute with a LOD1 height", () => {
    const building = data.features.find((f) => f.properties.buildingId === "07203-bldg-74115")!;
    expect(building.properties.heightMeters).toBe(18.7);
    expect(building.properties.modelHeightMeters).toBeCloseTo(11.4115, 3);
    expect(building.properties.modelHeightMethod).toBe("点群から取得_中央値");
    expect(building.properties.heightSource).toBe("plateau-bldg:measuredHeight");
  });
});
