import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { geoToWorld } from "./dioramaSpace";
import {
  isGeodataBridge,
  koriyamaGeoToLocal,
  taggedHeightMeters,
  toLocalGeodataFeature,
  type KoriyamaGeodata,
  type GeoPoint,
} from "./koriyamaGeodata";

const bytes = readFileSync(
  new URL("../../../public/geodata/koriyama/features.geojson", import.meta.url),
);
const data: KoriyamaGeodata = JSON.parse(bytes.toString());
const metadata = JSON.parse(
  readFileSync(new URL("../../../public/geodata/koriyama/metadata.json", import.meta.url), "utf8"),
);

describe("bounded actual Koriyama geodata", () => {
  it("retains campus, named bridges, houses and railway source identities", () => {
    expect(data.features.find((f) => f.id === "way/88161447")?.properties.name).toBe(
      "日本大学工学部",
    );
    expect(data.features.some((f) => f.properties.name === "永徳橋" && isGeodataBridge(f))).toBe(
      true,
    );
    expect(
      data.features.some((f) => f.properties["bridge:name"] === "御代田橋" && isGeodataBridge(f)),
    ).toBe(true);
    expect(data.features.filter((f) => f.properties.kind === "building").length).toBeGreaterThan(
      1000,
    );
    expect(data.features.some((f) => f.properties.kind === "rail")).toBe(true);
    expect(new Set(data.features.map((f) => f.id)).size).toBe(data.features.length);
  });
  it("has bounded finite coordinates and closed rings", () => {
    const errors: string[] = [];
    const [west, south, east, north] = data.bbox;
    const checkPoint = ([lon, lat]: GeoPoint): void => {
      if (
        !Number.isFinite(lon) ||
        !Number.isFinite(lat) ||
        lon < west ||
        lon > east ||
        lat < south ||
        lat > north
      )
        errors.push(`outside: ${lon},${lat}`);
    };
    for (const feature of data.features) {
      if (feature.geometry.type === "MultiPolygon") {
        for (const polygon of feature.geometry.coordinates) {
          for (const ring of polygon) {
            if (
              ring.length < 4 ||
              ring.at(-1)?.[0] !== ring[0]?.[0] ||
              ring.at(-1)?.[1] !== ring[0]?.[1]
            )
              errors.push(`unclosed: ${feature.id}`);
            ring.forEach(checkPoint);
          }
        }
      } else
        for (const line of feature.geometry.coordinates) {
          if (line.length < 2) errors.push(`short line: ${feature.id}`);
          line.forEach(checkPoint);
        }
    }
    expect(errors).toEqual([]);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(metadata.dataSha256);
  });
  it("preserves interior rings when converting a polygon with a hole", () => {
    const feature = data.features.find((f) => f.properties.kind === "water")!;
    const exterior: GeoPoint[] = [
      [140.38, 37.36],
      [140.39, 37.36],
      [140.39, 37.37],
      [140.38, 37.36],
    ];
    const hole: GeoPoint[] = [
      [140.384, 37.362],
      [140.385, 37.362],
      [140.385, 37.363],
      [140.384, 37.362],
    ];
    const local = toLocalGeodataFeature({
      ...feature,
      geometry: { type: "MultiPolygon", coordinates: [[exterior, hole]] },
    });
    expect(local.geometry.coordinates).toEqual([
      [exterior.map(koriyamaGeoToLocal), hole.map(koriyamaGeoToLocal)],
    ]);
  });
  it("aligns local coordinates with the existing game and never invents elevation", () => {
    const point: GeoPoint = [140.391, 37.357];
    const actual = koriyamaGeoToLocal(point);
    expect(actual).toEqual({ ...geoToWorld(...point), y: 0 });
    const building = data.features.find((f) => f.properties.kind === "building")!;
    const local = toLocalGeodataFeature(building);
    expect(local.id).toBe(building.id);
    expect(local.geometry.type).toBe("MultiPolygon");
    expect(
      taggedHeightMeters({ ...building, properties: { ...building.properties, height: "12.5 m" } }),
    ).toBe(12.5);
    expect(
      taggedHeightMeters({ ...building, properties: { ...building.properties, height: "40 ft" } }),
    ).toBeNull();
    expect(
      taggedHeightMeters({
        ...building,
        properties: { kind: "building", version: 1, timestamp: "" },
      }),
    ).toBeNull();
  });
});
