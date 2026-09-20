import * as THREE from "three";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canopyContainsCrown, convertImageryCanopyObservations, createGeographicCanopy, type CanopyOptions, type CanopyPatch, type ImageryCanopyObservations } from "./geographicCanopy";
import { convertImageryTreeObservations, type ImageryTreeObservations, type VegetationPoint } from "./imageryVegetation";
import { createImageryVegetationExclusions } from "./imageryVegetationExclusions";
import { intersectsVegetationExclusion } from "./geographicImageryVegetation";
import { createVegetationStyleResources, vegetationColor } from "./geographicVegetationStyle";
import { disposeDioramaObject } from "./disposeDioramaObject";
import { koriyamaGeoToLocal } from "./koriyamaGeodata";
import { worldToGeo } from "./dioramaSpace";
import { decodeKoriyamaTerrain, sampleKoriyamaTerrain } from "./koriyamaTerrain";

const read = (file: string) => readFileSync(new URL(`../../../public/geodata/koriyama/${file}`, import.meta.url));
const source: ImageryCanopyObservations = JSON.parse(read("imagery-canopy-observations.json").toString());
const observed: ImageryTreeObservations = JSON.parse(read("imagery-tree-observations.json").toString());
const groups: THREE.Group[] = [];
const ring = (x: number, z: number, n: number) => [{ x, z }, { x: x + n, z }, { x: x + n, z: z + n }, { x, z: z + n }];
const patch = (rings = [ring(0, 0, 60)], id = "test"): CanopyPatch => ({ id, rings, source: source.source });
function create(patches: CanopyPatch[], extra: Partial<CanopyOptions> = {}) {
  const r = createGeographicCanopy(patches, { bounds: { minX: 0, minZ: 0, maxX: 100, maxZ: 100 }, groundSampler: () => 12, exclusions: [], observedCrowns: [], ...extra });
  groups.push(r.group); return r;
}
afterEach(() => groups.splice(0).forEach(disposeDioramaObject));

describe("bounded imagery canopy reconstruction", () => {
  it("preserves four source envelopes and labels internal placement as illustrative, not observed trees", () => {
    const patches = convertImageryCanopyObservations(source);
    expect(patches).toHaveLength(4);
    expect(patches.map(p => p.rings[0]!.length)).toEqual(source.patches.map(p => p.rings[0]!.length));
    for (const p of patches) expect(p.source).toBe(source.source);
    const r = create([patch()]);
    expect(r.stats.counts.rendered).toBeGreaterThan(0);
    expect(r.records.every(c => c.positionSource === "illustrative-within-imagery-envelope")).toBe(true);
    expect(r.group.userData.policy.radiusRangeM).toEqual([2.3, 3.5]);
    expect(create([]).group.children).toHaveLength(0);
  });

  it("requires the FULL crown to fit concave polygons, holes and local bounds", () => {
    const concave: VegetationPoint[] = [{ x: 0, z: 0 }, { x: 60, z: 0 }, { x: 60, z: 20 }, { x: 20, z: 20 }, { x: 20, z: 60 }, { x: 0, z: 60 }];
    const rings = [concave, ring(5, 5, 8)];
    expect(canopyContainsCrown(rings, { x: 18, z: 18 }, 3)).toBe(false);
    expect(canopyContainsCrown(rings, { x: 9, z: 9 }, 1)).toBe(false);
    const sample = vi.fn((x: number, z: number) => {
      expect(x).toBeGreaterThanOrEqual(2); expect(x).toBeLessThanOrEqual(58);
      expect(z).toBeGreaterThanOrEqual(2); expect(z).toBeLessThanOrEqual(58); return 10;
    });
    const r = create([patch(rings)], { bounds: { minX: 2, minZ: 2, maxX: 58, maxZ: 58 }, groundSampler: sample });
    expect(r.stats.counts.rendered).toBeGreaterThan(0);
    for (const c of r.records.filter(c => c.reason === "rendered")) expect(canopyContainsCrown(rings, c, c.radiusM)).toBe(true);
    expect(r.stats.counts.boundary).toBeGreaterThan(0);
  });

  it("does not retry rejected cells, caps work, skips noData, and is stable across patch order", () => {
    const a = patch(), b = patch([ring(65, 65, 30)], "second");
    const one = create([a, b]), two = create([b, a]);
    expect(one.records).toEqual(two.records);
    expect(one.stats.evaluatedCells).toBeLessThanOrEqual(8192);
    expect(create([a], { maxCells: 4 }).stats.skippedPatches).toEqual([{ id: a.id, reason: "cell-budget" }]);
    expect(create([a], { groundSampler: () => null }).stats.counts.rendered).toBe(0);
    expect(create([a], { groundSampler: () => NaN }).stats.counts["no-ground-data"]).toBeGreaterThan(0);
    expect(create([a], { maxTrees: 1 }).stats.counts.rendered).toBe(1);
    expect(() => create([a, a])).toThrow(RangeError);
    expect(() => create([a], { spacingM: .01 })).toThrow(RangeError);
    const original = JSON.stringify(a);
    create([a], { exclusions: [{ sourceId: "building", kind: "building", geometry: { type: "polygon", rings: a.rings } }] });
    expect(JSON.stringify(a)).toBe(original);
  });

  it("keeps rounded shared style inside its radius, welds seam normals and deterministically varies greens", () => {
    const style = createVegetationStyleResources();
    try {
      const p = style.crown.getAttribute("position"), n = style.crown.getAttribute("normal");
      const seen = new Map<string, number[]>();
      for (let i = 0; i < p.count; i++) {
        expect(Math.hypot(p.getX(i), p.getZ(i))).toBeLessThanOrEqual(1.000001);
        expect(Math.abs(p.getY(i))).toBeLessThanOrEqual(1);
        expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 5);
        const key = [p.getX(i), p.getY(i), p.getZ(i)].map(v => Math.round(v * 1e6)).join("/");
        const normal = [n.getX(i), n.getY(i), n.getZ(i)];
        if (seen.has(key)) expect(normal).toEqual(seen.get(key)); else seen.set(key, normal);
      }
      expect(style.crown.index!.count / 3).toBeLessThanOrEqual(400);
      expect(vegetationColor("a")).toEqual(vegetationColor("a"));
      expect(new Set(Array.from({ length: 80 }, (_, i) => vegetationColor(`tree-${i}`).getHex())).size).toBeGreaterThan(1);
    } finally { style.crown.dispose(); style.trunk.dispose(); style.leaf.dispose(); style.bark.dispose(); }
  });

  it("excludes explicit crowns even when their individual renderer withheld them, and never samples rejected ground", () => {
    const c = convertImageryTreeObservations(observed)[0]!;
    const p = worldToGeo(30, 30);
    const sample = vi.fn(() => 12);
    const blocked = create([patch()], { observedCrowns: [{ ...c, coordinates: [p.longitude, p.latitude], crownRadiusM: 100 }], groundSampler: sample });
    expect(blocked.stats.counts.rendered).toBe(0);
    expect(blocked.stats.counts["explicit-crown"]).toBeGreaterThan(0);
    expect(sample).not.toHaveBeenCalled();
    const exclusion = { sourceId: "water-source", kind: "water" as const, geometry: { type: "polygon" as const, rings: [ring(0, 0, 60)] } };
    const flooded = create([patch()], { exclusions: [exclusion], groundSampler: sample });
    expect(flooded.stats.counts.rendered).toBe(0); expect(flooded.stats.counts.excluded).toBeGreaterThan(0);
    expect(sample).not.toHaveBeenCalled();
    const full = create([patch()], { maxInstancesPerBatch: 3 });
    for (const mesh of full.group.children as THREE.InstancedMesh[]) {
      expect(mesh.count).toBeLessThanOrEqual(3);
      expect(mesh.boundingBox).not.toBeNull(); expect(mesh.boundingSphere).not.toBeNull();
    }
  });

  it("checks actual DEM, source exclusions and all 34 observed crowns with bounded draw calls", () => {
    const patches = convertImageryCanopyObservations(source), observedCrowns = convertImageryTreeObservations(observed);
    const exclusions = createImageryVegetationExclusions(JSON.parse(read("features.geojson").toString()), JSON.parse(read("plateau-buildings.geojson").toString()), JSON.parse(read("landcover.geojson").toString()));
    const terrain = decodeKoriyamaTerrain(Uint8Array.from(read("terrain.bin")).buffer, JSON.parse(read("terrain-metadata.json").toString()));
    const nw = koriyamaGeoToLocal([140.370, 37.379]), se = koriyamaGeoToLocal([140.398, 37.351]);
    const r = create(patches, { bounds: { minX: nw.x, minZ: nw.z, maxX: se.x, maxZ: se.z }, exclusions, observedCrowns,
      groundSampler: (x, z) => { const p = worldToGeo(x, z); return sampleKoriyamaTerrain(terrain, p.longitude, p.latitude).localY; } });
    const accepted = r.records.filter(c => c.reason === "rendered");
    expect(accepted.length).toBe(58);
    expect(r.stats.evaluatedCells).toBe(318); expect(r.stats.meshes).toBe(6);
    for (const c of accepted) {
      expect(canopyContainsCrown(patches.find(p => p.id === c.patchId)!.rings, c, c.radiusM)).toBe(true);
      for (const o of observedCrowns) { const p = koriyamaGeoToLocal(o.coordinates); expect(Math.hypot(c.x - p.x, c.z - p.z)).toBeGreaterThan(c.radiusM + o.crownRadiusM); }
      for (const e of exclusions) expect(intersectsVegetationExclusion(c, c.radiusM, e)).toBe(false);
    }
    console.info("actual canopy", JSON.stringify({ stats: r.stats, perPatch: patches.map(p => ({ id: p.id, rendered: accepted.filter(c => c.patchId === p.id).length })) }));
  }, 60_000);
});
