import { readFileSync } from "node:fs";
import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { createGeographicBridges, type GeographicBridgeOptions } from "./geographicBridges";
import { worldToGeo } from "./dioramaSpace";
import { koriyamaGeoToLocal, type GeodataFeature, type KoriyamaGeodata } from "./koriyamaGeodata";
import { decodeKoriyamaTerrain, sampleKoriyamaTerrain, type KoriyamaTerrainMetadata } from "./koriyamaTerrain";

const groups: THREE.Group[] = [];
const bounds = { minX: -100, minZ: -100, maxX: 400, maxZ: 400 };
function line(id: string, points: [number, number][], kind: "road" | "rail" = "road"): GeodataFeature {
  return { type: "Feature", id, properties: { kind, bridge: "yes", version: 1, timestamp: "test" }, geometry: {
    type: "MultiLineString", coordinates: [points.map(([x, z]) => { const g = worldToGeo(x, z); return [g.longitude, g.latitude]; })],
  } };
}
function create(features: GeodataFeature[], options: Partial<GeographicBridgeOptions> = {}) {
  const result = createGeographicBridges({ type: "FeatureCollection", bbox: [140, 37, 141, 38], features }, { bounds, groundSampler: () => 10, ...options });
  groups.push(result.group); return result;
}
afterEach(() => {
  const materials = new Set<THREE.Material>();
  for (const group of groups.splice(0)) for (const child of group.children) {
    const mesh = child as THREE.Mesh; mesh.geometry.dispose();
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(m);
  }
  materials.forEach((m) => m.dispose());
});

describe("source geographic bridge decks", () => {
  it("retains every bend and interpolates by path distance without sampling the river valley", () => {
    const feature = line("bent", [[0, 0], [30, 0], [30, 40], [80, 40]]);
    const sampled: [number, number][] = [];
    const result = create([feature], { tileSize: 32, groundSampler: (x, z) => {
      sampled.push([x, z]); return x < 1 ? 10 : x > 79 ? 22 : null;
    } });
    expect(sampled).toHaveLength(2);
    expect(result.sourceIds.has("bent")).toBe(true);
    const profile = result.profiles[0]!;
    expect(profile.points).toHaveLength(4);
    for (const [i, p] of profile.points.entries()) {
      if (feature.geometry.type !== "MultiLineString") throw new Error("line");
      const source = koriyamaGeoToLocal(feature.geometry.coordinates[0]![i]!);
      expect(p.x).toBe(source.x); expect(p.z).toBe(source.z);
      expect(p.y).toBeCloseTo(10.12 + 12 * p.distance / profile.length, 8);
    }
    expect(profile.points[1]!.y).toBeCloseTo(13.12, 4);
    expect(profile.points[2]!.y).toBeCloseTo(17.12, 4);
    expect(profile.elevationSource).toBe("estimated-endpoint-interpolation-not-surveyed");
    result.group.updateMatrixWorld(true);
    const hit = new THREE.Raycaster(new THREE.Vector3(30, 100, 20), new THREE.Vector3(0, -1, 0)).intersectObjects(result.group.children);
    expect(hit.length).toBeGreaterThan(0);
    expect(hit[0]!.point.y).toBeGreaterThan(14);
  });

  it("skips missing/outside/non-land endpoints and never emits partial multi-part replacements", () => {
    const multi = line("multi", [[0, 0], [20, 0]]);
    if (multi.geometry.type === "MultiLineString") {
      const second = line("other", [[40, 0], [80, 0]]);
      if (second.geometry.type === "MultiLineString") multi.geometry.coordinates.push(...second.geometry.coordinates);
    }
    const r = create([multi, line("outside", [[-200, 0], [20, 0]]), line("nan", [[70, 0], [90, 0]])], {
      groundSampler: (x) => { expect(x).toBeGreaterThanOrEqual(-100); return x > 60 ? NaN : 10; },
    });
    expect(r.sourceIds.size).toBe(0); expect(r.group.children).toHaveLength(0);
    expect(r.skipped.map((s) => s.reason)).toEqual(["no-data-endpoints", "outside-endpoints", "no-data-endpoints"]);
    expect(create([line("null", [[0, 0], [20, 0]])], { groundSampler: () => null }).skipped[0]!.reason).toBe("no-data-endpoints");
    expect(create([line("water", [[0, 0], [20, 0]])], { isLandEndpoint: () => false }).skipped[0]!.reason).toBe("non-land-endpoints");
  });

  it("clips wide decks/rails to bounds and batches geometry with one shared material", () => {
    const feature = line("rail", [[-90, -90], [350, -90], [350, 350]], "rail");
    feature.properties.width = "30 m";
    const r = create([feature], { tileSize: 64, maxBatchVertices: 300 });
    expect(r.profiles[0]!.widthSource).toBe("osm-width-tag-unverified");
    const materials = new Set();
    for (const child of r.group.children) {
      const mesh = child as THREE.Mesh; materials.add(mesh.material);
      expect(mesh.geometry.getAttribute("position").count).toBeLessThanOrEqual(300);
      expect(Array.from(mesh.geometry.getAttribute("position").array).every(Number.isFinite)).toBe(true);
      const b = mesh.geometry.boundingBox!;
      expect(b.max.x - b.min.x).toBeLessThanOrEqual(64.001);
      expect(b.max.z - b.min.z).toBeLessThanOrEqual(64.001);
      expect(b.min.x).toBeGreaterThanOrEqual(-100); expect(b.min.z).toBeGreaterThanOrEqual(-100);
      expect(b.max.x).toBeLessThanOrEqual(400); expect(b.max.z).toBeLessThanOrEqual(400);
    }
    expect(materials.size).toBe(1);
    expect(r.stats.batches).toBeLessThan(100);
    expect(() => create([], { deckThickness: -1 })).toThrow(RangeError);
  });

  it("renders actual bounded OSM bridges with actual nullable DEM endpoints and reports skipped ways", () => {
    const read = (name: string) => readFileSync(new URL(`../../../public/geodata/koriyama/${name}`, import.meta.url));
    const data = JSON.parse(read("features.geojson").toString()) as KoriyamaGeodata;
    const metadata = JSON.parse(read("terrain-metadata.json").toString()) as KoriyamaTerrainMetadata;
    const terrain = decodeKoriyamaTerrain(Uint8Array.from(read("terrain.bin")).buffer, metadata);
    const [west, south, east, north] = metadata.bounds;
    const a = koriyamaGeoToLocal([west!, north!]), b = koriyamaGeoToLocal([east!, south!]);
    const result = create(data.features, { bounds: { minX: a.x, minZ: a.z, maxX: b.x, maxZ: b.z }, groundSampler: (x, z) => {
      const p = worldToGeo(x, z); return sampleKoriyamaTerrain(terrain, p.longitude, p.latitude).localY;
    } });
    expect(result.sourceIds.size).toBeGreaterThan(3);
    expect(result.profiles.some((p) => data.features.find((f) => f.id === p.sourceId)?.properties.name === "永徳橋")).toBe(true);
    expect(result.skipped.length).toBeGreaterThan(0);
    expect(result.stats.batches).toBeLessThan(100);
    expect(result.profiles.every((p) => p.points.every((v) => Number.isFinite(v.y)))).toBe(true);
    console.info("actual geographic bridges", result.stats, result.skipped);
  });
});
