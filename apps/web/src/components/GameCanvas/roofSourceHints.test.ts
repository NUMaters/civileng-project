import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { resolveRoofSourceHints } from "./roofSourceHints";
import { type GeodataFeature, type GeoPoint, type KoriyamaGeodata } from "./koriyamaGeodata";
import { worldToGeo } from "./dioramaSpace";

const base = new URL("../../../public/geodata/koriyama/", import.meta.url);
const point = (x: number, z: number): GeoPoint => { const p = worldToGeo(x, z); return [p.longitude, p.latitude]; };
function building(shape?: string): GeodataFeature {
  return { type: "Feature", id: "way/test", properties: { kind: "building", version: 2, timestamp: "source-date", height: "10",
    ...(shape ? { "roof:shape": shape } : {}) }, geometry: { type: "MultiPolygon", coordinates: [[[point(0, 0), point(20, 0), point(20, 10), point(0, 10), point(0, 0)]]] } };
}

describe("attributed roof source hints", () => {
  it("restores every bundled shape tag with exact source linkage and valid metadata hashes", () => {
    const rawBytes = readFileSync(new URL("source.osm.json.gz", base));
    const outputBytes = readFileSync(new URL("features.geojson", base));
    const raw = JSON.parse(gunzipSync(rawBytes).toString());
    const data = JSON.parse(outputBytes.toString()) as KoriyamaGeodata;
    const metadata = JSON.parse(readFileSync(new URL("metadata.json", base), "utf8"));
    const source = raw.elements.filter((e: { tags?: Record<string, string> }) => e.tags?.["roof:shape"]);
    const restored = data.features.filter((f) => f.properties["roof:shape"]);
    expect(source).toHaveLength(41); expect(restored).toHaveLength(41);
    const counts: Record<string, number> = {};
    for (const feature of restored) {
      const original = source.find((e: { type: string; id: number }) => `${e.type}/${e.id}` === feature.id);
      expect(original).toBeDefined();
      expect(feature.properties["roof:shape"]).toBe(original.tags["roof:shape"]);
      expect(feature.properties.height).toBe(original.tags.height);
      expect(feature.properties["roof:height"]).toBe(original.tags["roof:height"]);
      const hint = resolveRoofSourceHints(feature);
      expect(hint.provenance.sourceId).toBe(feature.id);
      expect(hint.provenance.sourceVersion).toBe(original.version);
      expect(hint.roofHeightMeters).toBeNull();
      expect(hint.ridgeDirectionDegrees).toBeNull();
      expect(hint.requiresEstimatedDimensions).toBe(true);
      counts[hint.shape!] = (counts[hint.shape!] ?? 0) + 1;
    }
    expect(counts).toEqual({ hipped: 19, gabled: 22 });
    expect(metadata.roofShapeCounts).toEqual(counts);
    expect(createHash("sha256").update(rawBytes).digest("hex")).toBe(metadata.sourceSha256);
    expect(createHash("sha256").update(outputBytes).digest("hex")).toBe(metadata.dataSha256);
  });

  it("accepts only supported tagged simple rectangles without changing source geometry or height", () => {
    for (const shape of ["gabled", "hipped"]) {
      const feature = building(shape), before = JSON.stringify(feature);
      const hint = resolveRoofSourceHints(feature);
      expect(hint.eligibleForDisplayGeometry).toBe(true);
      expect(hint.roofHeightMeters).toBeNull();
      expect(hint.ridgePosition).toBeNull();
      expect(hint.provenance.heightPolicy).toContain("never-add-on-top");
      expect(JSON.stringify(feature)).toBe(before);
    }
    expect(resolveRoofSourceHints(building()).reason).toBe("missing-shape");
    expect(resolveRoofSourceHints(building("dome")).reason).toBe("unsupported-shape");
    const other = building("gabled"); other.properties.kind = "campus";
    expect(resolveRoofSourceHints(other).reason).toBe("not-building");
  });

  it("rejects holes, multipolygons, concavity, self-intersections and malformed coordinates", () => {
    const cases = [building("gabled"), building("gabled"), building("gabled"), building("gabled"), building("gabled")];
    const polygons = cases.map((f) => { if (f.geometry.type !== "MultiPolygon") throw new Error("polygon"); return f.geometry.coordinates; });
    polygons[0]![0]!.push([point(2, 2), point(3, 2), point(3, 3), point(2, 2)]);
    polygons[1]!.push(structuredClone(polygons[1]![0]!));
    polygons[2]![0]![0] = [point(0, 0), point(20, 0), point(3, 3), point(0, 10), point(0, 0)];
    polygons[3]![0]![0] = [point(0, 0), point(20, 10), point(20, 0), point(0, 10), point(0, 0)];
    polygons[4]![0]![0]![1] = [NaN, 37.36];
    for (const f of cases) expect(resolveRoofSourceHints(f).reason).toBe("complex-footprint");
  });

  it("keeps roof dimension/orientation tags unverified and does not reinterpret direction as a ridge", () => {
    const feature = building("gabled");
    Object.assign(feature.properties, { "roof:height": "2.5 m", "roof:direction": "90", "roof:orientation": "along" });
    const hint = resolveRoofSourceHints(feature);
    expect(hint.roofHeightMeters).toBe(2.5);
    expect(hint.roofDirectionTagDegrees).toBe(90);
    expect(hint.roofOrientationTag).toBe("along");
    expect(hint.ridgeDirectionDegrees).toBeNull();
    expect(hint.provenance.verification).toBe("roof-tags-unverified");
    feature.properties["roof:height"] = "8 ft";
    expect(resolveRoofSourceHints(feature).roofHeightMeters).toBeNull();
  });
});
