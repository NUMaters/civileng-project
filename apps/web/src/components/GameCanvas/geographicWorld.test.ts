import { readFileSync } from "node:fs";
import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { createGeographicWorld, type GeographicWorld, type GeographicWorldOptions } from "./geographicWorld";
import { groundY, worldToGeo } from "./dioramaSpace";
import { koriyamaGeoToLocal, type GeodataFeature, type GeoPoint, type KoriyamaGeodata } from "./koriyamaGeodata";
import type { KoriyamaPlateauGeodata, PlateauBuilding } from "./koriyamaPlateauGeodata";
import { createGeographicTerrain } from "./geographicTerrain";
import { decodeKoriyamaTerrain, type KoriyamaTerrainMetadata } from "./koriyamaTerrain";

const worlds: GeographicWorld[] = [];
function world(features: GeodataFeature[], options: GeographicWorldOptions = {}) {
  const result = createGeographicWorld({ type: "FeatureCollection", bbox: [140, 37, 141, 38], features }, options);
  worlds.push(result);
  return result;
}
const geo = (x: number, z: number): GeoPoint => {
  const p = worldToGeo(x, z);
  return [p.longitude, p.latitude];
};
const ring = (x: number, z: number, size: number): GeoPoint[] =>
  [[x, z], [x + size, z], [x + size, z + size], [x, z + size], [x, z]].map(([a, b]) => geo(a!, b!));
function polygon(id: string, kind: "building" | "campus" | "water", rings = [ring(101, 201, 30)]): GeodataFeature {
  return { type: "Feature", id, properties: { kind, version: 1, timestamp: "test" }, geometry: { type: "MultiPolygon", coordinates: [rings] } };
}
function line(id: string, kind: "road" | "rail", coordinates: GeoPoint[], bridge?: string): GeodataFeature {
  return { type: "Feature", id, properties: { kind, version: 1, timestamp: "test", ...(bridge ? { bridge } : {}) }, geometry: { type: "MultiLineString", coordinates: [coordinates] } };
}
function meshes(w: GeographicWorld, layer: string): THREE.Mesh[] {
  return w.children.filter((m) => m.userData.layer === layer) as THREE.Mesh[];
}
function area(w: GeographicWorld, layer: string): number {
  let sum = 0;
  for (const mesh of meshes(w, layer)) {
    const p = mesh.geometry.getAttribute("position");
    for (let i = 0; i < p.count; i += 3) {
      sum += Math.abs((p.getX(i + 1) - p.getX(i)) * (p.getZ(i + 2) - p.getZ(i)) -
        (p.getZ(i + 1) - p.getZ(i)) * (p.getX(i + 2) - p.getX(i))) / 2;
    }
  }
  return sum;
}
function hits(w: GeographicWorld, layer: string, x: number, z: number) {
  w.updateMatrixWorld(true);
  return new THREE.Raycaster(new THREE.Vector3(x, 1000, z), new THREE.Vector3(0, -1, 0)).intersectObjects(meshes(w, layer));
}
afterEach(() => {
  const materials = new Set<THREE.Material>();
  for (const w of worlds.splice(0)) for (const child of w.children) {
    const mesh = child as THREE.Mesh;
    mesh.geometry.dispose();
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(m);
  }
  for (const material of materials) material.dispose();
});

describe("actual geographic world", () => {
  it("keeps facade UVs anchored to original edges through bounds/tile clipping with one shared building material", () => {
    const building = polygon("styled", "building", [ring(101, 201, 90)]);
    building.properties.height = "12";
    const w = world([building, polygon("campus", "campus", [ring(101, 201, 90)])], {
      tileSize: 32, localBounds: { minX: 110, minZ: 190, maxX: 180, maxZ: 300 }, groundSampler: () => 0,
    });
    const buildingMeshes = meshes(w, "building");
    const materials = new Set(buildingMeshes.map((mesh) => mesh.material));
    expect(materials.size).toBe(1);
    expect(buildingMeshes.length).toBeGreaterThan(1);
    expect(buildingMeshes[0]!.material).not.toBe(meshes(w, "campus")[0]!.material);
    expect(w.userData.buildingDecoration.source).toBe("illustrative-not-surveyed");
    const observedTiles = new Set<string>();
    let wallVertices = 0;
    for (const mesh of buildingMeshes) {
      const p = mesh.geometry.getAttribute("position"), n = mesh.geometry.getAttribute("normal"), uv = mesh.geometry.getAttribute("facadeUv");
      expect(uv.count).toBe(p.count);
      expect(Array.from(uv.array).every(Number.isFinite)).toBe(true);
      expect(mesh.geometry.groups).toHaveLength(0);
      for (let i = 0; i < p.count; i++) {
        if (Math.abs(n.getY(i)) < 0.1 && Math.abs(p.getZ(i) - 201) < 0.001) {
          expect(uv.getX(i)).toBeCloseTo(p.getX(i) - 101, 3);
          expect(uv.getY(i)).toBeCloseTo(p.getY(i) - 0.08, 3);
          observedTiles.add(mesh.userData.tile.join("/")); wallVertices++;
        }
      }
    }
    expect(wallVertices).toBeGreaterThan(6);
    expect(observedTiles.size).toBeGreaterThan(1);
    expect(area(w, "building")).toBeCloseTo(70 * 90, 2);
    expect(new THREE.Box3().setFromObject(buildingMeshes[0]!).max.y).toBeCloseTo(12.08, 3);
    expect(meshes(w, "campus")[0]!.geometry.getAttribute("facadeUv")).toBeUndefined();
  });

  it("integrates the actual nullable DEM sampler and excludes out-of-coverage source features", () => {
    const read = (file: string) => readFileSync(new URL(`../../../public/geodata/koriyama/${file}`, import.meta.url));
    const osm = JSON.parse(read("features.geojson").toString()) as KoriyamaGeodata;
    const plateau = JSON.parse(read("plateau-buildings.geojson").toString()) as KoriyamaPlateauGeodata;
    const metadata = JSON.parse(read("terrain-metadata.json").toString()) as KoriyamaTerrainMetadata;
    const bytes = read("terrain.bin");
    const terrain = createGeographicTerrain(decodeKoriyamaTerrain(Uint8Array.from(bytes).buffer, metadata));
    const materials = new Set<THREE.Material>();
    try {
      const w = world(osm.features, { plateau, localBounds: terrain.bounds, groundSampler: terrain.sampleGround,
        surfaceGridSpacing: 12, surfaceSampler: (x, z) => {
          const y = terrain.sampleGround(x, z); return y === null ? null : y + 0.15;
        } });
      expect(w.stats.excludedByBounds).toBeGreaterThan(10_000);
      expect(w.stats.plateauModelHeights).toBeGreaterThan(8000);
      expect(w.stats.buildings).toBeLessThan(15_000);
      expect(w.stats.peakBufferedVertices).toBeLessThanOrEqual(65_536);
      for (const child of w.children) {
        const p = (child as THREE.Mesh).geometry.getAttribute("position");
        expect(Array.from(p.array).every(Number.isFinite)).toBe(true);
        const b = (child as THREE.Mesh).geometry.boundingBox!;
        expect(b.min.x).toBeGreaterThanOrEqual(terrain.bounds.minX - 0.001);
        expect(b.max.x).toBeLessThanOrEqual(terrain.bounds.maxX + 0.001);
        expect(b.min.z).toBeGreaterThanOrEqual(terrain.bounds.minZ - 0.001);
        expect(b.max.z).toBeLessThanOrEqual(terrain.bounds.maxZ + 0.001);
      }
      console.info("geographic-world bounded actual DEM", w.stats);
    } finally {
      for (const child of terrain.group.children) {
        const mesh = child as THREE.Mesh; mesh.geometry.dispose();
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(m);
      }
      for (const m of materials) m.dispose();
    }
  }, 30_000);

  it("clips before sampling, retains crossing rivers and bounds every emitted layer", () => {
    const bounds = { minX: 110, minZ: 210, maxX: 150, maxZ: 250 };
    let samples = 0;
    const sample = (x: number, z: number) => {
      expect(x).toBeGreaterThanOrEqual(bounds.minX); expect(x).toBeLessThanOrEqual(bounds.maxX);
      expect(z).toBeGreaterThanOrEqual(bounds.minZ); expect(z).toBeLessThanOrEqual(bounds.maxZ);
      samples++; return 2;
    };
    const w = world([polygon("outside", "building", [ring(900, 900, 30)]),
      polygon("cut-building", "building", [ring(101, 201, 30)]),
      polygon("crossing-water", "water", [ring(0, 0, 400), ring(120, 220, 10)]),
      polygon("campus", "campus", [ring(0, 0, 400)]),
      line("road", "road", [geo(0, 230), geo(400, 230)]),
      line("rail", "rail", [geo(130, 0), geo(130, 400)], "yes")], {
      localBounds: bounds, groundSampler: sample, surfaceSampler: sample, surfaceGridSpacing: 10,
    });
    expect(samples).toBeGreaterThan(0);
    expect(w.stats.excludedByBounds).toBe(1);
    expect(w.stats.buildings).toBe(1);
    expect(w.userData.buildingHeights.outside).toBeUndefined();
    expect(area(w, "water")).toBeCloseTo(1600 - 100, 2);
    expect(hits(w, "water", 125, 225)).toHaveLength(0);
    for (const layer of ["building", "campus", "water", "road", "bridge-rail"]) {
      expect(meshes(w, layer).length).toBeGreaterThan(0);
      for (const mesh of meshes(w, layer)) {
        const b = mesh.geometry.boundingBox!;
        expect(b.min.x).toBeGreaterThanOrEqual(110); expect(b.max.x).toBeLessThanOrEqual(150);
        expect(b.min.z).toBeGreaterThanOrEqual(210); expect(b.max.z).toBeLessThanOrEqual(250);
      }
    }
  });

  it("skips entire no-data buildings and no-data surface triangles without NaN or zero fallback", () => {
    const w = world([polygon("missing", "building", [ring(100, 200, 20)]),
      polygon("valid", "building", [ring(150, 200, 20)]), polygon("water", "water", [ring(100, 200, 80)])], {
      groundSampler: (x) => x < 140 ? null : 7,
      surfaceSampler: (x) => x > 175 ? NaN : 8,
      surfaceGridSpacing: 10,
    });
    expect(w.stats.skippedNoDataBuildings).toBe(1);
    expect(w.stats.skippedNoDataTriangles).toBeGreaterThan(0);
    expect(w.stats.buildings).toBe(1);
    expect(w.userData.buildingHeights.missing).toBeUndefined();
    expect(hits(w, "water", 110, 210)).toHaveLength(0);
    expect(hits(w, "water", 160, 240).length).toBeGreaterThan(0);
    for (const child of w.children) {
      const p = (child as THREE.Mesh).geometry.getAttribute("position");
      expect(Array.from(p.array).every(Number.isFinite)).toBe(true);
      for (let i = 0; i < p.count; i++) expect(p.getY(i)).toBeGreaterThanOrEqual(7);
    }
    const none = world([polygon("nan", "building")], { groundSampler: () => NaN });
    expect(none.children).toHaveLength(0);
    expect(none.stats.skippedNoDataBuildings).toBe(1);
  });

  it("subdivides sparse surfaces to sample interior relief and detect interior DEM gaps", () => {
    const w = world([polygon("water", "water", [ring(100, 200, 100)])], {
      surfaceGridSpacing: 10,
      groundSampler: (x, z) => x > 140 && x < 160 && z > 240 && z < 260 ? null : 0,
      surfaceSampler: (x, z) => 2 + Math.sin((x - 100) / 100 * Math.PI) * Math.sin((z - 200) / 100 * Math.PI),
    });
    expect(w.stats.skippedNoDataTriangles).toBeGreaterThan(0);
    expect(hits(w, "water", 150, 250)).toHaveLength(0);
    expect(hits(w, "water", 130, 230)[0]!.point.y).toBeGreaterThan(2.5);
    for (const mesh of w.waterMeshes) {
      const p = mesh.geometry.getAttribute("position");
      for (let i = 0; i < p.count; i += 3) {
        const xs = [p.getX(i), p.getX(i + 1), p.getX(i + 2)], zs = [p.getZ(i), p.getZ(i + 1), p.getZ(i + 2)];
        expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(10.001);
        expect(Math.max(...zs) - Math.min(...zs)).toBeLessThanOrEqual(10.001);
      }
    }
    expect(() => world([], { localBounds: { minX: 1, maxX: 0, minZ: 0, maxZ: 1 } })).toThrow(RangeError);
    expect(() => world([], { surfaceGridSpacing: 0 })).toThrow(RangeError);
  });

  it("uses actual PLATEAU LOD1 model height, retains measuredHeight, and suppresses overlapping OSM only", () => {
    const plateau = JSON.parse(readFileSync(new URL("../../../public/geodata/koriyama/plateau-buildings.geojson", import.meta.url), "utf8")) as KoriyamaPlateauGeodata;
    const source = plateau.features.find((f) => Math.abs(f.properties.modelHeightMeters - (f.properties.heightMeters ?? 0)) > 1)!;
    const duplicate: GeodataFeature = { ...polygon("osm-copy", "building"), geometry: source.geometry };
    const one = world([duplicate], { plateau: { ...plateau, features: [source] }, groundSampler: () => 0 });
    expect(one.stats).toMatchObject({ buildings: 1, plateauModelHeights: 1, suppressedOsmBuildings: 1, unknownHeights: 0 });
    expect(one.userData.buildingHeights[source.id]).toMatchObject({ meters: source.properties.modelHeightMeters,
      measuredHeightMeters: source.properties.heightMeters, source: "plateau-lod1-z-bounds", datasetYear: 2020 });
    expect(new THREE.Box3().setFromObject(one).getSize(new THREE.Vector3()).y).toBeCloseTo(source.properties.modelHeightMeters, 4);
    expect(one.userData.attributions).toHaveLength(2);

    // An OSM building inside a PLATEAU courtyard is not an overlap; neither is a distant one.
    const holed: PlateauBuilding = { ...source, geometry: { type: "MultiPolygon", coordinates: [[ring(100, 200, 100), ring(120, 220, 60)]] } };
    const mixed = world([polygon("inside-hole", "building", [ring(130, 230, 10)]), polygon("overlap", "building", [ring(105, 205, 10)]),
      polygon("outside", "building", [ring(300, 400, 10)])], { plateau: { ...plateau, features: [holed] } });
    expect(mixed.userData.suppressedOsmBuildingIds).toEqual(["overlap"]);
    expect(mixed.stats.buildings).toBe(3);

    const osm = JSON.parse(readFileSync(new URL("../../../public/geodata/koriyama/features.geojson", import.meta.url), "utf8")) as KoriyamaGeodata;
    const all = world(osm.features, { plateau });
    expect(all.stats.plateauModelHeights).toBe(9561);
    expect(all.stats.suppressedOsmBuildings).toBeGreaterThan(5000);
    expect(all.stats.buildings).toBe(osm.features.filter((f) => f.properties.kind === "building").length + plateau.features.length - all.stats.suppressedOsmBuildings);
    expect(all.stats.batches).toBeLessThan(1500);
    expect(all.stats.peakBufferedVertices).toBeLessThanOrEqual(65_536);
    console.info("geographic-world OSM + PLATEAU budget", all.stats);
  }, 30_000);

  it("accepts matching terrain/surface samplers while preserving exact water X/Z and holes", () => {
    const w = world([polygon("water", "water", [ring(101, 201, 90), ring(121, 221, 30)]), polygon("building", "building")], {
      groundSampler: () => -3,
      surfaceSampler: (_x, _z, layer) => layer === "water" ? 0.4 : 1,
    });
    for (const mesh of w.waterMeshes) {
      expect(mesh.geometry.boundingBox!.min.y).toBeCloseTo(0.4);
      expect(mesh.geometry.boundingBox!.max.y).toBeCloseTo(0.4);
    }
    expect(hits(w, "water", 130, 230)).toHaveLength(0);
    expect(area(w, "water")).toBeCloseTo(90 * 90 - 30 * 30, 2);
    expect(meshes(w, "building")[0]!.geometry.boundingBox!.min.y).toBeCloseTo(-2.92);
    expect(w.userData.surfaceSource).toBe("caller-provided-surface-sampler");
  });

  it("retains all polygon positions and courtyard/water/campus holes across tile boundaries", () => {
    for (const kind of ["building", "campus", "water"] as const) {
      const feature = polygon(kind, kind, [ring(101, 201, 90), ring(121, 221, 30)]);
      const w = world([feature], { tileSize: 32 });
      expect(area(w, kind)).toBeCloseTo(90 * 90 - 30 * 30, 2);
      expect(hits(w, kind, 130, 230)).toHaveLength(0);
      expect(hits(w, kind, 110, 210).length).toBeGreaterThan(0);
      expect(hits(w, kind, 0, 0)).toHaveLength(0);
      const bounds = new THREE.Box3().setFromObject(w);
      expect(bounds.min.x).toBeCloseTo(101, 4);
      expect(bounds.max.x).toBeCloseTo(191, 4);
      expect(bounds.min.z).toBeCloseTo(201, 4);
      expect(bounds.max.z).toBeCloseTo(291, 4);
      for (const child of w.children) {
        const mesh = child as THREE.Mesh;
        const bounds = mesh.geometry.boundingBox!;
        expect(bounds.max.x - bounds.min.x).toBeLessThanOrEqual(32.001);
        expect(bounds.max.z - bounds.min.z).toBeLessThanOrEqual(32.001);
        expect(mesh.frustumCulled).toBe(true);
      }
    }
  });

  it("keeps road/rail bends and bridge identities, with depth clear of synthetic ground", () => {
    const path = [geo(110, 210), geo(170, 210), geo(170, 290)];
    const w = world([line("road-a", "road", path), line("rail-a", "rail", path, "viaduct")]);
    expect(w.userData.bridges).toEqual([{ id: "rail-a", kind: "rail", bridge: "viaduct", layer: undefined }]);
    for (const layer of ["road", "bridge-rail"]) {
      for (const [x, z] of [[130, 210], [170, 240]]) expect(hits(w, layer, x!, z!).length).toBeGreaterThan(0);
      expect(hits(w, layer, 140, 250)).toHaveLength(0);
      for (const mesh of meshes(w, layer)) {
        const p = mesh.geometry.getAttribute("position");
        for (let i = 0; i < p.count; i++) expect(p.getY(i)).toBeGreaterThan(groundY(p.getX(i), p.getZ(i)));
      }
    }
    expect(meshes(w, "bridge-road")).toHaveLength(0);
  });

  it("prioritizes explicit height evidence and counts source, estimated and unknown separately", () => {
    const tagged = polygon("tagged", "building"); tagged.properties.height = "12.5 m";
    const plateau = polygon("plateau", "building");
    plateau.properties = { ...plateau.properties, height: "4", heightMeters: 23.7,
      heightSource: "plateau-bldg:measuredHeight", heightMethod: "source-method" };
    const unknown = polygon("unknown", "building");
    const w = world([tagged, plateau, unknown]);
    expect(w.stats).toMatchObject({ buildings: 3, sourceHeights: 2, estimatedHeights: 1, unknownHeights: 1 });
    expect(w.userData.buildingHeights.plateau).toMatchObject({ meters: 23.7, source: "plateau-bldg:measuredHeight", method: "source-method" });
    expect(w.userData.buildingHeights.tagged.source).toBe("osm-height-tag-unverified");
    expect(w.userData.buildingHeights.unknown).toMatchObject({ meters: 6, unknown: true, estimated: true });
    const override = world([tagged], { buildingHeightProvider: () => ({ meters: 31, source: "plateau-bldg:measuredHeight", sourceId: "measured-building" }) });
    expect(override.userData.buildingHeights.tagged).toMatchObject({ meters: 31, sourceId: "measured-building" });
    const p = koriyamaGeoToLocal([140.3837, 37.3655]);
    expect(p).toEqual({ x: 0, y: 0, z: -0 });
    const box = new THREE.Box3().setFromObject(override);
    expect(box.max.y - box.min.y).toBeCloseTo(31, 4);
    const flat = world([unknown], { provisionalBuildingHeight: 0 });
    expect(flat.stats).toMatchObject({ unknownHeights: 1, estimatedHeights: 0 });
    expect(new THREE.Box3().setFromObject(flat).getSize(new THREE.Vector3()).y).toBe(0);
    expect(w.userData.assumptions).toContain("groundY-synthetic-not-DEM");
  });

  it("rejects invalid limits and ignores invalid provider heights", () => {
    expect(() => world([], { tileSize: 0 })).toThrow(RangeError);
    expect(() => world([], { maxBatchVertices: 2 })).toThrow(RangeError);
    expect(() => world([], { provisionalBuildingHeight: NaN })).toThrow(RangeError);
    expect(world([polygon("a", "building")], { buildingHeightProvider: () => ({ meters: NaN, source: "PLATEAU" }) }).stats.unknownHeights).toBe(1);
  });

  it("exposes attached water geometry without an extra full-world geometry or draw call", () => {
    const w = world([polygon("water", "water", [ring(-70, -70, 150)])], { tileSize: 32 });
    expect(w.waterMeshes.length).toBeGreaterThan(1);
    expect(w.waterGeometries).toEqual(w.waterMeshes.map((mesh) => mesh.geometry));
    expect(w.waterMeshes.every((mesh) => mesh.parent === w && mesh.position.length() === 0)).toBe(true);
    expect(w.children).toHaveLength(w.waterMeshes.length);
    expect(area(w, "water")).toBeCloseTo(150 * 150, 2);
  });

  it("renders the actual 22k-footprint dataset with bounded tile/chunk geometry and deterministic output", () => {
    const data = JSON.parse(readFileSync(new URL("../../../public/geodata/koriyama/features.geojson", import.meta.url), "utf8")) as KoriyamaGeodata;
    const w = world(data.features);
    const buildings = data.features.filter((f) => f.properties.kind === "building");
    expect(w.stats.buildings).toBe(buildings.length);
    expect(buildings.length).toBeGreaterThan(20_000);
    expect(w.stats.batches).toBeLessThan(1500);
    expect(w.stats.peakBufferedVertices).toBeLessThanOrEqual(65_536);
    let bytes = 0;
    for (const child of w.children) {
      const mesh = child as THREE.Mesh;
      expect(mesh.geometry.getAttribute("position").count).toBeLessThanOrEqual(32_766);
      expect(mesh.geometry.groups).toHaveLength(0);
      const bounds = mesh.geometry.boundingBox!;
      expect(bounds.max.x - bounds.min.x).toBeLessThanOrEqual(512.001);
      expect(bounds.max.z - bounds.min.z).toBeLessThanOrEqual(512.001);
      for (const a of Object.values(mesh.geometry.attributes)) bytes += a.array.byteLength;
    }
    expect(bytes).toBeLessThan(150 * 1024 * 1024);
    const school = data.features.find((f) => f.id === "way/88161447")!;
    expect(school.properties.name).toBe("日本大学工学部");
    if (school.geometry.type !== "MultiPolygon") throw new Error("Expected campus polygon");
    const campus = world([school]);
    const points = school.geometry.coordinates.flat(2).map(koriyamaGeoToLocal);
    const bounds = new THREE.Box3().setFromObject(campus);
    expect(bounds.min.x).toBeCloseTo(Math.min(...points.map((p) => p.x)), 3);
    expect(bounds.max.z).toBeCloseTo(Math.max(...points.map((p) => p.z)), 3);
    const first = world(buildings.slice(0, 100));
    const second = world(buildings.slice(0, 100));
    expect(first.stats).toEqual(second.stats);
    first.children.forEach((child, i) => {
      expect((child as THREE.Mesh).geometry.getAttribute("position").array).toEqual((second.children[i] as THREE.Mesh).geometry.getAttribute("position").array);
    });
    console.info("geographic-world actual-data budget", { ...w.stats, geometryBytes: bytes });
  }, 30_000);
});
