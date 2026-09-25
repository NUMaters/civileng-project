import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { koriyamaGeoToLocal, type GeoPoint } from "./koriyamaGeodata";
import { toLocalLandcoverFeature, type KoriyamaLandcover, type LandcoverFeature } from "./koriyamaLandcover";

const read = (name: string) => readFileSync(new URL(`../../../public/geodata/koriyama/${name}`, import.meta.url));
const bytes = read("landcover.geojson"), sourceBytes = read("landcover-source.osm.json.gz");
const data = JSON.parse(bytes.toString()) as KoriyamaLandcover;
const metadata = JSON.parse(read("landcover-metadata.json").toString());
const source = JSON.parse(gunzipSync(sourceBytes).toString());

describe("bounded source landcover", () => {
  it("matches both snapshot hashes, category counts, query and attribution", () => {
    const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
    expect(hash(bytes)).toBe(metadata.dataSha256);
    expect(hash(sourceBytes)).toBe(metadata.sourceSha256);
    expect(metadata.query).toBe(source.query);
    expect(metadata.query).toContain("node[natural=tree](37.351,140.37,37.379,140.398)");
    expect(metadata.query).toContain("relation[type=multipolygon]");
    expect(metadata.attribution).toBe("© OpenStreetMap contributors");
    expect(metadata.license).toBe("ODbL-1.0");
    const counts: Record<string, number> = {};
    for (const f of data.features) counts[f.properties.category] = (counts[f.properties.category] ?? 0) + 1;
    expect(counts).toEqual(metadata.counts);
    expect(data.features.length).toBe(metadata.features);
    expect(data.features.length).toBeGreaterThan(0);
    expect(new Set(data.features.map((f) => f.id)).size).toBe(data.features.length);
  });

  it("has finite bounded coordinates and closed polygon rings without invented points", () => {
    const [west, south, east, north] = data.bbox;
    expect(data.bbox).toEqual([140.370, 37.351, 140.398, 37.379]);
    const check = ([lon, lat]: GeoPoint) => {
      expect(Number.isFinite(lon) && Number.isFinite(lat)).toBe(true);
      expect(lon).toBeGreaterThanOrEqual(west); expect(lon).toBeLessThanOrEqual(east);
      expect(lat).toBeGreaterThanOrEqual(south); expect(lat).toBeLessThanOrEqual(north);
    };
    for (const feature of data.features) {
      if (feature.geometry.type === "Point") {
        expect(feature.properties.natural).toBe("tree"); check(feature.geometry.coordinates);
        const original = source.elements.find((e: { type: string; id: number }) => `${e.type}/${e.id}` === feature.id);
        expect(feature.geometry.coordinates).toEqual([original.lon, original.lat]);
      } else for (const polygon of feature.geometry.coordinates) for (const ring of polygon) {
        expect(ring.length).toBeGreaterThanOrEqual(4); expect(ring[0]).toEqual(ring.at(-1)); ring.forEach(check);
      }
    }
  });

  it("retains all interior rings and mapped tree positions in the existing metre coordinate system", () => {
    const feature: LandcoverFeature = { type: "Feature", id: "relation/test", properties: {
      kind: "landcover", category: "natural:wood", natural: "wood", version: 1, timestamp: "test",
    }, geometry: { type: "MultiPolygon", coordinates: [[
      [[140.38, 37.36], [140.39, 37.36], [140.39, 37.37], [140.38, 37.37], [140.38, 37.36]],
      [[140.382, 37.362], [140.382, 37.364], [140.384, 37.364], [140.384, 37.362], [140.382, 37.362]],
    ]] } };
    const local = toLocalLandcoverFeature(feature);
    if (feature.geometry.type !== "MultiPolygon" || local.geometry.type !== "MultiPolygon") throw new Error("polygon");
    expect(local.geometry.coordinates).toEqual(feature.geometry.coordinates.map((p) => p.map((r) => r.map(koriyamaGeoToLocal))));
    const tree = data.features.find((f) => f.geometry.type === "Point")!;
    const localTree = toLocalLandcoverFeature(tree);
    if (tree.geometry.type !== "Point" || localTree.geometry.type !== "Point") throw new Error("tree");
    expect(localTree.geometry.coordinates).toEqual(koriyamaGeoToLocal(tree.geometry.coordinates));
    expect(localTree.provenance.elevationSource).toBe("none");
    expect(localTree.provenance.treeHeightSource).toBe("not-verified");
  });

  it("omits contributor accounts/changesets from all saved source and output objects", () => {
    function check(value: unknown) {
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        expect(["user", "uid", "changeset", "email", "phone", "contact:email", "contact:phone"]).not.toContain(key);
        check(child);
      }
    }
    check(source); check(data);
    expect(metadata.limitations).toContain("Park/sports_centre polygons are facility extents, not proof of continuous vegetation");
  });
});
