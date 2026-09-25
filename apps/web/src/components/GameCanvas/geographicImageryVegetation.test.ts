import * as THREE from "three";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGeographicImageryVegetation, type ImageryVegetationOptions } from "./geographicImageryVegetation";
import { convertImageryTreeObservations, imageryPixelToGeo, type ImageryTreeCandidate, type ImageryTreeObservations, type VegetationExclusion } from "./imageryVegetation";
import { createImageryVegetationExclusions } from "./imageryVegetationExclusions";
import { koriyamaGeoToLocal, type KoriyamaGeodata } from "./koriyamaGeodata";
import type { KoriyamaPlateauGeodata } from "./koriyamaPlateauGeodata";
import type { KoriyamaLandcover } from "./koriyamaLandcover";
import { decodeKoriyamaTerrain, sampleKoriyamaTerrain, type KoriyamaTerrainMetadata } from "./koriyamaTerrain";
import { worldToGeo } from "./dioramaSpace";
import { disposeDioramaObject } from "./disposeDioramaObject";

const groups: THREE.Group[] = [];
const read = (file: string) => readFileSync(new URL(`../../../public/geodata/koriyama/${file}`, import.meta.url));
const actual: ImageryTreeObservations = JSON.parse(read("imagery-tree-observations.json").toString());
const bounds = { minX: -1000, minZ: -1000, maxX: 1000, maxZ: 1000 };
function candidate(id: string, x = 0, z = 0): ImageryTreeCandidate {
  const geo = worldToGeo(x, z), n = 2 ** 18;
  const px = (geo.longitude + 180) / 360 * n, py = (1 - Math.asinh(Math.tan(geo.latitude * Math.PI / 180)) / Math.PI) / 2 * n;
  const tile = { z: 18, x: Math.floor(px), y: Math.floor(py) };
  return { id, coordinates: [geo.longitude, geo.latitude], crownRadiusM: 3, positionSource: "imagery-inferred",
    imagery: { url: `https://maps.gsi.go.jp/xyz/seamlessphoto/18/${tile.x}/${tile.y}.jpg`, tile,
      pixel: { x: (px - tile.x) * 256, y: (py - tile.y) * 256 }, capturePeriod: null,
      captureDateScope: "unknown", attribution: "test source", manuallyInspected: true } };
}
function create(cs: ImageryTreeCandidate[], options: Partial<ImageryVegetationOptions> = {}) {
  const result = createGeographicImageryVegetation(cs, { bounds, groundSampler: () => 12, exclusions: [], ...options });
  groups.push(result.group); return result;
}
const ring = (x: number, z: number, size: number) => [{ x, z }, { x: x + size, z }, { x: x + size, z: z + size }, { x, z: z + size }];
afterEach(() => groups.splice(0).forEach(disposeDioramaObject));

describe("imagery-inferred vegetation", () => {
  it("normalizes inspected cross-tile observations while preserving the original campus sample", () => {
    const cs = convertImageryTreeObservations(actual);
    expect(cs).toHaveLength(91);
    expect(cs[4]!.imagery.tile.x).toBe(233293);
    expect(cs[4]!.imagery.pixel.x).toBe(254);
    expect(cs[20]!.imagery.tile).toEqual({ z: 18, x: 233295, y: 101706 });
    expect(cs[20]!.imagery.pixel).toEqual({ x: 17, y: 41 });
    for (const c of cs.slice(0, 34)) {
      expect(c.coordinates[0]).toBeGreaterThanOrEqual(140.38039);
      expect(c.coordinates[0]).toBeLessThanOrEqual(140.38342);
      expect(c.coordinates[1]).toBeGreaterThanOrEqual(37.35882);
      expect(c.coordinates[1]).toBeLessThanOrEqual(37.36021);
      expect(c.crownRadiusM).toBeGreaterThan(3.32);
      expect(c.crownRadiusM).toBeLessThan(6.18);
    }
    for (const c of cs) {
      expect(c.imagery.capturePeriod).toEqual({ start: "2022-07", end: "2022-09" });
      expect(c.imagery.captureDateScope).toBe("view-label-not-per-tree-verified");
      expect(c.coordinates).toEqual(imageryPixelToGeo(c.imagery.tile, c.imagery.pixel));
      expect(c).not.toHaveProperty("heightM");
    }
    expect(convertImageryTreeObservations({ ...actual, observations: [...actual.observations].reverse() }).map(c => c.id).sort()).toEqual(cs.map(c => c.id).sort());
    expect(() => imageryPixelToGeo({ z: 18, x: -1, y: 0 }, { x: 0, y: 0 })).toThrow(RangeError);
    expect(() => convertImageryTreeObservations({ ...actual, inspectionBatches: undefined, observations: [[0, 0, NaN]] })).toThrow(RangeError);
  });

  it("retains each inspection view and rejects ambiguous batch ranges", () => {
    const cs = convertImageryTreeObservations(actual);
    expect(cs.slice(0, 34).every(c => c.imagery.captureDateSourceUrl === actual.source.mapUrl)).toBe(true);
    expect(cs.slice(34, 43).every(c => c.imagery.captureDateSourceUrl === actual.inspectionBatches![1]!.mapUrl)).toBe(true);
    expect(cs.slice(43).every(c => c.imagery.captureDateSourceUrl === actual.inspectionBatches![2]!.mapUrl)).toBe(true);
    const overlap = { id: "overlap", observationRange: [34, 35] as [number, number] };
    expect(() => convertImageryTreeObservations({ ...actual, inspectionBatches: [...actual.inspectionBatches!, overlap] })).toThrow(/Overlapping/);
    expect(() => convertImageryTreeObservations({ ...actual, inspectionBatches: [{ ...overlap, observationRange: [34, 91] }] })).toThrow(RangeError);
    for (const inspectionBatches of [null, {}, [null], [{ id: "missing" }], [{ id: "bad", observationRange: "34,42" }]]) {
      expect(() => convertImageryTreeObservations({ ...actual, inspectionBatches } as unknown as ImageryTreeObservations)).toThrow(RangeError);
    }
  });

  it("renders only supplied centres and radii, with explicitly illustrative height and shared batched resources", () => {
    const cs = [candidate("c", 280, 20), candidate("b", 24, 20), candidate("a", 20, 20)];
    const before = JSON.stringify(cs);
    const r = create(cs, { maxInstancesPerBatch: 1 });
    expect(r.stats.counts.rendered).toBe(3); expect(r.stats.tiles).toBe(2); expect(r.stats.meshes).toBe(6);
    expect(JSON.stringify(cs)).toBe(before);
    const crowns = r.group.children.filter(m => m.userData.part === "crown") as THREE.InstancedMesh[];
    expect(new Set(crowns.map(m => m.geometry)).size).toBe(1);
    expect(new Set(crowns.map(m => m.material)).size).toBe(1);
    for (const mesh of crowns) {
      const record = r.records.find(t => t.candidate.id === mesh.userData.candidateIds[0])!;
      const m = new THREE.Matrix4(), pos = new THREE.Vector3(), scale = new THREE.Vector3();
      mesh.getMatrixAt(0, m); pos.setFromMatrixPosition(m); scale.setFromMatrixScale(m);
      const p = koriyamaGeoToLocal(record.candidate.coordinates);
      expect(pos.x).toBeCloseTo(p.x, 4); expect(pos.z).toBeCloseTo(p.z, 4);
      expect(pos.y).toBeCloseTo(12 + 7 * .65, 4); expect(scale.x).toBeCloseTo(3);
      expect(record.heightSource).toBe("illustrative-not-measured");
      expect(mesh.boundingSphere).not.toBeNull(); expect(mesh.frustumCulled).toBe(true);
    }
    const reversed = create([...cs].reverse(), { maxInstancesPerBatch: 1 });
    expect(reversed.group.children.map(m => m.userData)).toEqual(r.group.children.map(m => m.userData));
    for (let i = 0; i < r.group.children.length; i++) expect(Array.from((reversed.group.children[i] as THREE.InstancedMesh).instanceMatrix.array)).toEqual(Array.from((r.group.children[i] as THREE.InstancedMesh).instanceMatrix.array));
  });

  it("preserves exclusions and source positions, including polygon holes and intermediate road/rail bends", () => {
    const exclusions: VegetationExclusion[] = [
      { sourceId: "building", kind: "building", geometry: { type: "polygon", rings: [ring(-50, -50, 100), ring(-10, -10, 20)] } },
      { sourceId: "water", kind: "water", geometry: { type: "polygon", rings: [ring(100, 100, 20)] } },
      { sourceId: "road", kind: "road", geometry: { type: "corridor", halfWidthM: 2, points: [{ x: 200, z: 0 }, { x: 200, z: 100 }, { x: 300, z: 100 }] } },
      { sourceId: "rail", kind: "rail", geometry: { type: "corridor", halfWidthM: 1, points: [{ x: 400, z: 0 }, { x: 400, z: 100 }] } },
      { sourceId: "osm-tree", kind: "existing-tree", geometry: { type: "disc", centre: { x: 500, z: 50 }, radiusM: 2 } },
    ];
    const cs = [candidate("courtyard"), candidate("building", 20), candidate("water", 110, 110), candidate("road", 250, 100), candidate("rail", 400, 50), candidate("duplicate-tree", 501, 50)];
    const r = create(cs, { exclusions });
    expect(r.stats.counts.excluded).toBe(5); expect(r.stats.counts.rendered).toBe(1);
    for (const record of r.records) expect(record.candidate).toBe(cs.find(c => c.id === record.candidate.id));
    expect(r.records.find(t => t.candidate.id === "road")!.exclusions).toEqual([{ sourceId: "road", kind: "road" }]);
    const crown = create([candidate("hole-edge", 8, 0)], { exclusions, exclusionMode: "crown" });
    expect(crown.stats.counts.excluded).toBe(1);
  });

  it("skips unknown terrain, invalid candidates and full crowns outside bounds without outside sampling", () => {
    const sample = vi.fn(() => null);
    const invalid = candidate("invalid"); invalid.crownRadiusM = NaN;
    const moved = candidate("mismatched-pixel"); moved.coordinates[0] += .01;
    const r = create([candidate("missing"), candidate("edge", 999), invalid, moved], { groundSampler: sample });
    expect(r.stats.counts).toMatchObject({ "no-ground-data": 1, "outside-bounds": 1, "invalid-candidate": 2, rendered: 0 });
    expect(sample).toHaveBeenCalledTimes(1); expect(r.group.children).toHaveLength(0);
    expect(create([candidate("nan")], { groundSampler: () => NaN }).stats.counts["no-ground-data"]).toBe(1);
    expect(create([]).group.children).toHaveLength(0);
  });

  it("reports duplicate IDs and deterministic capacity rather than silently dropping or scattering", () => {
    const r = create([candidate("b"), candidate("a"), candidate("dup"), candidate("dup")], { maxTrees: 1 });
    expect(r.records.map(t => [t.candidate.id, t.reason])).toEqual([["a", "rendered"], ["b", "capacity"], ["dup", "duplicate-id"], ["dup", "duplicate-id"]]);
    expect(() => create([], { maxInstancesPerBatch: 0 })).toThrow(RangeError);
    expect(() => create([], { exclusions: [{ sourceId: "bad", kind: "water", geometry: { type: "polygon", rings: [[]] } }] })).toThrow(RangeError);
  });

  it("checks all observed candidates against bundled buildings/roads/rails/water/trees and nullable DEM", () => {
    const osm: KoriyamaGeodata = JSON.parse(read("features.geojson").toString());
    const plateau: KoriyamaPlateauGeodata = JSON.parse(read("plateau-buildings.geojson").toString());
    const landcover: KoriyamaLandcover = JSON.parse(read("landcover.geojson").toString());
    const metadata: KoriyamaTerrainMetadata = JSON.parse(read("terrain-metadata.json").toString());
    const terrain = decodeKoriyamaTerrain(Uint8Array.from(read("terrain.bin")).buffer, metadata);
    const nw = koriyamaGeoToLocal([140.370, 37.379]), se = koriyamaGeoToLocal([140.398, 37.351]);
    const cs = convertImageryTreeObservations(actual);
    const r = create(cs, { bounds: { minX: nw.x, minZ: nw.z, maxX: se.x, maxZ: se.z },
      exclusions: createImageryVegetationExclusions(osm, plateau, landcover), groundSampler: (x, z) => {
        const p = worldToGeo(x, z); return sampleKoriyamaTerrain(terrain, p.longitude, p.latitude).localY;
      } });
    expect(r.records).toHaveLength(91); expect(r.stats.counts["invalid-candidate"]).toBe(0);
    const originalIds = new Set(cs.slice(0, 34).map(c => c.id));
    const originalRecords = r.records.filter(t => originalIds.has(t.candidate.id));
    expect(originalRecords.filter(t => t.reason === "rendered")).toHaveLength(27);
    const previousAdditions = r.records.filter(t => cs.slice(34, 43).some(c => c.id === t.candidate.id));
    expect(previousAdditions).toHaveLength(9);
    expect(previousAdditions.filter(t => t.reason === "rendered")).toHaveLength(7);
    expect(previousAdditions.filter(t => t.reason === "excluded").map(t => t.exclusions)).toEqual([
      [{ sourceId: "way/116068331", kind: "road" }],
      [{ sourceId: "way/307995087", kind: "road" }],
    ]);
    for (const record of previousAdditions) {
      expect(record.candidate.coordinates[0]).toBeGreaterThan(140.3798);
      expect(record.candidate.coordinates[0]).toBeLessThan(140.381);
      expect(record.candidate.coordinates[1]).toBeGreaterThan(37.3595);
      expect(record.candidate.coordinates[1]).toBeLessThan(37.3603);
      expect(record.candidate).toBe(cs.find(c => c.id === record.candidate.id));
      if (record.reason === "rendered") expect(Number.isFinite(record.localPosition!.y)).toBe(true);
      else expect(record.exclusions.length).toBeGreaterThan(0);
    }
    const uncoveredCampus = r.records.filter(t => cs.slice(43).some(c => c.id === t.candidate.id));
    expect(uncoveredCampus).toHaveLength(48);
    expect(uncoveredCampus.filter(t => t.reason === "rendered")).toHaveLength(24);
    expect(uncoveredCampus.filter(t => t.reason === "excluded").every(t => t.exclusions.length > 0)).toBe(true);
    expect(r.stats.tiles).toBe(4); expect(r.stats.meshes).toBe(8);
    expect(r.group.children.filter(m => m.castShadow)).toHaveLength(4);
    for (const mesh of r.group.children) expect(mesh.castShadow).toBe(mesh.userData.part === "crown");
    expect(r.records.every(t => t.reason === "rendered" || t.reason === "excluded")).toBe(true);
    expect(r.group.userData.attributions).toEqual([actual.source.attribution]);
    console.info("actual imagery vegetation", JSON.stringify({ stats: r.stats,
      excluded: r.records.filter(t => t.reason !== "rendered").map(t => ({ id: t.candidate.id, exclusions: t.exclusions })) }));
  }, 60_000);
});
